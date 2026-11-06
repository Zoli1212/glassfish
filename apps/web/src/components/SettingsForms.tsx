'use client';

import { useActionState, useState } from 'react';
import { applyRetentionAction, createApiKeyAction, setBudgetAction } from '@/app/actions';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { CopyField } from './CopyField';
import { resilient } from './resilient-action';

export function CreateKeyForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(createApiKeyAction, EMPTY_ACTION_STATE);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="slug" value={slug} />
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-xs">
          <span className="font-medium text-ink-2">Key name</span>
          <input name="name" className="field" placeholder="production" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>

      {state.secret ? (
        <div className="rounded-lg border border-good/45 p-4">
          <p className="m-0 mb-3 text-sm font-medium">{state.message}</p>
          <CopyField value={state.secret} />
          <p className="m-0 mt-2 text-xs text-ink-muted">
            Only a SHA-256 hash is stored, so this value cannot be recovered. Losing it costs you
            nothing but issuing a new key.
          </p>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="m-0 text-sm text-danger-text">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Deleting history is irreversible, so the horizon has to be typed twice —
 * once to choose it, once to confirm it. No single click can destroy data.
 */
export function RetentionForm({ slug }: { slug: string }) {
  const [days, setDays] = useState('90');
  const [state, formAction, pending] = useActionState(
    resilient(applyRetentionAction),
    EMPTY_ACTION_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-ink-2">Delete spans older than</span>
          <select
            name="days"
            className="field w-40"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          >
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-ink-2">
            Type <strong>{days}</strong> to confirm
          </span>
          <input name="confirm" className="field w-40" autoComplete="off" inputMode="numeric" />
        </label>
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? 'Deleting…' : 'Delete old spans'}
        </button>
      </div>

      {state.message ? (
        <p className="m-0 text-sm text-success-text">{state.message}</p>
      ) : null}
      {state.error ? (
        <p role="alert" className="m-0 text-sm text-danger-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function BudgetForm({ slug, current }: { slug: string; current: number | null }) {
  const [state, formAction, pending] = useActionState(
    resilient(setBudgetAction),
    EMPTY_ACTION_STATE,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="slug" value={slug} />
      <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-xs">
        <span className="font-medium text-ink-2">Monthly budget (USD)</span>
        <input
          name="budget"
          className="field"
          inputMode="decimal"
          placeholder="500"
          defaultValue={current ?? ''}
        />
        <span className="text-[11px] text-ink-muted">
          Leave empty to remove the budget. Month-to-date spend is compared against it on the
          overview.
        </span>
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      {state.message ? (
        <p className="m-0 w-full text-sm text-success-text">{state.message}</p>
      ) : null}
      {state.error ? (
        <p role="alert" className="m-0 w-full text-sm text-danger-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
