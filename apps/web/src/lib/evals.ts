import { getDb } from './db';
import { newId } from './auth';

/**
 * Evaluation storage: datasets, experiments, results and scores.
 *
 * The execution model is deliberate. Experiments are **run by the SDK, inside
 * your own process**, and report results back here. The dashboard never holds
 * a provider API key, so an LLM-as-judge call is made with your credentials in
 * your infrastructure — a self-hosted observability tool that accumulates
 * everyone's provider keys is a worse liability than the problem it solves.
 */

export interface Dataset {
  id: string;
  projectId: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  exampleCount: number;
}

export interface DatasetExample {
  id: string;
  datasetId: string;
  externalId: string | null;
  input: unknown;
  expected: unknown;
  metadata: Record<string, unknown> | null;
  split: string;
  position: number;
}

export interface Experiment {
  id: string;
  projectId: string;
  datasetId: string | null;
  datasetName: string | null;
  name: string;
  description: string;
  targetModel: string | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
  exampleCount: number;
  resultCount: number;
  errorCount: number;
  costUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  metadata: Record<string, unknown> | null;
}

export interface ScoreSummary {
  name: string;
  /** Mean of the numeric values; null when the scorer only emits labels. */
  mean: number | null;
  count: number;
  /** Share of results scoring 1 (or true) for a pass/fail scorer. */
  passRate: number | null;
}

export interface ExperimentResult {
  id: string;
  experimentId: string;
  externalId: string | null;
  traceId: string | null;
  input: unknown;
  expected: unknown;
  output: string | null;
  status: string;
  errorMessage: string | null;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  scores: Score[];
}

export interface Score {
  id: string;
  name: string;
  value: number | null;
  label: string | null;
  comment: string | null;
  source: string;
  judgeModel: string | null;
  createdAt: number;
}

function parse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// --------------------------------------------------------------- datasets

export function listDatasets(projectId: string): Dataset[] {
  return getDb()
    .prepare<
      [string],
      {
        id: string;
        project_id: string;
        name: string;
        description: string;
        created_at: number;
        updated_at: number;
        example_count: number;
      }
    >(
      `SELECT d.*, (SELECT COUNT(*) FROM dataset_examples e WHERE e.dataset_id = d.id) AS example_count
         FROM datasets d WHERE d.project_id = ? ORDER BY d.updated_at DESC`,
    )
    .all(projectId)
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      exampleCount: row.example_count,
    }));
}

export function getDataset(projectId: string, idOrName: string): Dataset | null {
  const row = getDb()
    .prepare<
      [string, string, string],
      {
        id: string;
        project_id: string;
        name: string;
        description: string;
        created_at: number;
        updated_at: number;
        example_count: number;
      }
    >(
      `SELECT d.*, (SELECT COUNT(*) FROM dataset_examples e WHERE e.dataset_id = d.id) AS example_count
         FROM datasets d WHERE d.project_id = ? AND (d.id = ? OR d.name = ?)`,
    )
    .get(projectId, idOrName, idOrName);

  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    exampleCount: row.example_count,
  };
}

export function upsertDataset(
  projectId: string,
  name: string,
  description = '',
): Dataset {
  const existing = getDataset(projectId, name);
  const now = Date.now();

  if (existing) {
    if (description && description !== existing.description) {
      getDb()
        .prepare('UPDATE datasets SET description = ?, updated_at = ? WHERE id = ?')
        .run(description, now, existing.id);
    }
    return { ...existing, description: description || existing.description };
  }

  const id = newId('ds');
  getDb()
    .prepare(
      'INSERT INTO datasets (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, projectId, name, description, now, now);

  return {
    id,
    projectId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
    exampleCount: 0,
  };
}

export interface ExampleInput {
  externalId?: string | null;
  input: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown> | null;
  split?: string;
}

/**
 * Add or update examples.
 *
 * Rows carrying an `externalId` are matched on it, so re-pushing a dataset
 * from a script updates in place rather than appending a second copy of
 * everything — the failure mode that silently doubles the cost of every
 * subsequent run.
 */
export function putExamples(datasetId: string, examples: ExampleInput[]): number {
  const db = getDb();
  const now = Date.now();

  const maxPosition =
    db
      .prepare<[string], { p: number | null }>(
        'SELECT MAX(position) AS p FROM dataset_examples WHERE dataset_id = ?',
      )
      .get(datasetId)?.p ?? -1;

  let position = (maxPosition ?? -1) + 1;
  let written = 0;

  db.transaction(() => {
    for (const example of examples) {
      const externalId = example.externalId ?? null;
      const existing = externalId
        ? db
            .prepare<[string, string], { id: string; position: number }>(
              'SELECT id, position FROM dataset_examples WHERE dataset_id = ? AND external_id = ?',
            )
            .get(datasetId, externalId)
        : undefined;

      if (existing) {
        db.prepare(
          `UPDATE dataset_examples
              SET input_json = ?, expected_json = ?, metadata_json = ?, split = ?, updated_at = ?
            WHERE id = ?`,
        ).run(
          stringify(example.input) ?? 'null',
          stringify(example.expected),
          stringify(example.metadata),
          example.split ?? 'test',
          now,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO dataset_examples
             (id, dataset_id, external_id, input_json, expected_json, metadata_json, split, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId('ex'),
          datasetId,
          externalId,
          stringify(example.input) ?? 'null',
          stringify(example.expected),
          stringify(example.metadata),
          example.split ?? 'test',
          position,
          now,
          now,
        );
        position += 1;
      }
      written += 1;
    }
    db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(now, datasetId);
  })();

  return written;
}

export function listExamples(datasetId: string, limit = 500): DatasetExample[] {
  return getDb()
    .prepare<
      [string, number],
      {
        id: string;
        dataset_id: string;
        external_id: string | null;
        input_json: string;
        expected_json: string | null;
        metadata_json: string | null;
        split: string;
        position: number;
      }
    >(
      'SELECT * FROM dataset_examples WHERE dataset_id = ? ORDER BY position LIMIT ?',
    )
    .all(datasetId, limit)
    .map((row) => ({
      id: row.id,
      datasetId: row.dataset_id,
      externalId: row.external_id,
      input: parse(row.input_json),
      expected: parse(row.expected_json),
      metadata: parse<Record<string, unknown>>(row.metadata_json),
      split: row.split,
      position: row.position,
    }));
}

export function deleteExample(datasetId: string, exampleId: string): void {
  getDb()
    .prepare('DELETE FROM dataset_examples WHERE dataset_id = ? AND id = ?')
    .run(datasetId, exampleId);
}

// ------------------------------------------------------------ experiments

export function createExperiment(
  projectId: string,
  payload: {
    name: string;
    description?: string;
    datasetId?: string | null;
    targetModel?: string | null;
    exampleCount?: number;
    metadata?: Record<string, unknown> | null;
  },
): string {
  const id = newId('exp');
  getDb()
    .prepare(
      `INSERT INTO experiments
         (id, project_id, dataset_id, name, description, target_model, status,
          started_at, example_count, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      payload.datasetId ?? null,
      payload.name,
      payload.description ?? '',
      payload.targetModel ?? null,
      Date.now(),
      payload.exampleCount ?? 0,
      stringify(payload.metadata),
    );
  return id;
}

export interface ResultInput {
  externalId?: string | null;
  exampleId?: string | null;
  traceId?: string | null;
  input?: unknown;
  expected?: unknown;
  output?: string | null;
  status?: string;
  errorMessage?: string | null;
  latencyMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  scores?: {
    name: string;
    value?: number | null;
    label?: string | null;
    comment?: string | null;
    source?: string;
    judgeModel?: string | null;
    judgeCostUsd?: number;
  }[];
}

export function addResults(
  projectId: string,
  experimentId: string,
  results: ResultInput[],
): number {
  const db = getDb();
  const now = Date.now();

  db.transaction(() => {
    for (const result of results) {
      const resultId = newId('res');
      db.prepare(
        `INSERT INTO experiment_results
           (id, experiment_id, example_id, external_id, trace_id, input_json, expected_json,
            output_text, status, error_message, latency_ms, cost_usd, input_tokens,
            output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        resultId,
        experimentId,
        result.exampleId ?? null,
        result.externalId ?? null,
        result.traceId ?? null,
        stringify(result.input),
        stringify(result.expected),
        result.output ?? null,
        result.status === 'error' ? 'error' : 'ok',
        result.errorMessage ?? null,
        Math.max(0, Math.round(result.latencyMs ?? 0)),
        result.costUsd ?? 0,
        Math.max(0, Math.round(result.inputTokens ?? 0)),
        Math.max(0, Math.round(result.outputTokens ?? 0)),
        now,
      );

      for (const score of result.scores ?? []) {
        db.prepare(
          `INSERT INTO scores
             (id, project_id, result_id, experiment_id, trace_id, name, value, label,
              comment, source, judge_model, judge_cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId('sc'),
          projectId,
          resultId,
          experimentId,
          result.traceId ?? null,
          score.name,
          typeof score.value === 'number' && Number.isFinite(score.value) ? score.value : null,
          score.label ?? null,
          score.comment ?? null,
          score.source ?? 'code',
          score.judgeModel ?? null,
          score.judgeCostUsd ?? 0,
          now,
        );
      }
    }
    rollUpExperiment(experimentId);
  })();

  return results.length;
}

/** Derived from the results, so a retried batch cannot double a total. */
export function rollUpExperiment(experimentId: string, finish = false): void {
  const db = getDb();

  if (finish) {
    // Spans flush asynchronously, so a result's trace usually lands *after*
    // the result row does. Cost is therefore copied from the trace at close
    // time rather than reported by the runner — one source of truth, and it
    // stays correct if the price table is corrected and history re-priced.
    db.prepare(
      `UPDATE experiment_results
          SET cost_usd      = t.cost_usd,
              input_tokens  = t.input_tokens,
              output_tokens = t.output_tokens
         FROM traces t
        WHERE experiment_results.trace_id = t.id
          AND experiment_results.experiment_id = ?`,
    ).run(experimentId);
  }

  const agg = db
    .prepare<
      [string],
      {
        n: number;
        errors: number;
        cost: number;
        tokens: number;
        latency: number;
      }
    >(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(AVG(latency_ms), 0) AS latency
         FROM experiment_results WHERE experiment_id = ?`,
    )
    .get(experimentId);

  const judgeCost =
    db
      .prepare<[string], { c: number }>(
        'SELECT COALESCE(SUM(judge_cost_usd), 0) AS c FROM scores WHERE experiment_id = ?',
      )
      .get(experimentId)?.c ?? 0;

  db.prepare(
    `UPDATE experiments
        SET result_count = ?, error_count = ?, cost_usd = ?, total_tokens = ?, avg_latency_ms = ?
            ${finish ? ", status = 'completed', ended_at = ?" : ''}
      WHERE id = ?`,
  ).run(
    ...(finish
      ? [
          agg?.n ?? 0,
          agg?.errors ?? 0,
          (agg?.cost ?? 0) + judgeCost,
          agg?.tokens ?? 0,
          agg?.latency ?? 0,
          Date.now(),
          experimentId,
        ]
      : [
          agg?.n ?? 0,
          agg?.errors ?? 0,
          (agg?.cost ?? 0) + judgeCost,
          agg?.tokens ?? 0,
          agg?.latency ?? 0,
          experimentId,
        ]),
  );
}

interface ExperimentRow {
  id: string;
  project_id: string;
  dataset_id: string | null;
  dataset_name: string | null;
  name: string;
  description: string;
  target_model: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  example_count: number;
  result_count: number;
  error_count: number;
  cost_usd: number;
  total_tokens: number;
  avg_latency_ms: number;
  metadata_json: string | null;
}

function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    projectId: row.project_id,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name,
    name: row.name,
    description: row.description,
    targetModel: row.target_model,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exampleCount: row.example_count,
    resultCount: row.result_count,
    errorCount: row.error_count,
    costUsd: row.cost_usd,
    totalTokens: row.total_tokens,
    avgLatencyMs: row.avg_latency_ms,
    metadata: parse<Record<string, unknown>>(row.metadata_json),
  };
}

const EXPERIMENT_SELECT = `
  SELECT e.*, d.name AS dataset_name
    FROM experiments e LEFT JOIN datasets d ON d.id = e.dataset_id`;

export function listExperiments(projectId: string, datasetId?: string): Experiment[] {
  const db = getDb();
  const rows = datasetId
    ? db
        .prepare<[string, string], ExperimentRow>(
          `${EXPERIMENT_SELECT} WHERE e.project_id = ? AND e.dataset_id = ? ORDER BY e.started_at DESC`,
        )
        .all(projectId, datasetId)
    : db
        .prepare<[string], ExperimentRow>(
          `${EXPERIMENT_SELECT} WHERE e.project_id = ? ORDER BY e.started_at DESC`,
        )
        .all(projectId);
  return rows.map(toExperiment);
}

export function getExperiment(projectId: string, id: string): Experiment | null {
  const row = getDb()
    .prepare<[string, string], ExperimentRow>(
      `${EXPERIMENT_SELECT} WHERE e.project_id = ? AND e.id = ?`,
    )
    .get(projectId, id);
  return row ? toExperiment(row) : null;
}

/**
 * Mean and pass-rate per scorer.
 *
 * `passRate` is only meaningful when a scorer emits 0/1, so it is reported as
 * null unless every value in the set is 0 or 1 — a 0.73 mean must not be
 * presented as "73% passed" when the scorer is a continuous similarity score.
 */
export function scoreSummary(experimentId: string): ScoreSummary[] {
  return getDb()
    .prepare<
      [string],
      { name: string; mean: number | null; n: number; binary: number; passes: number }
    >(
      `SELECT name,
              AVG(value)                                             AS mean,
              COUNT(*)                                               AS n,
              MIN(CASE WHEN value IN (0, 1) OR value IS NULL THEN 1 ELSE 0 END) AS binary,
              SUM(CASE WHEN value >= 1 THEN 1 ELSE 0 END)            AS passes
         FROM scores WHERE experiment_id = ?
        GROUP BY name ORDER BY name`,
    )
    .all(experimentId)
    .map((row) => ({
      name: row.name,
      mean: row.mean,
      count: row.n,
      passRate: row.binary === 1 && row.n > 0 ? row.passes / row.n : null,
    }));
}

export function listResults(experimentId: string, limit = 500): ExperimentResult[] {
  const db = getDb();
  const rows = db
    .prepare<
      [string, number],
      {
        id: string;
        experiment_id: string;
        external_id: string | null;
        trace_id: string | null;
        input_json: string | null;
        expected_json: string | null;
        output_text: string | null;
        status: string;
        error_message: string | null;
        latency_ms: number;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
      }
    >('SELECT * FROM experiment_results WHERE experiment_id = ? ORDER BY created_at, id LIMIT ?')
    .all(experimentId, limit);

  const scores = db
    .prepare<
      [string],
      {
        id: string;
        result_id: string;
        name: string;
        value: number | null;
        label: string | null;
        comment: string | null;
        source: string;
        judge_model: string | null;
        created_at: number;
      }
    >('SELECT * FROM scores WHERE experiment_id = ?')
    .all(experimentId);

  const byResult = new Map<string, Score[]>();
  for (const score of scores) {
    if (!score.result_id) continue;
    const list = byResult.get(score.result_id) ?? [];
    list.push({
      id: score.id,
      name: score.name,
      value: score.value,
      label: score.label,
      comment: score.comment,
      source: score.source,
      judgeModel: score.judge_model,
      createdAt: score.created_at,
    });
    byResult.set(score.result_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    experimentId: row.experiment_id,
    externalId: row.external_id,
    traceId: row.trace_id,
    input: parse(row.input_json),
    expected: parse(row.expected_json),
    output: row.output_text,
    status: row.status,
    errorMessage: row.error_message,
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    scores: (byResult.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// ----------------------------------------------------------------- scores

export function addScore(
  projectId: string,
  payload: {
    traceId?: string | null;
    resultId?: string | null;
    experimentId?: string | null;
    name: string;
    value?: number | null;
    label?: string | null;
    comment?: string | null;
    source?: string;
    judgeModel?: string | null;
  },
): string {
  const id = newId('sc');
  getDb()
    .prepare(
      `INSERT INTO scores
         (id, project_id, result_id, experiment_id, trace_id, name, value, label,
          comment, source, judge_model, judge_cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      projectId,
      payload.resultId ?? null,
      payload.experimentId ?? null,
      payload.traceId ?? null,
      payload.name,
      typeof payload.value === 'number' && Number.isFinite(payload.value) ? payload.value : null,
      payload.label ?? null,
      payload.comment ?? null,
      payload.source ?? 'human',
      payload.judgeModel ?? null,
      Date.now(),
    );
  return id;
}

export function traceScores(projectId: string, traceId: string): Score[] {
  return getDb()
    .prepare<
      [string, string],
      {
        id: string;
        name: string;
        value: number | null;
        label: string | null;
        comment: string | null;
        source: string;
        judge_model: string | null;
        created_at: number;
      }
    >(
      'SELECT * FROM scores WHERE project_id = ? AND trace_id = ? ORDER BY created_at DESC',
    )
    .all(projectId, traceId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      value: row.value,
      label: row.label,
      comment: row.comment,
      source: row.source,
      judgeModel: row.judge_model,
      createdAt: row.created_at,
    }));
}

export function deleteScore(projectId: string, scoreId: string): void {
  getDb().prepare('DELETE FROM scores WHERE project_id = ? AND id = ?').run(projectId, scoreId);
}

// ---------------------------------------------------------------- compare

export interface ComparisonRow {
  key: string;
  input: unknown;
  expected: unknown;
  aOutput: string | null;
  bOutput: string | null;
  aScores: Record<string, number | null>;
  bScores: Record<string, number | null>;
  deltas: Record<string, number>;
  /** A scorer dropped from pass to fail, or fell by more than the threshold. */
  regressed: boolean;
  improved: boolean;
}

export interface Comparison {
  rows: ComparisonRow[];
  scorers: string[];
  summary: {
    scorer: string;
    aMean: number | null;
    bMean: number | null;
    delta: number | null;
    regressions: number;
    improvements: number;
  }[];
  costDelta: number;
  latencyDelta: number;
  unmatched: { onlyInA: number; onlyInB: number };
}

const REGRESSION_THRESHOLD = 0.0001;

/**
 * Pair two experiments example by example.
 *
 * Matching prefers the caller's stable `externalId`; without one it falls back
 * to the serialised input. Rows that exist on only one side are reported
 * rather than dropped — a comparison that silently ignores half the dataset
 * is how a regression gets shipped.
 */
export function compareExperiments(
  projectId: string,
  idA: string,
  idB: string,
): Comparison | null {
  const a = getExperiment(projectId, idA);
  const b = getExperiment(projectId, idB);
  if (!a || !b) return null;

  const rowsA = listResults(idA, 2000);
  const rowsB = listResults(idB, 2000);

  const keyOf = (r: ExperimentResult) => r.externalId ?? stringify(r.input) ?? r.id;
  const mapB = new Map(rowsB.map((r) => [keyOf(r), r]));

  const scorers = [
    ...new Set([
      ...rowsA.flatMap((r) => r.scores.map((s) => s.name)),
      ...rowsB.flatMap((r) => r.scores.map((s) => s.name)),
    ]),
  ].sort();

  const rows: ComparisonRow[] = [];
  let matched = 0;

  for (const rowA of rowsA) {
    const key = keyOf(rowA);
    const rowB = mapB.get(key);
    if (!rowB) continue;
    matched += 1;
    mapB.delete(key);

    const aScores = scoreMap(rowA, scorers);
    const bScores = scoreMap(rowB, scorers);
    const deltas: Record<string, number> = {};
    let regressed = false;
    let improved = false;

    for (const scorer of scorers) {
      const left = aScores[scorer];
      const right = bScores[scorer];
      if (left === null || right === null) continue;
      const delta = right - left;
      deltas[scorer] = delta;
      if (delta < -REGRESSION_THRESHOLD) regressed = true;
      if (delta > REGRESSION_THRESHOLD) improved = true;
    }

    rows.push({
      key,
      input: rowA.input,
      expected: rowA.expected,
      aOutput: rowA.output,
      bOutput: rowB.output,
      aScores,
      bScores,
      deltas,
      regressed,
      improved,
    });
  }

  // Regressions first: the reason to open this page is to find what broke.
  rows.sort((x, y) => {
    if (x.regressed !== y.regressed) return x.regressed ? -1 : 1;
    if (x.improved !== y.improved) return x.improved ? -1 : 1;
    return 0;
  });

  const summaryA = new Map(scoreSummary(idA).map((s) => [s.name, s]));
  const summaryB = new Map(scoreSummary(idB).map((s) => [s.name, s]));

  return {
    rows,
    scorers,
    summary: scorers.map((scorer) => {
      const aMean = summaryA.get(scorer)?.mean ?? null;
      const bMean = summaryB.get(scorer)?.mean ?? null;
      return {
        scorer,
        aMean,
        bMean,
        delta: aMean !== null && bMean !== null ? bMean - aMean : null,
        regressions: rows.filter((r) => (r.deltas[scorer] ?? 0) < -REGRESSION_THRESHOLD).length,
        improvements: rows.filter((r) => (r.deltas[scorer] ?? 0) > REGRESSION_THRESHOLD).length,
      };
    }),
    costDelta: b.costUsd - a.costUsd,
    latencyDelta: b.avgLatencyMs - a.avgLatencyMs,
    unmatched: { onlyInA: rowsA.length - matched, onlyInB: mapB.size },
  };
}

function scoreMap(result: ExperimentResult, scorers: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const scorer of scorers) {
    const found = result.scores.find((s) => s.name === scorer);
    out[scorer] = found?.value ?? null;
  }
  return out;
}
