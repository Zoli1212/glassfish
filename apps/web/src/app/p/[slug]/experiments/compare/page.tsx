import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { compareExperiments, getExperiment, listExperiments } from '@/lib/evals';
import { formatUsd } from '@/lib/pricing';
import { Badge, Card, EmptyState, Notice, PageHeader, StatTile } from '@/components/ui';
import { formatDuration } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

function preview(value: unknown, max = 240): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function Delta({ value, digits = 2 }: { value: number | null; digits?: number }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  if (Math.abs(value) < 0.0001) return <span className="text-ink-muted">0</span>;
  const better = value > 0;
  return (
    <span className={better ? 'text-success-text' : 'text-danger-text'}>
      {better ? '↑' : '↓'} {Math.abs(value).toFixed(digits)}
    </span>
  );
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { slug } = await params;
  const { a, b } = await searchParams;
  const { project } = await requireProject(slug);

  if (!a || !b) {
    const all = listExperiments(project.id);
    return (
      <>
        <PageHeader title="Compare runs" description="Pick two runs of the same dataset." />
        <EmptyState title="Two runs are needed">
          {all.length < 2
            ? 'Record at least two experiments first.'
            : 'Open a run and use its "Compare with…" button.'}
        </EmptyState>
      </>
    );
  }

  const left = getExperiment(project.id, a);
  const right = getExperiment(project.id, b);
  const comparison = compareExperiments(project.id, a, b);

  if (!left || !right || !comparison) {
    return (
      <>
        <PageHeader title="Compare runs" />
        <EmptyState title="One of those runs does not exist in this project." />
      </>
    );
  }

  const regressions = comparison.rows.filter((r) => r.regressed).length;
  const improvements = comparison.rows.filter((r) => r.improved && !r.regressed).length;

  return (
    <>
      <PageHeader
        title="Compare runs"
        description={
          <span>
            <strong>A</strong> {left.name} → <strong>B</strong> {right.name}
          </span>
        }
        action={
          <Link href={`/p/${slug}/experiments`} className="btn btn-ghost">
            All runs
          </Link>
        }
      />

      {comparison.unmatched.onlyInA > 0 || comparison.unmatched.onlyInB > 0 ? (
        <div className="mb-5">
          <Notice
            tone="warning"
            title="The two runs do not cover the same examples."
          >
            {comparison.unmatched.onlyInA} only in A, {comparison.unmatched.onlyInB} only in B.
            Those rows are excluded from the comparison below — pairing is by stable
            <code className="mx-1 font-mono">externalId</code>, falling back to the input. Give
            your examples an <code className="font-mono">externalId</code> and they will line up.
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Regressions"
          value={regressions}
          sub="scored worse in B"
          tone={regressions > 0 ? 'critical' : 'good'}
        />
        <StatTile label="Improvements" value={improvements} sub="scored better in B" tone="good" />
        <StatTile
          label="Cost delta"
          value={`${comparison.costDelta >= 0 ? '+' : '−'}${formatUsd(Math.abs(comparison.costDelta))}`}
          sub={`A ${formatUsd(left.costUsd)} → B ${formatUsd(right.costUsd)}`}
          tone={comparison.costDelta > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Latency delta"
          value={`${comparison.latencyDelta >= 0 ? '+' : '−'}${formatDuration(Math.abs(comparison.latencyDelta))}`}
          sub={`avg per example`}
          tone={comparison.latencyDelta > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card title="Scores" className="mb-6">
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Scorer</th>
                <th className="num">A</th>
                <th className="num">B</th>
                <th className="num">Δ</th>
                <th className="num">Regressed</th>
                <th className="num">Improved</th>
              </tr>
            </thead>
            <tbody>
              {comparison.summary.map((row) => (
                <tr key={row.scorer}>
                  <td className="font-medium">{row.scorer}</td>
                  <td className="num tnum">{row.aMean === null ? '—' : row.aMean.toFixed(3)}</td>
                  <td className="num tnum">{row.bMean === null ? '—' : row.bMean.toFixed(3)}</td>
                  <td className="num tnum">
                    <Delta value={row.delta} digits={3} />
                  </td>
                  <td className="num tnum">
                    {row.regressions > 0 ? (
                      <span className="text-danger-text">{row.regressions}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="num tnum">{row.improvements}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Example by example"
        description="Regressions first — the reason to open this page is to find what broke."
        className="p-0"
      >
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th />
                <th>Input</th>
                <th>A output</th>
                <th>B output</th>
                {comparison.scorers.map((name) => (
                  <th key={name} className="num">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.key}>
                  <td className="align-top">
                    {row.regressed ? (
                      <Badge tone="critical">✕ worse</Badge>
                    ) : row.improved ? (
                      <Badge tone="good">✓ better</Badge>
                    ) : (
                      <span className="text-xs text-ink-muted">same</span>
                    )}
                  </td>
                  <td className="max-w-xs align-top text-xs">{preview(row.input, 140)}</td>
                  <td className="max-w-sm align-top text-xs text-ink-2">
                    {preview(row.aOutput)}
                  </td>
                  <td className="max-w-sm align-top text-xs">{preview(row.bOutput)}</td>
                  {comparison.scorers.map((name) => {
                    const av = row.aScores[name];
                    const bv = row.bScores[name];
                    const delta = row.deltas[name];
                    return (
                      <td key={name} className="num tnum align-top whitespace-nowrap">
                        <span className="text-ink-muted">{av === null ? '—' : av.toFixed(2)}</span>
                        <span className="mx-1 text-ink-muted">→</span>
                        <span>{bv === null ? '—' : bv.toFixed(2)}</span>
                        {delta !== undefined && Math.abs(delta) > 0.0001 ? (
                          <span
                            className={`ml-1.5 ${delta > 0 ? 'text-success-text' : 'text-danger-text'}`}
                          >
                            {delta > 0 ? '↑' : '↓'}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {comparison.rows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-sm text-ink-muted">
            No examples matched between the two runs.
          </p>
        ) : null}
      </Card>
    </>
  );
}
