/**
 * Ambient trace context.
 *
 * Uses AsyncLocalStorage where it exists (Node) so concurrent requests never
 * leak spans into each other's traces. Falls back to a single module-level
 * slot on runtimes without it — correct for sequential code, which is the
 * only thing that can work without continuation-local storage anyway.
 */

export interface ActiveContext {
  traceId: string;
  traceName?: string;
  spanId?: string;
  userRef?: string;
  sessionRef?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

type Storage<T> = {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
};

let storage: Storage<ActiveContext> | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const asyncHooks = require('node:async_hooks') as typeof import('node:async_hooks');
  storage = new asyncHooks.AsyncLocalStorage<ActiveContext>();
} catch {
  storage = null;
}

let fallbackStore: ActiveContext | undefined;

export function getActiveContext(): ActiveContext | undefined {
  return storage ? storage.getStore() : fallbackStore;
}

export function runWithContext<R>(context: ActiveContext, fn: () => R): R {
  if (storage) return storage.run(context, fn);

  const previous = fallbackStore;
  fallbackStore = context;
  try {
    const result = fn();
    if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
      return (result as unknown as Promise<unknown>).finally(() => {
        fallbackStore = previous;
      }) as unknown as R;
    }
    fallbackStore = previous;
    return result;
  } catch (error) {
    fallbackStore = previous;
    throw error;
  }
}

/** True when real continuation-local storage is available. */
export function hasAsyncContext(): boolean {
  return storage !== null;
}
