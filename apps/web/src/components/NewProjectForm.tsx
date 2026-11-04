'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { createProjectAction } from '@/app/actions';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { CopyField } from './CopyField';

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProjectAction, EMPTY_ACTION_STATE);

  if (state.secret && state.slug) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm">{state.message}</p>
        <CopyField label="API key" value={state.secret} />
        <p className="m-0 text-xs text-ink-muted">
          Only a hash is stored, so this value cannot be shown again. Lose it and you issue a new
          key — nothing else breaks.
        </p>
        <Link href={`/p/${state.slug}`} className="btn btn-primary self-start">
          Open project
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm">
        <span className="font-medium">Project name</span>
        <input name="name" className="field" placeholder="Support assistant" required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Creating…' : 'Create project'}
      </button>
      {state.error ? (
        <p role="alert" className="m-0 w-full text-sm text-danger-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
