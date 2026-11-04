export { Glassfish, TraceHandle } from './client';
export type {
  CharCounts,
  FlushResult,
  GlassfishOptions,
  SpanInput,
  SpanKind,
  SpanPayload,
  SpanStatus,
  TokenUsage,
  TraceOptions,
} from './types';
export { normaliseUsage } from './usage';
export { SDK_NAME, SDK_VERSION } from './transport';

import { Glassfish, type TraceHandle as TraceHandleType } from './client';
import type { GlassfishOptions } from './types';

let singleton: Glassfish | null = null;

/**
 * Process-wide client, configured from the environment.
 *
 * `init()` is optional — the first call to `glassfish()` creates one from
 * GLASSFISH_API_KEY / GLASSFISH_BASE_URL. Call `init()` when you need to pass
 * options in code.
 */
export function init(options: GlassfishOptions = {}): Glassfish {
  singleton = new Glassfish(options);
  return singleton;
}

export function glassfish(): Glassfish {
  if (!singleton) singleton = new Glassfish();
  return singleton;
}

/** Shorthand for `glassfish().trace(...)`. */
export function trace<T>(
  name: string,
  fn: (trace: TraceHandleType) => Promise<T> | T,
  options?: import('./types').TraceOptions,
): Promise<T> {
  return glassfish().trace(name, fn, options);
}

/** Shorthand for `glassfish().observe(client)`. */
export function observe<T extends object>(client: T): T {
  return glassfish().observe(client);
}

/** Shorthand for `glassfish().flush()`. */
export function flush(): Promise<import('./types').FlushResult> {
  return glassfish().flush();
}
