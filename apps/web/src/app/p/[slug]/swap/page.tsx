import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { resolveRange } from '@/lib/constants';
import { formatTokens, formatUsd } from '@/lib/pricing';
import { distinctModels } from '@/lib/queries';
import { observedModels, projectSwap } from '@/lib/swap';
import { Badge, Card, EmptyState, Notice, PageHeader, StatTile } from '@/components/ui';
import { SwapComparison } from '@/components/charts';
import { SwapControls } from '@/components/SwapControls';
import { compactUsd } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

export default async function SwapPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; source?: string; verbosity?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const { project } = await requireProject(slug);
  const range = resolveRange(query.range);

  const models = distinctModels(project.id);
  const sourceModels = query.source ? [query.source] : null;
  const verbosity = Number(query.verbosity ?? '1') || 1;

  const { workload, projections } = projectSwap(project.id, range.since, sourceModels, {
    verbosityFactor: verbosity,
  });
  const observed = observedModels(project.id, range.since);

  if (workload.calls === 0) {
    return (
      <>
        <PageHeader title="Model swap" description="Project this workload onto other models." />
        <SwapControls models={models} />
        <EmptyState title="No LLM calls in this selection">
          Widen the range or pick a different workload.
        </EmptyState>
      </>
    );
  }

  const actualTokens = workload.promptTokens + workload.outputTokens;
  const cheapest = projections.find((p) => p.projectedCost !== null && !p.isBaseline);
  const anyMeasured = projections.some((p) => p.basis === 'measured');

  return (
    <>
      <PageHeader
        title="Model swap"
        description={
          query.source
            ? `What ${query.source}'s workload would have cost elsewhere.`
            : 'What this project’s whole LLM workload would have cost on other models.'
        }
      />

      <SwapControls models={models} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Workload"
          value={workload.calls.toLocaleString('en-US')}
          sub={`LLM call(s) · ${range.label.toLowerCase()}`}
        />
        <StatTile
          label="Actual tokens"
          value={formatTokens(actualTokens)}
          sub={`${formatTokens(workload.promptTokens)} prompt · ${formatTokens(workload.outputTokens)} output`}
        />
        <StatTile
          label="Actual spend"
          value={formatUsd(workload.cost)}
          sub={
            workload.pricedCalls < workload.calls
              ? `${workload.calls - workload.pricedCalls} call(s) unpriced`
              : 'all calls priced'
          }
          tone={workload.pricedCalls < workload.calls ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Best projected"
          value={cheapest?.projectedCost !== undefined && cheapest?.projectedCost !== null
            ? formatUsd(cheapest.projectedCost)
            : '—'}
          sub={cheapest ? cheapest.displayName : 'no priced candidate'}
          tone={
            cheapest && cheapest.projectedCost !== null && cheapest.projectedCost < workload.cost
              ? 'good'
              : 'neutral'
          }
        />
      </div>

      {!anyMeasured ? (
        <div className="mb-5">
          <Notice
            tone="warning"
            title="Every projection below rests on a tokenizer-family constant, not a measured ratio."
          >
            This project has fewer than 20 spans on each candidate model, so there is nothing to
            measure against yet. Treat these as order-of-magnitude figures. Running even a small
            share of traffic through a candidate model turns its column into a measurement.
          </Notice>
        </div>
      ) : null}

      {workload.pricedCalls < workload.calls ? (
        <div className="mb-5">
          <Notice tone="critical" title="Actual spend for this workload is incomplete.">
            {(workload.calls - workload.pricedCalls).toLocaleString('en-US')} call(s) use a model
            with no configured price, so the baseline is understated and every delta below is
            optimistic.{' '}
            <Link href={`/p/${slug}/prices`} className="font-medium underline">
              Fix the price table
            </Link>{' '}
            first.
          </Notice>
        </div>
      ) : null}

      <Card
        title="Projected spend by model"
        description="Same prompts and completions, re-tokenised for each candidate and priced at its own rates."
        className="mb-6"
      >
        <SwapComparison
          bars={projections.map((p) => ({
            model: p.model,
            label: p.displayName,
            cost: p.projectedCost,
            isBaseline: p.isBaseline,
            basis: p.basis,
          }))}
          baselineCost={workload.cost}
        />
      </Card>

      <Card
        title="Token and cost projection"
        description="Token delta is what changes from re-tokenising the same text; cost delta combines that with each model's rates."
        className="mb-6"
      >
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th>Basis</th>
                <th className="num">Chars / token</th>
                <th className="num">Prompt tokens</th>
                <th className="num">Output tokens</th>
                <th className="num">Token Δ</th>
                <th className="num">Projected cost</th>
                <th className="num">Cost Δ</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p) => (
                <tr key={p.model}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{p.model}</span>
                      {p.isBaseline ? <Badge>current</Badge> : null}
                    </div>
                    {p.warnings.length > 0 ? (
                      <ul className="m-0 mt-1 list-none p-0 text-[11px] text-warning">
                        {p.warnings.map((warning) => (
                          <li key={warning}>▲ {warning}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td>
                    {p.basis === 'measured' ? (
                      <Badge tone="good" title={`Measured across ${p.samples} span(s)`}>
                        ✓ measured
                      </Badge>
                    ) : (
                      <Badge tone="warning" title={`Tokenizer family: ${p.family}`}>
                        ◍ estimated
                      </Badge>
                    )}
                  </td>
                  <td className="num tnum">{p.inputCharsPerToken.toFixed(2)}</td>
                  <td className="num tnum">{formatTokens(p.projectedPromptTokens)}</td>
                  <td className="num tnum">{formatTokens(p.projectedOutputTokens)}</td>
                  <td className="num tnum">
                    <DeltaCell value={p.tokenDeltaPct} suffix="%" invertGood />
                  </td>
                  <td className="num tnum">
                    {p.projectedCost === null ? (
                      <span className="text-warning" title="No price configured for this model">
                        unpriced
                      </span>
                    ) : (
                      compactUsd(p.projectedCost)
                    )}
                  </td>
                  <td className="num tnum">
                    {p.costDelta === null || p.isBaseline ? (
                      '—'
                    ) : (
                      <span
                        className={p.costDelta < 0 ? 'text-success-text' : 'text-danger-text'}
                      >
                        {p.costDelta < 0 ? '↓' : '↑'} {compactUsd(Math.abs(p.costDelta))}
                        {p.costDeltaPct !== null ? (
                          <span className="ml-1 text-ink-muted">
                            ({p.costDeltaPct > 0 ? '+' : ''}
                            {p.costDeltaPct.toFixed(0)}%)
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Measured, not projected"
        description="Models this project has actually run. Where two rows exist, the token difference between them is observed rather than estimated."
        className="mb-6"
      >
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Calls</th>
                <th className="num">Avg prompt chars</th>
                <th className="num">Avg prompt tokens</th>
                <th className="num">Avg output tokens</th>
                <th className="num">Chars / token</th>
                <th className="num">Avg cost / call</th>
              </tr>
            </thead>
            <tbody>
              {observed.map((row) => (
                <tr key={row.model}>
                  <td className="font-mono text-xs">{row.model}</td>
                  <td className="num tnum">{row.calls.toLocaleString('en-US')}</td>
                  <td className="num tnum">{Math.round(row.avgPromptChars).toLocaleString('en-US')}</td>
                  <td className="num tnum">{Math.round(row.avgPromptTokens).toLocaleString('en-US')}</td>
                  <td className="num tnum">{Math.round(row.avgOutputTokens).toLocaleString('en-US')}</td>
                  <td className="num tnum">
                    {row.inputCharsPerToken === null ? '—' : row.inputCharsPerToken.toFixed(2)}
                  </td>
                  <td className="num tnum">
                    {row.avgCostPerCall === null ? '—' : compactUsd(row.avgCostPerCall)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How this number is produced">
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-2">
          <p className="m-0">
            Swapping a model changes two things at once: the price per token, and how many tokens
            the same text becomes. Re-pricing the recorded token counts would answer the wrong
            question, so the projection converts through characters, which are model-independent:
          </p>
          <p className="m-0 rounded-lg border border-hairline bg-surface-2 px-4 py-3 font-mono text-xs">
            projected_tokens(target) = recorded_chars / chars_per_token(target)
          </p>
          <p className="m-0">
            <strong>chars_per_token</strong> is measured from this project&apos;s own spans
            whenever a model has at least 20 of them, and only falls back to a tokenizer-family
            constant otherwise — rows say which, every time. The observed cache-hit share is
            preserved, since swapping a model changes how text tokenises, not how repetitive the
            traffic is.
          </p>
          <p className="m-0">
            <strong>What this cannot tell you.</strong> It assumes the target model produces the
            same answers at the same length; the output-length control above makes that
            assumption explicit rather than hiding it. It cannot predict quality, refusal rate,
            or how a different model&apos;s reasoning budget changes output volume. The honest way
            to close that gap is to route a slice of real traffic to the candidate model — once
            it has 20 spans here, its column stops being an estimate.
          </p>
        </div>
      </Card>
    </>
  );
}

function DeltaCell({
  value,
  suffix,
  invertGood,
}: {
  value: number;
  suffix: string;
  invertGood?: boolean;
}) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) {
    return <span className="text-ink-muted">≈ same</span>;
  }
  const better = invertGood ? value < 0 : value > 0;
  return (
    <span className={better ? 'text-success-text' : 'text-danger-text'}>
      {value > 0 ? '↑' : '↓'} {Math.abs(value).toFixed(0)}
      {suffix}
    </span>
  );
}
