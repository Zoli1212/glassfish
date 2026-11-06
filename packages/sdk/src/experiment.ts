import type {
  DatasetExample,
  ExperimentOptions,
  ExperimentSummary,
  ScoreOutput,
  TaskContext,
} from './eval-types';
import { describeError, now } from './utils';

/** Minimal surface the runner needs from the client, to keep the two decoupled. */
export interface EvalTransport {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>;
  trace<T>(name: string, fn: (trace: { id: string }) => Promise<T>): Promise<T>;
  flush(): Promise<unknown>;
  baseUrl: string;
}

interface ResultPayload {
  externalId: string | null;
  exampleId: string | null;
  traceId: string | null;
  input: unknown;
  expected: unknown;
  output: string | null;
  status: 'ok' | 'error';
  errorMessage: string | null;
  latencyMs: number;
  scores: {
    name: string;
    value: number | null;
    label?: string;
    comment?: string;
    source: string;
    judgeModel?: string;
    judgeCostUsd?: number;
  }[];
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Run a dataset through a task and score every result.
 *
 * Each example runs inside its own trace, so the spans the task produces are
 * linked to the result row and the dashboard can show cost per example
 * without the runner having to account for it.
 *
 * One example failing does not stop the run: the failure is recorded with its
 * message and the remaining examples still execute, because a run that aborts
 * halfway tells you nothing about the other half.
 */
export async function runExperiment<T>(
  transport: EvalTransport,
  options: ExperimentOptions<T>,
): Promise<ExperimentSummary> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 32));
  const scorers = options.scorers ?? [];

  const pulled = await transport.request<{
    dataset: { id: string; name: string };
    examples: DatasetExample[];
  }>('GET', `/api/v1/datasets/${encodeURIComponent(options.dataset)}${
    options.split ? `?split=${encodeURIComponent(options.split)}` : ''
  }`);

  const examples =
    typeof options.limit === 'number' ? pulled.examples.slice(0, options.limit) : pulled.examples;

  if (examples.length === 0) {
    throw new Error(
      `dataset "${options.dataset}" has no examples${options.split ? ` in split "${options.split}"` : ''}`,
    );
  }

  const created = await transport.request<{ experiment: { id: string } }>(
    'POST',
    '/api/v1/experiments',
    {
      name: options.name,
      description: options.description,
      dataset: options.dataset,
      targetModel: options.targetModel,
      exampleCount: examples.length,
      metadata: options.metadata,
    },
  );
  const experimentId = created.experiment.id;

  const pending: ResultPayload[] = [];
  let completed = 0;

  const flushResults = async () => {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    await transport.request('POST', `/api/v1/experiments/${experimentId}/results`, {
      results: batch,
    });
  };

  const runOne = async (example: DatasetExample) => {
    const startedAt = now();
    let output: unknown;
    let failure: { type: string; message: string } | undefined;
    let traceId: string | null = null;

    try {
      output = await transport.trace(`experiment:${options.name}`, async (trace) => {
        traceId = trace.id;
        return options.task(example);
      });
    } catch (error) {
      failure = describeError(error);
    }

    const latencyMs = now() - startedAt;
    const context: TaskContext = {
      example,
      input: example.input,
      expected: example.expected,
      output,
      latencyMs,
      traceId: traceId ?? '',
    };

    const scores: ResultPayload['scores'] = [];
    if (!failure) {
      for (const scorer of scorers) {
        try {
          const result: ScoreOutput = await scorer.score(context);
          scores.push({
            name: scorer.name,
            value: result.value,
            label: result.label,
            comment: result.comment,
            source: result.judgeModel ? 'judge' : 'code',
            judgeModel: result.judgeModel,
            judgeCostUsd: result.judgeCostUsd,
          });
        } catch (error) {
          // A broken scorer must not take the example down with it, and must
          // not be recorded as a zero — that would look like a failed output.
          const { message } = describeError(error);
          scores.push({
            name: scorer.name,
            value: null,
            comment: `scorer threw: ${message}`,
            source: 'code',
          });
        }
      }
    }

    pending.push({
      externalId: example.externalId ?? null,
      exampleId: example.id ?? null,
      traceId,
      input: example.input,
      expected: example.expected,
      output: asText(output),
      status: failure ? 'error' : 'ok',
      errorMessage: failure ? `${failure.type}: ${failure.message}` : null,
      latencyMs,
      scores,
    });

    completed += 1;
    options.onProgress?.(completed, examples.length);

    if (pending.length >= 25) await flushResults();
  };

  // Fixed-size worker pool: examples are pulled off a shared cursor, so a slow
  // one does not idle the other workers the way chunked batches would.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, examples.length) }, async () => {
    while (cursor < examples.length) {
      const index = cursor;
      cursor += 1;
      await runOne(examples[index]);
    }
  });
  await Promise.all(workers);

  await flushResults();
  // Spans must land before the experiment closes, or the dashboard shows
  // results whose traces have not arrived yet.
  await transport.flush();

  const finished = await transport.request<{
    experiment: {
      id: string;
      name: string;
      resultCount: number;
      errorCount: number;
      costUsd: number;
      avgLatencyMs: number;
    };
    scores: ExperimentSummary['scores'];
  }>('POST', `/api/v1/experiments/${experimentId}/finish`);

  return {
    id: finished.experiment.id,
    name: finished.experiment.name,
    resultCount: finished.experiment.resultCount,
    errorCount: finished.experiment.errorCount,
    costUsd: finished.experiment.costUsd,
    avgLatencyMs: finished.experiment.avgLatencyMs,
    scores: finished.scores,
    url: `${transport.baseUrl.replace(/\/+$/, '')}/experiments/${experimentId}`,
  };
}
