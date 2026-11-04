/** Public types for the glassfish-zero SDK. */

export type SpanKind = 'llm' | 'embedding' | 'tool' | 'retrieval' | 'chain' | 'custom';
export type SpanStatus = 'ok' | 'error';

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens served from the provider's prompt cache (billed at a reduced rate). */
  cacheReadTokens?: number;
  /** Tokens written into the provider's prompt cache (billed at a premium). */
  cacheWriteTokens?: number;
  /** Thinking / reasoning tokens, when the provider reports them separately. */
  reasoningTokens?: number;
}

/**
 * Raw character counts of the prompt and completion.
 *
 * These are what make honest model-swap comparison possible: tokens are
 * model-specific, characters are not. The server derives a measured
 * tokens-per-character ratio per model from these and uses it to project what
 * the same workload would have cost on a different model.
 */
export interface CharCounts {
  input?: number;
  output?: number;
}

export interface SpanInput {
  name: string;
  kind?: SpanKind;
  provider?: string;
  model?: string;
  usage?: TokenUsage;
  chars?: CharCounts;
  status?: SpanStatus;
  errorType?: string;
  errorMessage?: string;
  /** Truncated prompt text, for debugging. Omitted entirely when capture is off. */
  input?: string;
  /** Truncated completion text, for debugging. Omitted entirely when capture is off. */
  output?: string;
  metadata?: Record<string, unknown>;
  tags?: Record<string, string>;
  userRef?: string;
  sessionRef?: string;
  stream?: boolean;
  /** Time to first token, milliseconds. Streaming calls only. */
  ttftMs?: number;
}

/** The wire shape sent to POST /api/v1/ingest. One per recorded operation. */
export interface SpanPayload extends SpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  traceName?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  environment?: string;
  release?: string;
}

export interface GlassfishOptions {
  /** Project API key, `gfz_...`. Falls back to process.env.GLASSFISH_API_KEY. */
  apiKey?: string;
  /** Base URL of your Glassfish Zero instance. Falls back to GLASSFISH_BASE_URL. */
  baseUrl?: string;
  /** Logical environment name recorded on every span. Default: NODE_ENV or 'development'. */
  environment?: string;
  /** Release / build identifier recorded on every span. */
  release?: string;
  /**
   * Record truncated prompt and completion text. Default false — turn it on
   * deliberately, since it sends user content to the collector.
   */
  capturePayloads?: boolean;
  /** Max characters of prompt/completion kept when capturePayloads is on. Default 2000. */
  payloadMaxChars?: number;
  /** Flush when this many spans are queued. Default 25. */
  batchSize?: number;
  /** Flush at least this often, milliseconds. Default 5000. */
  flushIntervalMs?: number;
  /** Drop spans once the queue exceeds this, to bound memory. Default 10000. */
  maxQueueSize?: number;
  /** Network timeout per flush attempt, milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Retries per batch before dropping it. Default 3. */
  maxRetries?: number;
  /** Turn the SDK into a no-op without removing the calls. Default false. */
  disabled?: boolean;
  /** Print internal diagnostics to console. Default false. */
  debug?: boolean;
  /** Register process exit hooks to flush pending spans. Default true. */
  flushOnExit?: boolean;
  /** Replace the fetch implementation (tests, proxies, custom agents). */
  fetch?: typeof fetch;
  /** Called on transport failure. Default: console.warn when debug is on. */
  onError?: (error: Error) => void;
}

export interface TraceOptions {
  traceId?: string;
  userRef?: string;
  sessionRef?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface FlushResult {
  sent: number;
  failed: number;
}
