import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { resolveRange } from '@/lib/constants';
import { formatTokens, formatUsd } from '@/lib/pricing';
import {
  costSeries,
  errorBreakdown,
  hasAnySpans,
  modelBreakdown,
  monthToDateCost,
  overview,
  pricingWarnings,
  topTraceNames,
  topUsers,
} from '@/lib/queries';
import { Badge, Card, Notice, PageHeader, StatTile } from '@/components/ui';
import { BarList, CostOverTime, TokenVolume } from '@/components/charts';
import { RangePicker } from '@/components/RangePicker';
import { formatDuration, formatRelative } from '@/components/chart-utils';
import { CopyBlock } from '@/components/CopyField';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeParam } = await searchParams;
  const { project } = await requireProject(slug);
  const range = resolveRange(rangeParam);

  if (!hasAnySpans(project.id)) return <AwaitingData slug={slug} />;

  const stats = overview(project.id, range.since);
  const series = costSeries(project.id, range.since, range.id === '1h' || range.id === '24h' ? 'hour' : 'day');
  const models = modelBreakdown(project.id, range.since);
  const traceNames = topTraceNames(project.id, range.since);
  const users = topUsers(project.id, range.since, 6);
  const errors = errorBreakdown(project.id, range.since, 6);
  const warnings = pricingWarnings(project.id, range.since);
  const mtd = monthToDateCost(project.id);

  const errorRate = stats.spans > 0 ? (stats.errors / stats.spans) * 100 : 0;
  const budget = project.monthlyBudgetUsd;
  const budgetUsed = budget && budget > 0 ? (mtd / budget) * 100 : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${range.label.toLowerCase()} · ${stats.traces.toLocaleString('en-US')} traces, ${stats.llmCalls.toLocaleString('en-US')} LLM calls`}
        action={<RangePicker current={range.id} />}
      />

      {warnings.unpriced.length > 0 ? (
        <div className="mb-5">
          <Notice
            tone="critical"
            title={`${warnings.unpriced.length} model(s) have no configured price — spend below is understated.`}
          >
            <p className="m-0">
              {warnings.unpriced
                .map((m) => `${m.model} (${m.calls} call(s), ${formatTokens(m.tokens)} tokens)`)
                .join(' · ')}
            </p>
            <p className="m-0 mt-2">
              <Link href={`/p/${slug}/prices`} className="font-medium underline">
                Set their rates
              </Link>{' '}
              and re-price history to make these figures complete.
            </p>
          </Notice>
        </div>
      ) : null}

      {warnings.unverified.length > 0 ? (
        <div className="mb-5">
          <Notice
            tone="warning"
            title="Some spend is priced from unverified placeholder rates."
          >
            <p className="m-0">
              {warnings.unverified
                .map((m) => `${m.model} (${formatUsd(m.cost)})`)
                .join(' · ')}{' '}
              — confirm these against the provider&apos;s pricing page on the{' '}
              <Link href={`/p/${slug}/prices`} className="font-medium underline">
                Prices
              </Link>{' '}
              tab.
            </p>
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Spend · ${range.id}`}
          value={formatUsd(stats.cost)}
          sub={`${formatUsd(mtd)} month to date`}
        />
        <StatTile
          label="Tokens"
          value={formatTokens(stats.totalTokens)}
          sub={`${formatTokens(stats.inputTokens)} in · ${formatTokens(stats.outputTokens)} out${
            stats.cacheReadTokens > 0 ? ` · ${formatTokens(stats.cacheReadTokens)} cached` : ''
          }`}
        />
        <StatTile
          label="p95 latency"
          value={formatDuration(stats.p95LatencyMs)}
          sub={`p50 ${formatDuration(stats.p50LatencyMs)}${
            stats.avgTtftMs !== null ? ` · ${formatDuration(stats.avgTtftMs)} avg TTFT` : ''
          }`}
        />
        <StatTile
          label="Error rate"
          value={`${errorRate.toFixed(errorRate >= 10 ? 0 : 1)}%`}
          sub={`${stats.errors.toLocaleString('en-US')} of ${stats.spans.toLocaleString('en-US')} spans`}
          tone={errorRate >= 5 ? 'critical' : errorRate > 0 ? 'warning' : 'good'}
        />
      </div>

      {budget && budgetUsed !== null ? (
        <Card className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-base font-semibold">Monthly budget</h2>
            <span className="tnum text-sm text-ink-2">
              {formatUsd(mtd)} of {formatUsd(budget)} ({budgetUsed.toFixed(1)}%)
            </span>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-[4px] bg-surface-2">
            <div
              className="h-full rounded-[4px]"
              style={{
                width: `${Math.min(100, budgetUsed)}%`,
                background:
                  budgetUsed >= 100
                    ? 'var(--critical)'
                    : budgetUsed >= 80
                      ? 'var(--warning)'
                      : 'var(--seq-400)',
              }}
            />
          </div>
          {budgetUsed >= 80 ? (
            <p className="m-0 mt-2 text-sm">
              {budgetUsed >= 100 ? (
                <span className="font-medium text-danger-text">✕ Budget exceeded.</span>
              ) : (
                <span className="font-medium text-warning">▲ Approaching the budget.</span>
              )}{' '}
              <Link href={`/p/${slug}/swap`} className="underline">
                Check what a model swap would cost
              </Link>
              .
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="Spend over time"
        description="Cost computed from the price table at ingest; correcting a rate and re-pricing updates this retroactively."
        className="mb-6"
      >
        <CostOverTime data={series} />
        <div className="mt-6 border-t border-hairline pt-5">
          <TokenVolume data={series} />
        </div>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Spend by model">
          <BarList
            items={models.slice(0, 8).map((m) => ({
              label: m.model,
              value: m.cost,
              caption: `${m.calls.toLocaleString('en-US')} calls · ${formatTokens(
                m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens,
              )} tokens${m.pricedCalls < m.calls ? ' · partly unpriced' : ''}`,
            }))}
            format="usd"
            emptyMessage="No model calls in this range."
          />
        </Card>

        <Card title="Spend by trace">
          <BarList
            items={traceNames.map((t) => ({
              label: t.label,
              value: t.cost,
              caption: `${t.calls.toLocaleString('en-US')} traces${t.errors > 0 ? ` · ${t.errors} errored` : ''}`,
            }))}
            format="usd"
            emptyMessage="No traces in this range."
          />
        </Card>

        <Card title="Spend by user">
          <BarList
            items={users.map((u) => ({
              label: u.label,
              value: u.cost,
              caption: `${u.calls.toLocaleString('en-US')} traces`,
            }))}
            format="usd"
            emptyMessage="No traces carry a user id. Call t.setUser(…) to group spend per customer."
          />
        </Card>
      </div>

      <Card
        title="Failures"
        description="Grouped by error type and model."
        action={
          <Link href={`/p/${slug}/traces?status=error`} className="btn btn-ghost">
            View failed traces
          </Link>
        }
      >
        {errors.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-ink-muted">
            No failed spans in this range.
          </p>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Error</th>
                  <th>Model</th>
                  <th className="num">Count</th>
                  <th>Last seen</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={`${e.errorType}-${e.model ?? 'none'}`}>
                    <td>
                      <Badge tone="critical">✕ {e.errorType}</Badge>
                    </td>
                    <td className="font-mono text-xs">{e.model ?? '—'}</td>
                    <td className="num tnum">{e.count.toLocaleString('en-US')}</td>
                    <td className="whitespace-nowrap text-ink-2">{formatRelative(e.lastSeen)}</td>
                    <td className="max-w-md truncate text-ink-2" title={e.sample ?? ''}>
                      {e.sample ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function AwaitingData({ slug }: { slug: string }) {
  const snippet = `import Anthropic from '@anthropic-ai/sdk';
import { Glassfish } from 'glassfish-zero';

const gf = new Glassfish({
  apiKey: process.env.GLASSFISH_API_KEY,
  baseUrl: process.env.GLASSFISH_BASE_URL,
});

const anthropic = gf.observe(new Anthropic());

await gf.trace('first-trace', async () => {
  await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'Hello from Glassfish Zero' }],
  });
});

await gf.flush();`;

  return (
    <>
      <PageHeader
        title="Waiting for the first span"
        description="This project exists and has a key. Nothing has been sent to it yet."
      />
      <Card title="Send your first trace" className="mb-5">
        <CopyBlock code={snippet} />
      </Card>
      <Card title="Checklist">
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-2">
          <li>
            <code className="font-mono">npm install glassfish-zero</code> in your application.
          </li>
          <li>
            Copy an API key from the{' '}
            <Link href={`/p/${slug}/settings`} className="font-medium underline">
              Settings
            </Link>{' '}
            tab into <code className="font-mono">GLASSFISH_API_KEY</code>.
          </li>
          <li>
            Point <code className="font-mono">GLASSFISH_BASE_URL</code> at this dashboard&apos;s
            origin.
          </li>
          <li>
            Run the snippet above. Spans flush in the background — call{' '}
            <code className="font-mono">await gf.flush()</code> before a short-lived process
            exits.
          </li>
        </ol>
        <p className="m-0 mt-4 text-sm text-ink-2">
          Nothing arriving? The SDK logs transport failures through{' '}
          <code className="font-mono">onError</code> rather than swallowing them — check your
          application logs for lines prefixed <code className="font-mono">[glassfish-zero]</code>.
        </p>
      </Card>
    </>
  );
}
