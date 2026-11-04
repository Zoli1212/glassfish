'use client';

import { useMemo, useState } from 'react';
import {
  compactNumber,
  compactUsd,
  formatBucketLabel,
  formatDuration,
  niceMax,
  sparseIndices,
  spanKindColor,
  SPAN_KIND_LABELS,
  ticks,
} from './chart-utils';

/* ------------------------------------------------------------------ shared */

/**
 * Positioned in percentages of the figure, because the SVG scales to its
 * container — pixel offsets computed against the viewBox would drift.
 */
function Tooltip({
  leftPct,
  topPx,
  children,
}: {
  leftPct: number;
  topPx: number;
  children: React.ReactNode;
}) {
  // Flip to the left of the cursor near the right edge so the box never
  // pushes the page into a horizontal scroll.
  const flip = leftPct > 60;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-xs shadow-lg"
      style={{
        left: flip ? undefined : `calc(${leftPct}% + 12px)`,
        right: flip ? `calc(${100 - leftPct}% + 12px)` : undefined,
        top: topPx,
      }}
    >
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-hairline-strong text-sm text-ink-muted">
      {message}
    </div>
  );
}

/* -------------------------------------------------------- cost time series */

export interface SeriesPoint {
  bucket: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  errors: number;
}

/**
 * Cost over time.
 *
 * One measure, one axis. Token volume lives in its own chart below rather
 * than on a second y-scale — a dual-axis chart invites a comparison the
 * geometry does not support.
 */
export function CostOverTime({ data }: { data: SeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <EmptyChart message="No traffic in this range yet." />;

  const width = 720;
  const height = 220;
  const pad = { top: 12, right: 16, bottom: 26, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = niceMax(Math.max(...data.map((d) => d.cost)));
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xOf = (i: number) => pad.left + (data.length > 1 ? i * stepX : plotW / 2);
  const yOf = (v: number) => pad.top + plotH - (v / max) * plotH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i)},${yOf(d.cost)}`).join(' ');
  const area = `${line} L${xOf(data.length - 1)},${pad.top + plotH} L${xOf(0)},${pad.top + plotH} Z`;
  const labelled = sparseIndices(data.length, 7);
  const active = hover !== null ? data[hover] : null;

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Spend over time"
        onMouseLeave={() => setHover(null)}
      >
        {ticks(max).map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text x={pad.left - 8} y={yOf(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              {compactUsd(t)}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="gfz-cost-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#gfz-cost-fill)" />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />

        {active && hover !== null ? (
          <>
            <line
              x1={xOf(hover)}
              x2={xOf(hover)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle
              cx={xOf(hover)}
              cy={yOf(active.cost)}
              r={5}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </>
        ) : null}

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />

        {data.map((d, i) =>
          labelled.has(i) ? (
            <text
              key={d.bucket}
              x={xOf(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--ink-muted)"
            >
              {formatBucketLabel(d.bucket)}
            </text>
          ) : null,
        )}

        {/* Hit targets are wider than the marks they select. */}
        {data.map((d, i) => (
          <rect
            key={`hit-${d.bucket}`}
            x={xOf(i) - Math.max(stepX, 12) / 2}
            y={pad.top}
            width={Math.max(stepX, 12)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && hover !== null ? (
        <Tooltip leftPct={(xOf(hover) / width) * 100} topPx={16}>
          <div className="font-medium">{formatBucketLabel(active.bucket)}</div>
          <dl className="m-0 mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            <dt className="text-ink-2">Spend</dt>
            <dd className="tnum m-0 text-right">{compactUsd(active.cost)}</dd>
            <dt className="text-ink-2">Input tokens</dt>
            <dd className="tnum m-0 text-right">{compactNumber(active.inputTokens)}</dd>
            <dt className="text-ink-2">Output tokens</dt>
            <dd className="tnum m-0 text-right">{compactNumber(active.outputTokens)}</dd>
            <dt className="text-ink-2">LLM calls</dt>
            <dd className="tnum m-0 text-right">{active.calls}</dd>
            {active.errors > 0 ? (
              <>
                <dt className="text-danger-text">Errors</dt>
                <dd className="tnum m-0 text-right text-danger-text">{active.errors}</dd>
              </>
            ) : null}
          </dl>
        </Tooltip>
      ) : null}
    </figure>
  );
}

/* --------------------------------------------------------- token volume */

export function TokenVolume({ data }: { data: SeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;

  const width = 720;
  const height = 150;
  const pad = { top: 10, right: 16, bottom: 24, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = niceMax(Math.max(...data.map((d) => d.inputTokens + d.outputTokens)));
  const slot = plotW / data.length;
  const barW = Math.max(2, slot - 3);
  const yOf = (v: number) => pad.top + plotH - (v / max) * plotH;
  const labelled = sparseIndices(data.length, 7);
  const active = hover !== null ? data[hover] : null;

  return (
    <figure className="relative m-0">
      <figcaption className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Token volume</span>
        <Legend
          items={[
            { label: 'Input', color: 'var(--series-1)' },
            { label: 'Output', color: 'var(--series-2)' },
          ]}
        />
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Input and output token volume over time"
        onMouseLeave={() => setHover(null)}
      >
        {ticks(max, 2).map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text x={pad.left - 8} y={yOf(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              {compactNumber(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const inputH = (d.inputTokens / max) * plotH;
          const outputH = (d.outputTokens / max) * plotH;
          const baseY = pad.top + plotH;
          return (
            <g key={d.bucket} opacity={hover === null || hover === i ? 1 : 0.45}>
              {/* 2px surface gap between stacked segments. */}
              <rect
                x={x}
                y={baseY - inputH}
                width={barW}
                height={Math.max(0, inputH)}
                fill="var(--series-1)"
              />
              <rect
                x={x}
                y={baseY - inputH - outputH - 2}
                width={barW}
                height={Math.max(0, outputH)}
                rx={Math.min(4, barW / 2)}
                fill="var(--series-2)"
              />
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        {data.map((d, i) =>
          labelled.has(i) ? (
            <text
              key={`l-${d.bucket}`}
              x={pad.left + i * slot + slot / 2}
              y={height - 7}
              textAnchor="middle"
              fontSize={11}
              fill="var(--ink-muted)"
            >
              {formatBucketLabel(d.bucket)}
            </text>
          ) : null,
        )}
      </svg>

      {active && hover !== null ? (
        <Tooltip leftPct={((pad.left + hover * slot + slot / 2) / width) * 100} topPx={34}>
          <div className="font-medium">{formatBucketLabel(active.bucket)}</div>
          <dl className="m-0 mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            <dt className="text-ink-2">Input</dt>
            <dd className="tnum m-0 text-right">{active.inputTokens.toLocaleString('en-US')}</dd>
            <dt className="text-ink-2">Output</dt>
            <dd className="tnum m-0 text-right">{active.outputTokens.toLocaleString('en-US')}</dd>
          </dl>
        </Tooltip>
      ) : null}
    </figure>
  );
}

/* ----------------------------------------------------------------- bar list */

export interface BarItem {
  label: string;
  value: number;
  caption?: string;
  href?: string;
}

/**
 * Ranked magnitude. One hue for every bar: colour here would encode rank,
 * and rank is already encoded by position and length.
 *
 * The formatter is named rather than passed as a function, because a server
 * component cannot hand a function to a client component.
 */
export function BarList({
  items,
  format = 'number',
  emptyMessage = 'Nothing to show yet.',
}: {
  items: BarItem[];
  format?: 'number' | 'usd';
  emptyMessage?: string;
}) {
  const formatValue = format === 'usd' ? compactUsd : compactNumber;
  const max = useMemo(() => Math.max(1, ...items.map((i) => i.value)), [items]);
  if (items.length === 0) {
    return <p className="m-0 py-6 text-center text-sm text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate" title={item.label}>
              {item.label}
            </span>
            <span className="tnum shrink-0 text-ink-2">{formatValue(item.value)}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-[4px] bg-surface-2">
            <div
              className="h-full rounded-[4px]"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: 'var(--seq-400)',
              }}
            />
          </div>
          {item.caption ? (
            <div className="mt-0.5 text-xs text-ink-muted">{item.caption}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------- trace waterfall */

export interface WaterfallSpan {
  id: string;
  name: string;
  kind: string;
  model: string | null;
  status: string;
  startedAt: number;
  durationMs: number;
  costTotal: number;
  priced: number;
  inputTokens: number;
  outputTokens: number;
}

export function Waterfall({
  spans,
  traceStart,
  traceDuration,
  selectedId,
  onSelect,
}: {
  spans: WaterfallSpan[];
  traceStart: number;
  traceDuration: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const span = Math.max(1, traceDuration);
  const kinds = useMemo(() => [...new Set(spans.map((s) => s.kind))], [spans]);

  if (spans.length === 0) return <EmptyChart message="This trace has no spans." />;

  return (
    <div>
      <div className="mb-3">
        <Legend
          items={kinds.map((kind) => ({
            label: SPAN_KIND_LABELS[kind] ?? kind,
            color: spanKindColor(kind),
          }))}
        />
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {spans.map((s) => {
          const offset = ((s.startedAt - traceStart) / span) * 100;
          const width = Math.max(0.8, (s.durationMs / span) * 100);
          const selected = selectedId === s.id;
          const failed = s.status === 'error';
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect?.(s.id)}
                className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                  selected ? 'bg-surface-2' : 'hover:bg-surface-2'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {/* Failure is never colour-alone: icon + label travel with it. */}
                    {failed ? (
                      <span
                        className="shrink-0 font-bold text-critical"
                        title="This span failed"
                        aria-label="failed"
                      >
                        ✕
                      </span>
                    ) : null}
                    <span className="truncate font-medium" title={s.name}>
                      {s.name}
                    </span>
                    {s.model ? (
                      <span className="shrink-0 truncate text-xs text-ink-muted">{s.model}</span>
                    ) : null}
                  </span>
                  <span className="tnum shrink-0 text-xs text-ink-2">
                    {formatDuration(s.durationMs)}
                    {s.priced === 1 ? ` · ${compactUsd(s.costTotal)}` : ''}
                  </span>
                </div>
                <div className="relative mt-1 h-2.5 w-full rounded-[4px] bg-surface-2">
                  <div
                    className="absolute top-0 h-full rounded-[4px]"
                    style={{
                      left: `${Math.min(99, Math.max(0, offset))}%`,
                      width: `${width}%`,
                      background: failed ? 'var(--critical)' : spanKindColor(s.kind),
                      // 2px surface ring keeps overlapping bars readable.
                      boxShadow: '0 0 0 2px var(--surface-1)',
                    }}
                    title={`${SPAN_KIND_LABELS[s.kind] ?? s.kind} · ${formatDuration(s.durationMs)}`}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- swap comparison */

export interface SwapBar {
  model: string;
  label: string;
  cost: number | null;
  isBaseline: boolean;
  basis: 'measured' | 'family';
}

/**
 * Projected spend per candidate model against the baseline the workload
 * actually ran on. One hue; the baseline is marked by a reference line and a
 * label, never by a second colour that would read as a second series.
 */
export function SwapComparison({ bars, baselineCost }: { bars: SwapBar[]; baselineCost: number }) {
  const priced = bars.filter((b) => b.cost !== null) as (SwapBar & { cost: number })[];
  if (priced.length === 0) {
    return <EmptyChart message="No priced candidate models to compare." />;
  }

  const max = Math.max(baselineCost, ...priced.map((b) => b.cost));
  const scale = (value: number) => (max > 0 ? (value / max) * 100 : 0);

  return (
    <div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {priced.map((bar) => {
          const delta = bar.cost - baselineCost;
          const cheaper = delta < 0;
          return (
            <li key={bar.model}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{bar.label}</span>
                  {bar.isBaseline ? (
                    <span className="shrink-0 rounded border border-hairline-strong px-1.5 py-px text-[10px] uppercase tracking-wide text-ink-2">
                      current
                    </span>
                  ) : null}
                  {bar.basis === 'family' ? (
                    <span
                      className="shrink-0 text-xs text-warning"
                      title="Projected with a tokenizer-family constant, not a ratio measured on your traffic"
                    >
                      ◍ estimated
                    </span>
                  ) : null}
                </span>
                <span className="tnum shrink-0">
                  {compactUsd(bar.cost)}
                  {!bar.isBaseline ? (
                    <span className={cheaper ? 'ml-2 text-success-text' : 'ml-2 text-danger-text'}>
                      {cheaper ? '↓' : '↑'} {compactUsd(Math.abs(delta))}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="relative mt-1.5 h-3 w-full rounded-[4px] bg-surface-2">
                <div
                  className="h-full rounded-[4px]"
                  style={{
                    width: `${Math.max(1.5, scale(bar.cost))}%`,
                    background: bar.isBaseline ? 'var(--seq-550)' : 'var(--seq-400)',
                  }}
                />
                {/* Baseline reference line. */}
                <div
                  className="absolute top-[-3px] h-[18px] w-px bg-ink-2"
                  style={{ left: `${scale(baselineCost)}%` }}
                  title={`Current spend: ${compactUsd(baselineCost)}`}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 mb-0 text-xs text-ink-muted">
        The vertical rule marks current spend ({compactUsd(baselineCost)}) for the selected
        workload and range.
      </p>
    </div>
  );
}
