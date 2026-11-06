import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { listExperiments, scoreSummary } from '@/lib/evals';
import { formatUsd } from '@/lib/pricing';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { CopyBlock } from '@/components/CopyField';
import { formatDuration, formatRelative } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

const RUN_SNIPPET = `import { Glassfish, scorers } from 'glassfish-zero';

const summary = await gf.experiment({
  name: 'opus-5 baseline',
  dataset: 'support-questions',
  targetModel: 'claude-opus-5',
  task: async (example) => {
    const message = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: example.input.question }],
    });
    return message.content[0].text;
  },
  scorers: [
    scorers.contains(),
    scorers.maxLatency(8000),
    scorers.llmJudge({
      client: anthropic,                  // your key, your process
      model: 'claude-opus-5',
      criteria: 'Does the answer resolve the question accurately and without invention?',
    }),
  ],
});

console.log(summary.scores);`;

export default async function ExperimentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dataset?: string }>;
}) {
  const { slug } = await params;
  const { dataset } = await searchParams;
  const { project } = await requireProject(slug);

  const experiments = listExperiments(project.id, dataset);
  const summaries = new Map(experiments.map((e) => [e.id, scoreSummary(e.id)]));
  const scorerNames = [
    ...new Set([...summaries.values()].flatMap((s) => s.map((x) => x.name))),
  ].sort();

  return (
    <>
      <PageHeader
        title="Experiments"
        description="A run of a dataset through a task, scored. Two runs on the same dataset can be compared example by example."
        action={
          experiments.length >= 2 ? (
            <Link
              href={`/p/${slug}/experiments/compare?a=${experiments[1].id}&b=${experiments[0].id}`}
              className="btn btn-ghost"
            >
              Compare latest two
            </Link>
          ) : null
        }
      />

      {experiments.length === 0 ? (
        <>
          <EmptyState title="No runs yet">
            Experiments are started from your code — the runner executes in your process, so the
            judge uses your provider key and the dashboard never holds one.
          </EmptyState>
          <Card title="Run one" className="mt-5">
            <CopyBlock code={RUN_SNIPPET} />
          </Card>
        </>
      ) : (
        <Card className="p-0">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Dataset</th>
                  <th>Model</th>
                  <th className="num">Results</th>
                  {scorerNames.map((name) => (
                    <th key={name} className="num">
                      {name}
                    </th>
                  ))}
                  <th className="num">Cost</th>
                  <th className="num">Avg latency</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {experiments.map((experiment) => {
                  const scores = new Map(
                    (summaries.get(experiment.id) ?? []).map((s) => [s.name, s]),
                  );
                  return (
                    <tr key={experiment.id}>
                      <td>
                        <Link
                          href={`/p/${slug}/experiments/${experiment.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {experiment.name}
                        </Link>
                        {experiment.errorCount > 0 ? (
                          <div className="mt-0.5">
                            <Badge tone="critical">✕ {experiment.errorCount} failed</Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className="text-ink-2">{experiment.datasetName ?? '—'}</td>
                      <td className="font-mono text-xs">{experiment.targetModel ?? '—'}</td>
                      <td className="num tnum">{experiment.resultCount}</td>
                      {scorerNames.map((name) => {
                        const score = scores.get(name);
                        return (
                          <td key={name} className="num tnum">
                            {score?.mean === null || score === undefined ? (
                              <span className="text-ink-muted">—</span>
                            ) : score.passRate !== null ? (
                              `${(score.passRate * 100).toFixed(0)}%`
                            ) : (
                              score.mean.toFixed(2)
                            )}
                          </td>
                        );
                      })}
                      <td className="num tnum">{formatUsd(experiment.costUsd)}</td>
                      <td className="num tnum">{formatDuration(experiment.avgLatencyMs)}</td>
                      <td className="whitespace-nowrap text-ink-2">
                        {formatRelative(experiment.startedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-hairline px-4 py-3 text-xs text-ink-muted">
            A percentage is a pass rate, shown only when that scorer emits 0 or 1. Continuous
            scorers show their mean instead — a 0.73 mean is not &ldquo;73% passed&rdquo;.
          </p>
        </Card>
      )}
    </>
  );
}
