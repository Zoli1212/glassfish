'use client';

import { useActionState, useState } from 'react';
import { repriceHistoryAction, upsertPriceAction } from '@/app/actions';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import type { ModelPrice } from '@/lib/pricing';
import { Badge } from './ui';

export interface PriceUsage {
  model: string;
  calls: number;
  tokens: number;
}

const BLANK: ModelPrice = {
  model: '',
  provider: '',
  displayName: '',
  family: 'generic',
  inputPerMTok: null,
  outputPerMTok: null,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
  contextWindow: null,
  maxOutput: null,
  verified: false,
  source: '',
  active: true,
  updatedAt: 0,
};

function rate(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

export function PriceTable({
  slug,
  prices,
  families,
  usage,
}: {
  slug: string;
  prices: ModelPrice[];
  families: { id: string; label: string }[];
  usage: PriceUsage[];
}) {
  const [editing, setEditing] = useState<ModelPrice | null>(null);
  const [state, formAction, pending] = useActionState(upsertPriceAction, EMPTY_ACTION_STATE);
  const [repriceState, repriceAction, repricing] = useActionState(
    repriceHistoryAction,
    EMPTY_ACTION_STATE,
  );

  const usageByModel = new Map(usage.map((u) => [u.model, u]));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setEditing(editing?.model === '' ? null : { ...BLANK })}
          >
            Add a model
          </button>
        </div>
        <form action={repriceAction}>
          <input type="hidden" name="slug" value={slug} />
          <button type="submit" className="btn btn-primary" disabled={repricing}>
            {repricing ? 'Re-pricing…' : 'Re-price history'}
          </button>
        </form>
      </div>

      {repriceState.message ? (
        <p className="m-0 text-sm text-success-text">{repriceState.message}</p>
      ) : null}
      {state.message ? <p className="m-0 text-sm text-success-text">{state.message}</p> : null}
      {state.error ? (
        <p role="alert" className="m-0 text-sm text-danger-text">
          {state.error}
        </p>
      ) : null}

      {editing ? (
        <form
          action={formAction}
          className="card flex flex-col gap-4 p-5"
          key={editing.model || 'new'}
        >
          <input type="hidden" name="slug" value={slug} />
          <h3 className="m-0 text-sm font-semibold">
            {editing.model ? `Edit ${editing.model}` : 'Add a model'}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Model id" hint="Exactly as the provider reports it">
              <input
                name="model"
                className="field font-mono text-xs"
                defaultValue={editing.model}
                readOnly={Boolean(editing.model)}
                required
              />
            </Field>
            <Field label="Display name">
              <input name="displayName" className="field" defaultValue={editing.displayName} />
            </Field>
            <Field label="Provider">
              <input name="provider" className="field" defaultValue={editing.provider} />
            </Field>
            <Field label="Tokenizer family" hint="Used when there is too little traffic to measure">
              <select name="family" className="field" defaultValue={editing.family}>
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Input $ / 1M tokens">
              <input
                name="inputPerMTok"
                className="field"
                inputMode="decimal"
                defaultValue={editing.inputPerMTok ?? ''}
              />
            </Field>
            <Field label="Output $ / 1M tokens">
              <input
                name="outputPerMTok"
                className="field"
                inputMode="decimal"
                defaultValue={editing.outputPerMTok ?? ''}
              />
            </Field>
            <Field label="Cache read $ / 1M" hint="Blank falls back to the input rate">
              <input
                name="cacheReadPerMTok"
                className="field"
                inputMode="decimal"
                defaultValue={editing.cacheReadPerMTok ?? ''}
              />
            </Field>
            <Field label="Cache write $ / 1M" hint="Blank falls back to the input rate">
              <input
                name="cacheWritePerMTok"
                className="field"
                inputMode="decimal"
                defaultValue={editing.cacheWritePerMTok ?? ''}
              />
            </Field>
            <Field label="Context window">
              <input
                name="contextWindow"
                className="field"
                inputMode="numeric"
                defaultValue={editing.contextWindow ?? ''}
              />
            </Field>
            <Field label="Max output tokens">
              <input
                name="maxOutput"
                className="field"
                inputMode="numeric"
                defaultValue={editing.maxOutput ?? ''}
              />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="verified"
              defaultChecked={editing.verified}
              className="mt-1"
            />
            <span>
              <span className="font-medium">I confirmed these rates against the provider.</span>
              <span className="block text-xs text-ink-2">
                Unverified rates stay flagged wherever they contribute to a cost figure.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save price'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <p className="m-0 text-xs text-ink-muted">
            Saving affects new spans immediately. Use <strong>Re-price history</strong> to apply
            it to spans already recorded.
          </p>
        </form>
      ) : null}

      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th className="num">Input / 1M</th>
              <th className="num">Output / 1M</th>
              <th className="num">Cache read</th>
              <th className="num">Cache write</th>
              <th>Status</th>
              <th className="num">Used here</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prices.map((price) => {
              const used = usageByModel.get(price.model);
              const unpriced = price.inputPerMTok === null || price.outputPerMTok === null;
              return (
                <tr key={price.model}>
                  <td>
                    <div className="font-mono text-xs">{price.model}</div>
                    <div className="text-[11px] text-ink-muted">{price.displayName}</div>
                  </td>
                  <td className="text-ink-2">{price.provider}</td>
                  <td className="num tnum">{rate(price.inputPerMTok)}</td>
                  <td className="num tnum">{rate(price.outputPerMTok)}</td>
                  <td className="num tnum">{rate(price.cacheReadPerMTok)}</td>
                  <td className="num tnum">{rate(price.cacheWritePerMTok)}</td>
                  <td>
                    {unpriced ? (
                      <Badge tone="critical" title="Spans on this model record no cost">
                        ✕ unpriced
                      </Badge>
                    ) : price.verified ? (
                      <Badge tone="good">✓ verified</Badge>
                    ) : (
                      <Badge tone="warning" title={price.source}>
                        ▲ unverified
                      </Badge>
                    )}
                  </td>
                  <td className="num tnum">
                    {used ? used.calls.toLocaleString('en-US') : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-xs"
                      onClick={() => setEditing(price)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ink-muted">{hint}</span> : null}
    </label>
  );
}
