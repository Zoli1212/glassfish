'use client';

import { useActionState } from 'react';
import { addFeedbackAction, deleteFeedbackAction } from '@/app/actions';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { resilient } from './resilient-action';
import { Badge } from './ui';
import { formatRelative } from './chart-utils';

export interface TraceScore {
  id: string;
  name: string;
  value: number | null;
  label: string | null;
  comment: string | null;
  source: string;
  judgeModel: string | null;
  createdAt: number;
}

const SOURCE_TONE: Record<string, 'neutral' | 'info' | 'good'> = {
  human: 'good',
  judge: 'info',
  code: 'neutral',
};

export function FeedbackPanel({
  slug,
  traceId,
  scores,
}: {
  slug: string;
  traceId: string;
  scores: TraceScore[];
}) {
  const [state, formAction, pending] = useActionState(
    resilient(addFeedbackAction),
    EMPTY_ACTION_STATE,
  );

  return (
    <div className="flex flex-col gap-4">
      {scores.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {scores.map((score) => (
            <li
              key={score.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-hairline px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{score.name}</span>
                  {score.value !== null ? (
                    <span
                      className={`tnum ${
                        score.value >= 0.999
                          ? 'text-success-text'
                          : score.value <= 0.001
                            ? 'text-danger-text'
                            : ''
                      }`}
                    >
                      {score.value.toFixed(2)}
                    </span>
                  ) : null}
                  {score.label ? <span className="text-ink-2">{score.label}</span> : null}
                  <Badge tone={SOURCE_TONE[score.source] ?? 'neutral'}>
                    {score.source === 'judge' && score.judgeModel
                      ? `judge · ${score.judgeModel}`
                      : score.source}
                  </Badge>
                </div>
                {score.comment ? (
                  <p className="m-0 mt-1 text-xs text-ink-2">{score.comment}</p>
                ) : null}
                <p className="m-0 mt-1 text-[11px] text-ink-muted">
                  {formatRelative(score.createdAt)}
                </p>
              </div>
              {score.source === 'human' ? (
                <form action={deleteFeedbackAction} className="shrink-0">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="traceId" value={traceId} />
                  <input type="hidden" name="scoreId" value={score.id} />
                  <button
                    type="submit"
                    className="btn btn-ghost px-2 py-1 text-xs"
                    title="Remove this feedback"
                  >
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-ink-muted">
          No judgements on this trace yet. Rate it below, or send scores from code with{' '}
          <code className="font-mono">gf.feedback(…)</code>.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="traceId" value={traceId} />

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-ink-2">Name</span>
            <input name="name" className="field w-36" defaultValue="quality" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-ink-2">Rating</span>
            <select name="value" className="field w-40" defaultValue="1">
              <option value="1">👍 Good (1)</option>
              <option value="0.5">Mixed (0.5)</option>
              <option value="0">👎 Bad (0)</option>
              <option value="">No rating, comment only</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-ink-2">Comment</span>
          <textarea
            name="comment"
            className="field min-h-16"
            placeholder="What was wrong, or what made this a good answer?"
          />
        </label>

        {state.message ? (
          <p className="m-0 text-sm text-success-text">{state.message}</p>
        ) : null}
        {state.error ? (
          <p role="alert" className="m-0 text-sm text-danger-text">
            {state.error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary self-start" disabled={pending}>
          {pending ? 'Saving…' : 'Record feedback'}
        </button>
      </form>
    </div>
  );
}
