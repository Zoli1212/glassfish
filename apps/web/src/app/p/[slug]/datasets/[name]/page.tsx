import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProject } from '@/lib/auth';
import { getDataset, listExamples, listExperiments } from '@/lib/evals';
import { Card, EmptyState, PageHeader, StatTile } from '@/components/ui';
import { formatRelative, formatTime } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

function preview(value: unknown, max = 220): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ slug: string; name: string }>;
}) {
  const { slug, name } = await params;
  const { project } = await requireProject(slug);

  const dataset = getDataset(project.id, decodeURIComponent(name));
  if (!dataset) notFound();

  const examples = listExamples(dataset.id, 500);
  const runs = listExperiments(project.id, dataset.id);
  const splits = [...new Set(examples.map((e) => e.split))];

  return (
    <>
      <PageHeader
        title={dataset.name}
        description={dataset.description || 'No description.'}
        action={
          <Link href={`/p/${slug}/datasets`} className="btn btn-ghost">
            All datasets
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Examples" value={dataset.exampleCount.toLocaleString('en-US')} />
        <StatTile label="Splits" value={splits.length} sub={splits.join(' · ')} />
        <StatTile label="Runs" value={runs.length} />
        <StatTile label="Updated" value={formatRelative(dataset.updatedAt)} sub={formatTime(dataset.updatedAt)} />
      </div>

      {runs.length > 0 ? (
        <Card title="Runs against this dataset" className="mb-6">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {runs.slice(0, 8).map((run) => (
              <li key={run.id}>
                <Link
                  href={`/p/${slug}/experiments/${run.id}`}
                  className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"
                >
                  <span className="truncate font-medium">{run.name}</span>
                  <span className="tnum shrink-0 text-xs text-ink-2">
                    {run.resultCount} result(s) · {formatRelative(run.startedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {runs.length > 1 ? (
            <Link
              href={`/p/${slug}/experiments/compare?a=${runs[1].id}&b=${runs[0].id}`}
              className="btn btn-ghost mt-3"
            >
              Compare the two most recent
            </Link>
          ) : null}
        </Card>
      ) : null}

      {examples.length === 0 ? (
        <EmptyState title="This dataset has no examples yet">
          Push some with <code className="font-mono">gf.datasets.push(…)</code>.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>External id</th>
                  <th>Input</th>
                  <th>Expected</th>
                  <th>Split</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((example, index) => (
                  <tr key={example.id}>
                    <td className="tnum text-ink-muted">{index + 1}</td>
                    <td className="font-mono text-xs">{example.externalId ?? '—'}</td>
                    <td className="max-w-md align-top text-xs">{preview(example.input)}</td>
                    <td className="max-w-md align-top text-xs text-ink-2">
                      {preview(example.expected)}
                    </td>
                    <td className="text-xs text-ink-2">{example.split}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dataset.exampleCount > examples.length ? (
            <p className="m-0 border-t border-hairline px-4 py-3 text-xs text-ink-muted">
              Showing the first {examples.length.toLocaleString('en-US')} of{' '}
              {dataset.exampleCount.toLocaleString('en-US')}.
            </p>
          ) : null}
        </Card>
      )}
    </>
  );
}
