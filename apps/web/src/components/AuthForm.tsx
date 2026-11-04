'use client';

import { useActionState } from 'react';
import { loginAction, registerAction } from '@/app/actions';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const action = mode === 'login' ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3.5">
      {mode === 'register' ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Name</span>
          <input name="name" className="field" autoComplete="name" required />
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Email</span>
        <input name="email" type="email" className="field" autoComplete="email" required />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          className="field"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 8 : undefined}
          required
        />
        {mode === 'register' ? (
          <span className="text-xs text-ink-muted">At least 8 characters.</span>
        ) : null}
      </label>

      {state.error ? (
        <p role="alert" className="m-0 text-sm text-danger-text">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary mt-1" disabled={pending}>
        {pending ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}
