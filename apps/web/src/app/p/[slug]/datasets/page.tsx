import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { listDatasets, listExperiments } from '@/lib/evals';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { CopyBlock } from '@/components/CopyField';
import { formatRelative } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

const PUSH_SNIPPET = `await gf.datasets.push('support-questions', [
  {
    externalId: 'q-1',                       // stable key: re-pushing updates in place
    input: { question: 'How do I cancel?' },
    expected: 'Settings → Billing → Cancel',
  },
  // …
]);`;

export default async function DatasetsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { project } = await requireProject(slug);

  const datasets = listDatasets(project.id);
  const experiments = listExperiments(project.id);
  const runsByDataset = new Map<string, number>();
  for (const experiment of experiments) {
    if (!experiment.datasetId) continue;
    runsByDataset.set(experiment.datasetId, (runsByDataset.get(experiment.datasetId) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Fixed sets of inputs you run a task against, so two versions can be compared on the same ground."
      />

      {datasets.length === 0 ? (
        <>
          <EmptyState title="No datasets yet">
            Push one from your code — datasets are created on first write, there is nothing to set
            up here first.
          </EmptyState>
          <Card title="Create one" className="mt-5">
            <CopyBlock code={PUSH_SNIPPET} />
            <p className="m-0 mt-3 text-sm text-ink-2">
              Give each example a stable <code className="font-mono">externalId</code>. Re-running
              the push then updates rows in place instead of appending a second copy of the whole
              set — which would silently double the cost of every later run.
            </p>
          </Card>
        </>
      ) : (
        <Card className="p-0">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th className="num">Examples</th>
                  <th className="num">Runs</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>
                      <Link
                        href={`/p/${slug}/datasets/${encodeURIComponent(dataset.name)}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {dataset.name}
                      </Link>
                      {dataset.description ? (
                        <div className="text-xs text-ink-muted">{dataset.description}</div>
                      ) : null}
                    </td>
                    <td className="num tnum">{dataset.exampleCount.toLocaleString('en-US')}</td>
                    <td className="num tnum">{runsByDataset.get(dataset.id) ?? 0}</td>
                    <td className="whitespace-nowrap text-ink-2">
                      {formatRelative(dataset.updatedAt)}
                    </td>
                    <td>
                      <Link
                        href={`/p/${slug}/experiments?dataset=${encodeURIComponent(dataset.id)}`}
                        className="btn btn-ghost px-2 py-1 text-xs"
                      >
                        Runs
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
