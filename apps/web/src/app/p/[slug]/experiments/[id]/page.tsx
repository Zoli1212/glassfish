import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProject } from '@/lib/auth';
import { getExperiment, listExperiments, listResults, scoreSummary } from '@/lib/evals';
import { formatUsd } from '@/lib/pricing';
import { Badge, Card, PageHeader, StatTile } from '@/components/ui';
import { formatDuration, formatTime } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

function preview(value: unknown, max = 300): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { project } = await requireProject(slug);

  const experiment = getExperiment(project.id, id);
  if (!experiment) notFound();

  const results = listResults(id, 500);
  const summary = scoreSummary(id);
  const scorerNames = summary.map((s) => s.name);

  const siblings = experiment.datasetId
    ? listExperiments(project.id, experiment.datasetId).filter((e) => e.id !== id)
    : [];

  return (
    <>
      <PageHeader
        title={experiment.name}
        description={
          <span>
            {experiment.datasetName ? `${experiment.datasetName} · ` : ''}
            {experiment.targetModel ? `${experiment.targetModel} · ` : ''}
            {formatTime(experiment.startedAt)}
          </span>
        }
        action={
          siblings.length > 0 ? (
            <Link
              href={`/p/${slug}/experiments/compare?a=${siblings[0].id}&b=${id}`}
              className="btn btn-primary"
            >
              Compare with {siblings[0].name}
            </Link>
          ) : (
            <Link href={`/p/${slug}/experiments`} className="btn btn-ghost">
              All runs
            </Link>
          )
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Results"
          value={experiment.resultCount.toLocaleString('en-US')}
          sub={experiment.errorCount > 0 ? `${experiment.errorCount} failed` : 'all succeeded'}
          tone={experiment.errorCount > 0 ? 'critical' : 'good'}
        />
        <StatTile label="Cost" value={formatUsd(experiment.costUsd)} sub="task + judge" />
        <StatTile label="Avg latency" value={formatDuration(experiment.avgLatencyMs)} />
        <StatTile
          label="Tokens"
          value={experiment.totalTokens.toLocaleString('en-US')}
          sub={experiment.status}
        />
      </div>

      {summary.length > 0 ? (
        <Card title="Scores" className="mb-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.map((score) => (
              <div key={score.name} className="rounded-lg border border-hairline px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {score.name}
                </div>
                <div className="mt-1.5 text-2xl font-semibold leading-none">
                  {score.passRate !== null
                    ? `${(score.passRate * 100).toFixed(0)}%`
                    : score.mean !== null
                      ? score.mean.toFixed(3)
                      : '—'}
                </div>
                <div className="mt-1.5 text-xs text-ink-2">
                  {score.passRate !== null ? 'pass rate' : 'mean'} over {score.count} scored
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Example</th>
                <th>Output</th>
                {scorerNames.map((name) => (
                  <th key={name} className="num">
                    {name}
                  </th>
                ))}
                <th className="num">Latency</th>
                <th className="num">Cost</th>
                <th>Trace</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td className="max-w-xs align-top">
                    {result.externalId ? (
                      <div className="font-mono text-[11px] text-ink-muted">
                        {result.externalId}
                      </div>
                    ) : null}
                    <div className="text-xs">{preview(result.input, 160)}</div>
                    {result.expected !== null && result.expected !== undefined ? (
                      <div className="mt-1 text-xs text-ink-muted">
                        expected: {preview(result.expected, 120)}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-md align-top text-xs">
                    {result.status === 'error' ? (
                      <span className="text-danger-text">
                        <span aria-hidden>✕</span> {result.errorMessage}
                      </span>
                    ) : (
                      preview(result.output)
                    )}
                  </td>
                  {scorerNames.map((name) => {
                    const score = result.scores.find((s) => s.name === name);
                    return (
                      <td key={name} className="num tnum align-top">
                        {score === undefined || score.value === null ? (
                          <span
                            className="text-ink-muted"
                            title={score?.comment ?? 'not scored'}
                          >
                            —
                          </span>
                        ) : (
                          <span
                            className={
                              score.value >= 0.999
                                ? 'text-success-text'
                                : score.value <= 0.001
                                  ? 'text-danger-text'
                                  : ''
                            }
                            title={score.comment ?? undefined}
                          >
                            {score.value === 1 ? '✓' : score.value === 0 ? '✕' : score.value.toFixed(2)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num tnum align-top">{formatDuration(result.latencyMs)}</td>
                  <td className="num tnum align-top">{formatUsd(result.costUsd)}</td>
                  <td className="align-top">
                    {result.traceId ? (
                      <Link
                        href={`/p/${slug}/traces/${encodeURIComponent(result.traceId)}`}
                        className="text-xs underline"
                      >
                        open
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 border-t border-hairline px-4 py-3 text-xs text-ink-muted">
          A dash means the scorer could not judge that example — not a zero. Hover it for the
          reason.{' '}
          {experiment.errorCount > 0 ? (
            <span>
              Failed examples are kept with their error rather than dropped, so the result count
              stays honest.
            </span>
          ) : null}
        </p>
      </Card>

      {siblings.length > 0 ? (
        <Card title="Other runs on this dataset" className="mt-5">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {siblings.slice(0, 10).map((sibling) => (
              <li key={sibling.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/p/${slug}/experiments/${sibling.id}`}
                  className="truncate hover:underline"
                >
                  {sibling.name}
                </Link>
                <Link
                  href={`/p/${slug}/experiments/compare?a=${sibling.id}&b=${id}`}
                  className="shrink-0 text-xs underline"
                >
                  compare
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
