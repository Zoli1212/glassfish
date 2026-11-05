'use client';

import type { ActionState } from '@/lib/action-state';

/**
 * Next signals navigation and not-found by throwing. Those must reach the
 * framework untouched — swallowing them turns a successful redirect into a
 * silent no-op.
 */
function isFrameworkControlFlow(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

/**
 * Wrap a server action so a transport failure becomes a message the person
 * can act on, instead of React's generic "Application error" page.
 *
 * This is the difference between a deploy restart, a dropped connection or a
 * cold start reading as "try again in a moment" versus looking like the app
 * is broken — which is exactly what it looked like the first time this
 * instance was deployed under a live session.
 */
export function resilient<T extends ActionState>(
  action: (prev: T, formData: FormData) => Promise<T>,
): (prev: T, formData: FormData) => Promise<T> {
  return async (prev, formData) => {
    try {
      return await action(prev, formData);
    } catch (error) {
      if (isFrameworkControlFlow(error)) throw error;
      return {
        ...prev,
        secret: undefined,
        message: undefined,
        error:
          'Could not reach the server — it may be restarting. Wait a moment and try again; nothing was saved.',
      } as T;
    }
  };
}
