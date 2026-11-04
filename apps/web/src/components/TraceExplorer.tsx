'use client';

import { useState } from 'react';
import { Waterfall, type WaterfallSpan } from './charts';
import { formatDuration, formatTime, SPAN_KIND_LABELS } from './chart-utils';

export interface SpanDetail extends WaterfallSpan {
  provider: string | null;
  errorType: string | null;
  errorMessage: string | null;
  ttftMs: number | null;
  stream: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  inputChars: number;
  outputChars: number;
  costInput: number;
  costOutput: number;
  costCache: number;
  tags: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  inputPreview: string | null;
  outputPreview: string | null;
}

function usd(value: number): string {
  if (value === 0) return '$0';
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="tnum m-0 text-right">{value}</dd>
    </>
  );
}

export function TraceExplorer({
  spans,
  traceStart,
  traceDuration,
}: {
  spans: SpanDetail[];
  traceStart: number;
  traceDuration: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(spans[0]?.id ?? null);
  const selected = spans.find((s) => s.id === selectedId) ?? null;

  const promptTokens = selected
    ? selected.inputTokens + selected.cacheReadTokens + selected.cacheWriteTokens
    : 0;
  const charsPerToken =
    selected && promptTokens > 0 && selected.inputChars > 0
      ? selected.inputChars / promptTokens
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="card p-5">
        <h2 className="m-0 mb-4 text-base font-semibold">Span timeline</h2>
        <Waterfall
          spans={spans}
          traceStart={traceStart}
          traceDuration={traceDuration}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      <div className="card p-5">
        <h2 className="m-0 mb-4 text-base font-semibold">Span detail</h2>
        {!selected ? (
          <p className="m-0 text-sm text-ink-muted">Select a span to inspect it.</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <div className="font-medium">{selected.name}</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                {SPAN_KIND_LABELS[selected.kind] ?? selected.kind}
                {selected.provider ? ` · ${selected.provider}` : ''}
                {selected.stream === 1 ? ' · streamed' : ''}
              </div>
            </div>

            {selected.status === 'error' ? (
              <div className="rounded-lg border border-critical/45 px-3 py-2.5">
                <div className="font-medium text-danger-text">
                  <span aria-hidden>✕</span> {selected.errorType ?? 'Error'}
                </div>
                {selected.errorMessage ? (
                  <p className="m-0 mt-1 break-words text-xs text-ink-2">
                    {selected.errorMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
              <Row label="Started" value={formatTime(selected.startedAt)} />
              <Row label="Duration" value={formatDuration(selected.durationMs)} />
              {selected.ttftMs !== null ? (
                <Row label="Time to first token" value={formatDuration(selected.ttftMs)} />
              ) : null}
              {selected.model ? <Row label="Model" value={selected.model} /> : null}
            </dl>

            {selected.kind === 'llm' || selected.kind === 'embedding' ? (
              <>
                <div className="border-t border-hairline pt-3">
                  <h3 className="m-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Tokens
                  </h3>
                  <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
                    <Row label="Input" value={selected.inputTokens.toLocaleString('en-US')} />
                    <Row label="Output" value={selected.outputTokens.toLocaleString('en-US')} />
                    {selected.cacheReadTokens > 0 ? (
                      <Row
                        label="Cache read"
                        value={selected.cacheReadTokens.toLocaleString('en-US')}
                      />
                    ) : null}
                    {selected.cacheWriteTokens > 0 ? (
                      <Row
                        label="Cache write"
                        value={selected.cacheWriteTokens.toLocaleString('en-US')}
                      />
                    ) : null}
                    {selected.reasoningTokens > 0 ? (
                      <Row
                        label="Reasoning"
                        value={selected.reasoningTokens.toLocaleString('en-US')}
                      />
                    ) : null}
                    <Row
                      label="Prompt chars"
                      value={selected.inputChars.toLocaleString('en-US')}
                    />
                    <Row
                      label="Completion chars"
                      value={selected.outputChars.toLocaleString('en-US')}
                    />
                    {charsPerToken !== null ? (
                      <Row
                        label="Chars / token"
                        value={
                          <span title="Measured on this call. The model-swap simulator aggregates this across the project.">
                            {charsPerToken.toFixed(2)}
                          </span>
                        }
                      />
                    ) : null}
                  </dl>
                </div>

                <div className="border-t border-hairline pt-3">
                  <h3 className="m-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Cost
                  </h3>
                  {selected.priced === 1 ? (
                    <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
                      <Row label="Input" value={usd(selected.costInput)} />
                      <Row label="Output" value={usd(selected.costOutput)} />
                      {selected.costCache > 0 ? (
                        <Row label="Cache" value={usd(selected.costCache)} />
                      ) : null}
                      <Row
                        label="Total"
                        value={<strong>{usd(selected.costTotal)}</strong>}
                      />
                    </dl>
                  ) : (
                    <p className="m-0 text-xs text-warning">
                      <span aria-hidden>▲</span> No price configured for this model — cost is
                      unknown, not zero.
                    </p>
                  )}
                </div>
              </>
            ) : null}

            {selected.tags && Object.keys(selected.tags).length > 0 ? (
              <div className="border-t border-hairline pt-3">
                <h3 className="m-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Tags
                </h3>
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {Object.entries(selected.tags).map(([key, value]) => (
                    <li
                      key={key}
                      className="rounded border border-hairline-strong px-1.5 py-px text-xs text-ink-2"
                    >
                      {key}: {value}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selected.metadata && Object.keys(selected.metadata).length > 0 ? (
              <div className="border-t border-hairline pt-3">
                <h3 className="m-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Metadata
                </h3>
                <pre className="scroll-x m-0 rounded border border-hairline bg-surface-2 p-2.5 font-mono text-[11px]">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </div>
            ) : null}

            {selected.inputPreview || selected.outputPreview ? (
              <div className="border-t border-hairline pt-3">
                <h3 className="m-0 mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Payload
                </h3>
                {selected.inputPreview ? (
                  <details className="mb-2">
                    <summary className="cursor-pointer text-xs text-ink-2">Prompt</summary>
                    <pre className="scroll-x m-0 mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border border-hairline bg-surface-2 p-2.5 font-mono text-[11px]">
                      {selected.inputPreview}
                    </pre>
                  </details>
                ) : null}
                {selected.outputPreview ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-ink-2">Completion</summary>
                    <pre className="scroll-x m-0 mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border border-hairline bg-surface-2 p-2.5 font-mono text-[11px]">
                      {selected.outputPreview}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
