/**
 * Shared return type for server actions.
 *
 * Lives outside the `"use server"` module on purpose: a server-action file
 * may only export async functions, so a type exported from there breaks the
 * dev server rather than failing typecheck.
 */
export interface ActionState {
  error?: string;
  message?: string;
  /** Plaintext API key. Returned exactly once, never persisted. */
  secret?: string;
  /** Slug of a project the action just created. */
  slug?: string;
}

export const EMPTY_ACTION_STATE: ActionState = {};
