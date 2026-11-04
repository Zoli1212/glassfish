import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { resolveRange } from '@/lib/constants';
import { formatTokens, formatUsd, priceMap } from '@/lib/pricing';
import { modelBreakdown } from '@/lib/queries';
import { measureRatios } from '@/lib/swap';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { BarList } from '@/components/charts';
import { RangePicker } from '@/components/RangePicker';
import { formatDuration } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

export default async function ModelsPage({
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

  const models = modelBreakdown(project.id, range.since);
  const ratios = measureRatios(project.id);
  const prices = priceMap();

  const totalCost = models.reduce((sum, m) => sum + m.cost, 0);

  return (
    <>
      <PageHeader
        title="Models"
        description="What each model actually did on this project's traffic — not a vendor benchmark."
        action={<RangePicker current={range.id} />}
      />

      {models.length === 0 ? (
        <EmptyState title="No model calls in this range">
          Widen the range, or send some traffic first.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Card title="Spend share">
              <BarList
                items={models.map((m) => ({
                  label: m.model,
                  value: m.cost,
                  caption:
                    totalCost > 0
                      ? `${((m.cost / totalCost) * 100).toFixed(1)}% of spend`
                      : 'no priced spend',
                }))}
                format="usd"
              />
            </Card>

            <Card
              title="Per-call averages"
              description="Averages over the selected range. Output tokens per call is the cost driver most sensitive to model choice."
            >
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th className="num">Calls</th>
                      <th className="num">Avg output tokens</th>
                      <th className="num">Avg latency</th>
                      <th className="num">Avg TTFT</th>
                      <th className="num">Error rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => {
                      const errorRate = m.calls > 0 ? (m.errors / m.calls) * 100 : 0;
                      return (
                        <tr key={m.model}>
                          <td className="font-mono text-xs">{m.model}</td>
                          <td className="num tnum">{m.calls.toLocaleString('en-US')}</td>
                          <td className="num tnum">{Math.round(m.avgOutputTokens).toLocaleString('en-US')}</td>
                          <td className="num tnum">{formatDuration(m.avgLatencyMs)}</td>
                          <td className="num tnum">
                            {m.avgTtftMs === null ? '—' : formatDuration(m.avgTtftMs)}
                          </td>
                          <td
                            className={`num tnum ${errorRate >= 5 ? 'text-danger-text' : ''}`}
                          >
                            {errorRate.toFixed(errorRate >= 10 ? 0 : 1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card
            title="Tokens, characters and cost"
            description="Characters are model-independent; tokens are not. The chars-per-token column is the measured ratio the model-swap simulator uses."
            action={
              <Link href={`/p/${slug}/swap`} className="btn btn-ghost">
                Run a swap projection
              </Link>
            }
          >
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Provider</th>
                    <th className="num">Prompt tokens</th>
                    <th className="num">Output tokens</th>
                    <th className="num">Cached</th>
                    <th className="num">Chars / token</th>
                    <th className="num">Cost</th>
                    <th>Pricing</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const ratio = ratios.get(m.model);
                    const price = prices.get(m.model);
                    const promptTokens = m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens;
                    return (
                      <tr key={m.model}>
                        <td className="font-mono text-xs">{m.model}</td>
                        <td className="text-ink-2">{m.provider ?? '—'}</td>
                        <td className="num tnum">{formatTokens(promptTokens)}</td>
                        <td className="num tnum">{formatTokens(m.outputTokens)}</td>
                        <td className="num tnum">
                          {promptTokens > 0
                            ? `${((m.cacheReadTokens / promptTokens) * 100).toFixed(0)}%`
                            : '—'}
                        </td>
                        <td className="num tnum">
                          {ratio ? (
                            <span
                              title={
                                ratio.basis === 'measured'
                                  ? `Measured across ${ratio.samples} span(s) on this project.`
                                  : `Only ${ratio.samples} span(s) — falling back to the ${price?.family ?? 'generic'} tokenizer constant.`
                              }
                            >
                              {ratio.inputCharsPerToken.toFixed(2)}
                              {ratio.basis === 'family' ? (
                                <span className="ml-1 text-warning">◍</span>
                              ) : null}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num tnum">{formatUsd(m.cost)}</td>
                        <td>
                          {!price || price.inputPerMTok === null ? (
                            <Badge tone="critical" title="Cost is understated for this model">
                              ✕ unpriced
                            </Badge>
                          ) : price.verified ? (
                            <Badge tone="good">✓ verified</Badge>
                          ) : (
                            <Badge tone="warning" title="Seeded placeholder rate, never confirmed">
                              ▲ unverified
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="m-0 mt-4 text-xs text-ink-muted">
              <span className="text-warning">◍</span> marks a chars-per-token figure taken from
              the tokenizer-family constant rather than measured on this project — fewer than 20
              spans is too few to trust.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
