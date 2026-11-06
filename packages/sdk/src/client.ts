import { getActiveContext, runWithContext, type ActiveContext } from './context';
import { detectProvider, instrumentClient, type ProviderHint, type Recorder } from './instrument';
import { Transport } from './transport';
import type {
  FlushResult,
  GlassfishOptions,
  SpanInput,
  SpanPayload,
  TraceOptions,
} from './types';
import { describeError, newId, now, truncate } from './utils';
import { runExperiment } from './experiment';
import type { DatasetExample, ExperimentOptions, ExperimentSummary } from './eval-types';

const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
  batchSize: 25,
  flushIntervalMs: 5_000,
  maxQueueSize: 10_000,
  timeoutMs: 10_000,
  maxRetries: 3,
  payloadMaxChars: 2_000,
};

/**
 * A handle on an in-flight trace. Everything recorded while the trace callback
 * runs is attached to it automatically.
 */
export class TraceHandle {
  constructor(
    private readonly client: Glassfish,
    private readonly context: ActiveContext,
    private readonly startedAt: number,
  ) {}

  get id(): string {
    return this.context.traceId;
  }

  /** Attach an end-user identifier, so cost can be grouped per customer. */
  setUser(userRef: string): this {
    this.context.userRef = userRef;
    return this;
  }

  setSession(sessionRef: string): this {
    this.context.sessionRef = sessionRef;
    return this;
  }

  tag(key: string, value: string): this {
    this.context.tags = { ...(this.context.tags ?? {}), [key]: value };
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): this {
    this.context.metadata = { ...(this.context.metadata ?? {}), ...metadata };
    return this;
  }

  /** Time a non-LLM step (a DB lookup, a tool call) inside this trace. */
  span<T>(name: string, fn: () => Promise<T> | T, options?: Partial<SpanInput>): Promise<T> {
    return this.client.span(name, fn, options);
  }

  /** Record a span you measured yourself. */
  record(span: SpanInput & { startedAt?: number; endedAt?: number }): void {
    this.client.record(span);
  }

  /** Emitted automatically by `trace()`; only call this for a manual trace. */
  end(status: 'ok' | 'error' = 'ok', error?: unknown): void {
    const failure = error !== undefined ? describeError(error) : undefined;
    this.client.record({
      name: this.context.traceName ?? 'trace',
      kind: 'chain',
      status,
      errorType: failure?.type,
      errorMessage: failure?.message,
      startedAt: this.startedAt,
      endedAt: now(),
    });
  }
}

export class Glassfish {
  private readonly queue: SpanPayload[] = [];
  private readonly transport: Transport | null;
  private readonly options: Required<
    Pick<
      GlassfishOptions,
      | 'baseUrl'
      | 'batchSize'
      | 'flushIntervalMs'
      | 'maxQueueSize'
      | 'timeoutMs'
      | 'maxRetries'
      | 'payloadMaxChars'
      | 'capturePayloads'
      | 'debug'
      | 'disabled'
    >
  > & { environment: string; release?: string };

  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<unknown> | null = null;
  private droppedSpans = 0;
  private closed = false;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(opts: GlassfishOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GLASSFISH_API_KEY ?? '';
    this.apiKey = apiKey;
    const baseUrl = opts.baseUrl ?? process.env.GLASSFISH_BASE_URL ?? DEFAULTS.baseUrl;
    const disabled = opts.disabled ?? process.env.GLASSFISH_DISABLED === '1';

    this.options = {
      baseUrl,
      batchSize: opts.batchSize ?? DEFAULTS.batchSize,
      flushIntervalMs: opts.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      maxQueueSize: opts.maxQueueSize ?? DEFAULTS.maxQueueSize,
      timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: opts.maxRetries ?? DEFAULTS.maxRetries,
      payloadMaxChars: opts.payloadMaxChars ?? DEFAULTS.payloadMaxChars,
      capturePayloads: opts.capturePayloads ?? false,
      debug: opts.debug ?? false,
      disabled,
      environment: opts.environment ?? process.env.NODE_ENV ?? 'development',
      release: opts.release ?? process.env.GLASSFISH_RELEASE,
    };

    const onError =
      opts.onError ??
      ((error: Error) => {
        // Observability must never be the reason an app falls over, but a
        // collector that silently eats every batch is worse than no collector.
        console.warn(`[glassfish-zero] ${error.message}`);
      });

    const fetchImpl = opts.fetch ?? globalThis.fetch;
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : undefined;

    if (this.options.disabled) {
      this.transport = null;
    } else if (!apiKey) {
      this.transport = null;
      onError(
        new Error('no API key configured (set GLASSFISH_API_KEY) — tracing is a no-op'),
      );
    } else if (typeof fetchImpl !== 'function') {
      this.transport = null;
      onError(new Error('global fetch is unavailable — pass options.fetch (Node 18+ required)'));
    } else {
      this.transport = new Transport({
        apiKey,
        baseUrl,
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        fetchImpl: fetchImpl.bind(globalThis),
        debug: this.options.debug,
        onError,
      });
      this.startTimer();
      if (opts.flushOnExit ?? true) this.registerExitHooks();
    }
  }

  // ---------------------------------------------------------------- tracing

  /**
   * Run `fn` inside a new trace. Every instrumented call made within it —
   * including from nested async functions — is attached to this trace.
   */
  async trace<T>(
    name: string,
    fn: (trace: TraceHandle) => Promise<T> | T,
    options: TraceOptions = {},
  ): Promise<T> {
    const context: ActiveContext = {
      traceId: options.traceId ?? newId('tr'),
      traceName: name,
      userRef: options.userRef,
      sessionRef: options.sessionRef,
      tags: options.tags,
      metadata: options.metadata,
    };
    const startedAt = now();
    const handle = new TraceHandle(this, context, startedAt);

    return runWithContext(context, async () => {
      try {
        const result = await fn(handle);
        handle.end('ok');
        return result;
      } catch (error) {
        handle.end('error', error);
        throw error;
      }
    });
  }

  /** Time an arbitrary step and attach it to the active trace. */
  async span<T>(
    name: string,
    fn: () => Promise<T> | T,
    options: Partial<SpanInput> = {},
  ): Promise<T> {
    const startedAt = now();
    try {
      const result = await fn();
      this.record({ kind: 'custom', ...options, name, status: 'ok', startedAt, endedAt: now() });
      return result;
    } catch (error) {
      const { type, message } = describeError(error);
      this.record({
        kind: 'custom',
        ...options,
        name,
        status: 'error',
        errorType: type,
        errorMessage: message,
        startedAt,
        endedAt: now(),
      });
      throw error;
    }
  }

  /** Enqueue a span. Never throws, never blocks. */
  record(span: SpanInput & { startedAt?: number; endedAt?: number }): void {
    if (!this.transport || this.closed) return;

    const context = getActiveContext();
    const startedAt = span.startedAt ?? now();
    const endedAt = span.endedAt ?? now();

    const payload: SpanPayload = {
      ...span,
      traceId: context?.traceId ?? newId('tr'),
      traceName: context?.traceName,
      spanId: newId('sp'),
      parentSpanId: context?.spanId ?? null,
      userRef: span.userRef ?? context?.userRef,
      sessionRef: span.sessionRef ?? context?.sessionRef,
      tags: { ...(context?.tags ?? {}), ...(span.tags ?? {}) },
      metadata: mergeMetadata(context?.metadata, span.metadata),
      status: span.status ?? 'ok',
      environment: this.options.environment,
      release: this.options.release,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
    };

    if (this.queue.length >= this.options.maxQueueSize) {
      this.droppedSpans += 1;
      if (this.droppedSpans === 1 || this.droppedSpans % 100 === 0) {
        console.warn(
          `[glassfish-zero] queue full (${this.options.maxQueueSize}); dropped ${this.droppedSpans} span(s)`,
        );
      }
      return;
    }

    this.queue.push(payload);
    if (this.queue.length >= this.options.batchSize) void this.flush();
  }

  // ------------------------------------------------------- instrumentation

  /** Wrap an Anthropic or OpenAI client; every call becomes a span. */
  observe<T extends object>(client: T, provider: ProviderHint = 'auto'): T {
    const hint = provider === 'auto' ? detectProvider(client) : provider;
    return instrumentClient(client, this.recorder(), hint);
  }

  observeAnthropic<T extends object>(client: T): T {
    return instrumentClient(client, this.recorder(), 'anthropic');
  }

  observeOpenAI<T extends object>(client: T): T {
    return instrumentClient(client, this.recorder(), 'openai');
  }

  private recorder(): Recorder {
    return {
      record: (span) => this.record(span),
      shouldCapturePayloads: () => this.options.capturePayloads,
      truncatePayload: (value) => truncate(value, this.options.payloadMaxChars),
    };
  }

  // ------------------------------------------------- evaluation & feedback

  /**
   * Authenticated JSON call against the dashboard API.
   *
   * Unlike span ingest, these calls **do** throw: an experiment that silently
   * failed to record its results is worse than one that stops and says so.
   */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) throw new Error('no API key configured (set GLASSFISH_API_KEY)');
    if (!this.fetchImpl) throw new Error('global fetch is unavailable (Node 18+ required)');

    const url = `${this.options.baseUrl.replace(/\/+$/, '')}${path}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 400);
      } catch {
        detail = '<unreadable body>';
      }
      throw new Error(`${method} ${path} failed with ${response.status}: ${detail}`);
    }

    return (await response.json()) as T;
  }

  readonly datasets = {
    /** Create or update a dataset and its examples. */
    push: async (
      name: string,
      examples: DatasetExample[],
      options: { description?: string } = {},
    ): Promise<{ id: string; written: number }> => {
      const result = await this.request<{ dataset: { id: string }; written: number }>(
        'POST',
        '/api/v1/datasets',
        { name, description: options.description, examples },
      );
      return { id: result.dataset.id, written: result.written };
    },

    /** Fetch a dataset's examples. */
    pull: async (
      name: string,
      options: { split?: string; limit?: number } = {},
    ): Promise<DatasetExample[]> => {
      const query = new URLSearchParams();
      if (options.split) query.set('split', options.split);
      if (options.limit) query.set('limit', String(options.limit));
      const suffix = query.toString() ? `?${query}` : '';
      const result = await this.request<{ examples: DatasetExample[] }>(
        'GET',
        `/api/v1/datasets/${encodeURIComponent(name)}${suffix}`,
      );
      return result.examples;
    },

    list: async (): Promise<{ id: string; name: string; exampleCount: number }[]> => {
      const result = await this.request<{
        datasets: { id: string; name: string; exampleCount: number }[];
      }>('GET', '/api/v1/datasets');
      return result.datasets;
    },
  };

  /** Run a dataset through a task, score every result, and record the run. */
  experiment<T>(options: ExperimentOptions<T>): Promise<ExperimentSummary> {
    return runExperiment<T>(
      {
        request: (method, path, body) => this.request(method, path, body),
        trace: (name, fn) => this.trace(name, (handle) => fn({ id: handle.id })),
        flush: () => this.flush(),
        baseUrl: this.options.baseUrl,
      },
      options,
    );
  }

  /**
   * Attach a judgement to a trace — a thumbs-up, a human rating, an automated
   * check. Lands in the same table as eval scores, so "was it good?" is one
   * question whether the answer came from a person or a scorer.
   */
  async feedback(payload: {
    traceId: string;
    name: string;
    value?: number;
    label?: string;
    comment?: string;
    source?: 'human' | 'judge' | 'code';
  }): Promise<void> {
    await this.request('POST', '/api/v1/scores', {
      ...payload,
      source: payload.source ?? 'code',
    });
  }

  // ------------------------------------------------------------- lifecycle

  /** Send everything queued. Safe to call as often as you like. */
  async flush(): Promise<FlushResult> {
    if (!this.transport) return { sent: 0, failed: 0 };
    // Serialise flushes so batches arrive in order and we never fan out.
    while (this.inFlight) await this.inFlight.catch(() => undefined);
    if (this.queue.length === 0) return { sent: 0, failed: 0 };

    const batch = this.queue.splice(0, this.queue.length);
    const promise = this.transport.send(batch);
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      this.inFlight = null;
    }
  }

  /** Flush and stop the background timer. Call before the process exits. */
  async shutdown(): Promise<FlushResult> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const result = await this.flush();
    this.closed = false;
    return result;
  }

  /** Spans dropped because the queue was full. Non-zero means under-reporting. */
  get dropped(): number {
    return this.droppedSpans;
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
    // A pending flush timer must not hold the event loop open.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private registerExitHooks(): void {
    if (typeof process === 'undefined' || typeof process.once !== 'function') return;
    const handler = () => {
      void this.flush();
    };
    process.once('beforeExit', handler);
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }
}

function mergeMetadata(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}
