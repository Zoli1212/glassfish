import type { SpanInput, SpanKind } from './types';
import { describeError, isPlainObject, now, textLength, toNumber } from './utils';
import {
  extractModel,
  mergeUsage,
  normaliseUsage,
  requestChars,
  responseChars,
} from './usage';

export interface Recorder {
  record(span: SpanInput & { startedAt: number; endedAt: number }): void;
  shouldCapturePayloads(): boolean;
  truncatePayload(value: unknown): string | undefined;
}

interface MethodSpec {
  kind: SpanKind;
  provider: string;
  /** The method returns a stream object rather than a finished response. */
  alwaysStreaming?: boolean;
}

/**
 * Method paths we know how to read token usage from. Anything else on the
 * wrapped client is passed through untouched.
 */
const METHODS: Record<string, MethodSpec> = {
  // Anthropic
  'messages.create': { kind: 'llm', provider: 'anthropic' },
  'messages.stream': { kind: 'llm', provider: 'anthropic', alwaysStreaming: true },
  'beta.messages.create': { kind: 'llm', provider: 'anthropic' },
  'beta.messages.stream': { kind: 'llm', provider: 'anthropic', alwaysStreaming: true },
  'messages.countTokens': { kind: 'custom', provider: 'anthropic' },
  // OpenAI
  'chat.completions.create': { kind: 'llm', provider: 'openai' },
  'responses.create': { kind: 'llm', provider: 'openai' },
  'responses.stream': { kind: 'llm', provider: 'openai', alwaysStreaming: true },
  'completions.create': { kind: 'llm', provider: 'openai' },
  'embeddings.create': { kind: 'embedding', provider: 'openai' },
};

const PREFIXES = buildPrefixes(Object.keys(METHODS));

function buildPrefixes(paths: string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const path of paths) {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i += 1) {
      prefixes.add(parts.slice(0, i).join('.'));
    }
  }
  return prefixes;
}

export type ProviderHint = 'anthropic' | 'openai' | 'auto';

export function instrumentClient<T extends object>(
  client: T,
  recorder: Recorder,
  hint: ProviderHint = 'auto',
): T {
  return wrap(client, '', recorder, hint) as T;
}

/** Best-effort detection so `observe()` can take either SDK without being told. */
export function detectProvider(client: unknown): ProviderHint {
  if (!client || typeof client !== 'object') return 'auto';
  const obj = client as Record<string, unknown>;
  if (isPlainObject(obj.messages) && 'create' in (obj.messages as object)) return 'anthropic';
  if (isPlainObject(obj.chat) || isPlainObject(obj.responses)) return 'openai';
  return 'auto';
}

function wrap(
  target: object,
  path: string,
  recorder: Recorder,
  hint: ProviderHint,
): object {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof prop === 'symbol') return bindIfFunction(value, obj);

      const nextPath = path ? `${path}.${prop}` : prop;
      const spec = METHODS[nextPath];

      if (typeof value === 'function') {
        if (spec) return wrapMethod(value as AnyFn, obj, nextPath, spec, recorder, hint);
        // Always bind to the real object: SDK methods that touch private
        // class fields throw if `this` is a Proxy.
        return (value as AnyFn).bind(obj);
      }

      if (value && typeof value === 'object' && PREFIXES.has(nextPath)) {
        return wrap(value as object, nextPath, recorder, hint);
      }

      return value;
    },
  });
}

type AnyFn = (...args: unknown[]) => unknown;

function bindIfFunction(value: unknown, obj: object): unknown {
  return typeof value === 'function' ? (value as AnyFn).bind(obj) : value;
}

function wrapMethod(
  original: AnyFn,
  self: object,
  path: string,
  spec: MethodSpec,
  recorder: Recorder,
  hint: ProviderHint,
): AnyFn {
  return function instrumented(...args: unknown[]) {
    const params = args[0];
    const startedAt = now();
    const provider = hint === 'auto' ? spec.provider : hint;
    const base = {
      name: path,
      kind: spec.kind,
      provider,
      model: isPlainObject(params) && typeof params.model === 'string' ? params.model : undefined,
      chars: { input: requestChars(params), output: 0 },
      input: recorder.shouldCapturePayloads()
        ? recorder.truncatePayload(isPlainObject(params) ? params.messages ?? params.input : params)
        : undefined,
      metadata: requestMetadata(params),
    } satisfies SpanInput;

    let result: unknown;
    try {
      result = original.apply(self, args);
    } catch (error) {
      recordFailure(recorder, base, startedAt, error);
      throw error;
    }

    const wantsStream = spec.alwaysStreaming || (isPlainObject(params) && params.stream === true);

    if (isPromise(result)) {
      return result.then(
        (value) => {
          if (wantsStream && isStreamLike(value)) {
            return instrumentStream(value, recorder, base, startedAt);
          }
          recordSuccess(recorder, base, startedAt, params, value);
          return value;
        },
        (error) => {
          recordFailure(recorder, base, startedAt, error);
          throw error;
        },
      );
    }

    if (wantsStream && isStreamLike(result)) {
      return instrumentStream(result, recorder, base, startedAt);
    }

    recordSuccess(recorder, base, startedAt, params, result);
    return result;
  };
}

function requestMetadata(params: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(params)) return undefined;
  const metadata: Record<string, unknown> = {};
  const maxTokens = toNumber(params.max_tokens) ?? toNumber(params.max_output_tokens);
  if (maxTokens !== undefined) metadata.maxTokens = maxTokens;
  if (isPlainObject(params.thinking) && typeof params.thinking.type === 'string') {
    metadata.thinking = params.thinking.type;
  }
  if (isPlainObject(params.output_config) && params.output_config.effort !== undefined) {
    metadata.effort = params.output_config.effort;
  }
  if (Array.isArray(params.tools)) metadata.toolCount = params.tools.length;
  if (typeof params.speed === 'string') metadata.speed = params.speed;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function recordSuccess(
  recorder: Recorder,
  base: SpanInput,
  startedAt: number,
  params: unknown,
  result: unknown,
): void {
  const endedAt = now();
  const usage = normaliseUsage(isPlainObject(result) ? result.usage : undefined);
  recorder.record({
    ...base,
    status: 'ok',
    model: extractModel(params, result) ?? base.model,
    usage,
    chars: { input: base.chars?.input ?? 0, output: responseChars(result) },
    output: recorder.shouldCapturePayloads()
      ? recorder.truncatePayload(extractOutputForPreview(result))
      : undefined,
    metadata: withStopReason(base.metadata, result),
    startedAt,
    endedAt,
  });
}

function recordFailure(
  recorder: Recorder,
  base: SpanInput,
  startedAt: number,
  error: unknown,
): void {
  const { type, message } = describeError(error);
  recorder.record({
    ...base,
    status: 'error',
    errorType: type,
    errorMessage: message,
    startedAt,
    endedAt: now(),
  });
}

function withStopReason(
  metadata: Record<string, unknown> | undefined,
  result: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(result)) return metadata;
  const stopReason = result.stop_reason ?? result.finish_reason;
  if (stopReason === undefined || stopReason === null) return metadata;
  return { ...(metadata ?? {}), stopReason };
}

function extractOutputForPreview(result: unknown): unknown {
  if (!isPlainObject(result)) return result;
  if ('content' in result) return result.content;
  if ('output_text' in result) return result.output_text;
  if ('output' in result) return result.output;
  if ('choices' in result) return result.choices;
  return undefined;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return isThenable(value);
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isStreamLike(value: unknown): value is AsyncIterable<unknown> & object {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<PropertyKey, unknown>)[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Wrap a provider stream so iterating it also accumulates usage.
 *
 * The caller still gets every chunk, in order, unchanged. Usage is recorded
 * exactly once — whichever of iteration, `finalMessage()` or an error
 * finishes first wins.
 */
function instrumentStream(
  stream: AsyncIterable<unknown> & object,
  recorder: Recorder,
  base: SpanInput,
  startedAt: number,
): object {
  const state: StreamState = {
    startedAt,
    usage: {},
    model: base.model,
    outputChars: 0,
    ttftMs: undefined,
    done: false,
  };

  const finish = (status: 'ok' | 'error', error?: unknown) => {
    if (state.done) return;
    state.done = true;
    const failure = error !== undefined ? describeError(error) : undefined;
    recorder.record({
      ...base,
      status,
      stream: true,
      model: state.model,
      usage: state.usage,
      chars: { input: base.chars?.input ?? 0, output: state.outputChars },
      ttftMs: state.ttftMs,
      errorType: failure?.type,
      errorMessage: failure?.message,
      startedAt,
      endedAt: now(),
    });
  };

  return new Proxy(stream, {
    get(obj, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        const iterate = Reflect.get(obj, prop, receiver) as () => AsyncIterator<unknown>;
        return function instrumentedIterator() {
          return observeIterator(iterate.call(obj), state, finish);
        };
      }

      const value = Reflect.get(obj, prop, receiver);

      if (prop === 'finalMessage' && typeof value === 'function') {
        return function instrumentedFinalMessage(...args: unknown[]) {
          const promise = (value as AnyFn).apply(obj, args) as Promise<unknown>;
          return promise.then(
            (message) => {
              absorb(state, message);
              finish('ok');
              return message;
            },
            (error) => {
              finish('error', error);
              throw error;
            },
          );
        };
      }

      return typeof value === 'function' ? (value as AnyFn).bind(obj) : value;
    },
  });
}

async function* observeIterator(
  iterator: AsyncIterator<unknown>,
  state: StreamState,
  finish: (status: 'ok' | 'error', error?: unknown) => void,
): AsyncGenerator<unknown> {
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      absorb(state, next.value);
      yield next.value;
    }
    finish('ok');
  } catch (error) {
    finish('error', error);
    throw error;
  } finally {
    if (typeof iterator.return === 'function') {
      // Consumer broke out early — let the provider release the connection.
      await iterator.return(undefined).catch(() => undefined);
    }
  }
}

interface StreamState {
  startedAt: number;
  usage: ReturnType<typeof normaliseUsage>;
  model?: string;
  outputChars: number;
  ttftMs?: number;
  done: boolean;
}

/** Fold one streamed chunk (or the final message) into the accumulated state. */
function absorb(state: StreamState, chunk: unknown): void {
  if (!isPlainObject(chunk)) return;

  if (typeof chunk.model === 'string') state.model = chunk.model;

  if (chunk.usage !== undefined) {
    state.usage = mergeUsage(state.usage, normaliseUsage(chunk.usage));
  }
  // Anthropic reports the prompt size inside message_start's nested message.
  if (isPlainObject(chunk.message)) {
    const nested = chunk.message;
    if (typeof nested.model === 'string') state.model = nested.model;
    if (nested.usage !== undefined) {
      state.usage = mergeUsage(state.usage, normaliseUsage(nested.usage));
    }
  }

  const deltaChars = streamDeltaChars(chunk);
  if (deltaChars > 0) {
    if (state.ttftMs === undefined) state.ttftMs = now() - state.startedAt;
    state.outputChars += deltaChars;
  }
}

function streamDeltaChars(chunk: Record<string, unknown>): number {
  if (isPlainObject(chunk.delta)) {
    const delta = chunk.delta;
    if (typeof delta.text === 'string') return delta.text.length;
    if (typeof delta.thinking === 'string') return delta.thinking.length;
    if (typeof delta.partial_json === 'string') return delta.partial_json.length;
    if (typeof delta.content === 'string') return delta.content.length;
  }
  if (Array.isArray(chunk.choices)) {
    let total = 0;
    for (const choice of chunk.choices) {
      if (isPlainObject(choice) && isPlainObject(choice.delta)) {
        total += textLength(choice.delta.content);
      }
    }
    return total;
  }
  if (Array.isArray(chunk.content)) return textLength(chunk.content);
  return 0;
}
