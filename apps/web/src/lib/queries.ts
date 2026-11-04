import { getDb } from './db';

export interface Overview {
  traces: number;
  llmCalls: number;
  spans: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  unpricedCalls: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTtftMs: number | null;
}

const EMPTY_OVERVIEW: Overview = {
  traces: 0,
  llmCalls: 0,
  spans: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: 0,
  unpricedCalls: 0,
  avgLatencyMs: 0,
  p50LatencyMs: 0,
  p95LatencyMs: 0,
  avgTtftMs: null,
};

export function overview(projectId: string, since: number, until = Date.now()): Overview {
  const db = getDb();
  const row = db
    .prepare<[string, number, number], Record<string, number | null>>(
      `SELECT
         COUNT(*)                                         AS spans,
         SUM(CASE WHEN kind = 'llm' THEN 1 ELSE 0 END)    AS llm_calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
         COALESCE(SUM(input_tokens), 0)                   AS input_tokens,
         COALESCE(SUM(output_tokens), 0)                  AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0)              AS cache_read_tokens,
         COALESCE(SUM(cache_write_tokens), 0)             AS cache_write_tokens,
         COALESCE(SUM(cost_total), 0)                     AS cost,
         SUM(CASE WHEN kind = 'llm' AND priced = 0 AND
                       (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) > 0
                  THEN 1 ELSE 0 END)                      AS unpriced_calls,
         AVG(CASE WHEN kind = 'llm' THEN duration_ms END) AS avg_latency,
         AVG(ttft_ms)                                     AS avg_ttft
       FROM spans
       WHERE project_id = ? AND started_at >= ? AND started_at <= ?`,
    )
    .get(projectId, since, until);

  if (!row) return EMPTY_OVERVIEW;

  const traces = db
    .prepare<[string, number, number], { n: number }>(
      'SELECT COUNT(*) AS n FROM traces WHERE project_id = ? AND started_at >= ? AND started_at <= ?',
    )
    .get(projectId, since, until);

  const inputTokens = num(row.input_tokens);
  const outputTokens = num(row.output_tokens);
  const cacheRead = num(row.cache_read_tokens);
  const cacheWrite = num(row.cache_write_tokens);

  return {
    traces: traces?.n ?? 0,
    llmCalls: num(row.llm_calls),
    spans: num(row.spans),
    errors: num(row.errors),
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
    cost: num(row.cost),
    unpricedCalls: num(row.unpriced_calls),
    avgLatencyMs: Math.round(num(row.avg_latency)),
    p50LatencyMs: percentileLatency(projectId, since, until, 0.5),
    p95LatencyMs: percentileLatency(projectId, since, until, 0.95),
    avgTtftMs: row.avg_ttft === null ? null : Math.round(num(row.avg_ttft)),
  };
}

/**
 * SQLite has no percentile function, so take the nth row of the sorted
 * durations. Exact rather than interpolated — fine for a latency readout.
 */
function percentileLatency(
  projectId: string,
  since: number,
  until: number,
  p: number,
): number {
  const db = getDb();
  const count = db
    .prepare<[string, number, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM spans
        WHERE project_id = ? AND kind = 'llm' AND started_at >= ? AND started_at <= ?`,
    )
    .get(projectId, since, until)?.n ?? 0;
  if (count === 0) return 0;

  const offset = Math.min(count - 1, Math.max(0, Math.floor(count * p)));
  const row = db
    .prepare<[string, number, number, number], { duration_ms: number }>(
      `SELECT duration_ms FROM spans
        WHERE project_id = ? AND kind = 'llm' AND started_at >= ? AND started_at <= ?
        ORDER BY duration_ms LIMIT 1 OFFSET ?`,
    )
    .get(projectId, since, until, offset);
  return row?.duration_ms ?? 0;
}

export interface TimeBucket {
  bucket: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  errors: number;
}

export function costSeries(
  projectId: string,
  since: number,
  granularity: 'hour' | 'day',
): TimeBucket[] {
  const format = granularity === 'hour' ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';
  return getDb()
    .prepare<[string, number], TimeBucket>(
      `SELECT
         strftime('${format}', started_at / 1000, 'unixepoch')  AS bucket,
         COALESCE(SUM(cost_total), 0)                           AS cost,
         COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0)                        AS outputTokens,
         SUM(CASE WHEN kind = 'llm' THEN 1 ELSE 0 END)          AS calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)      AS errors
       FROM spans
       WHERE project_id = ? AND started_at >= ?
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(projectId, since);
}

export interface ModelStat {
  model: string;
  provider: string | null;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputChars: number;
  outputChars: number;
  cost: number;
  pricedCalls: number;
  avgLatencyMs: number;
  avgTtftMs: number | null;
  avgOutputTokens: number;
}

export function modelBreakdown(projectId: string, since: number): ModelStat[] {
  return getDb()
    .prepare<[string, number], ModelStat>(
      `SELECT
         model,
         MAX(provider)                                    AS provider,
         COUNT(*)                                         AS calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
         COALESCE(SUM(input_tokens), 0)                   AS inputTokens,
         COALESCE(SUM(output_tokens), 0)                  AS outputTokens,
         COALESCE(SUM(cache_read_tokens), 0)              AS cacheReadTokens,
         COALESCE(SUM(cache_write_tokens), 0)             AS cacheWriteTokens,
         COALESCE(SUM(input_chars), 0)                    AS inputChars,
         COALESCE(SUM(output_chars), 0)                   AS outputChars,
         COALESCE(SUM(cost_total), 0)                     AS cost,
         SUM(priced)                                      AS pricedCalls,
         COALESCE(AVG(duration_ms), 0)                    AS avgLatencyMs,
         AVG(ttft_ms)                                     AS avgTtftMs,
         COALESCE(AVG(output_tokens), 0)                  AS avgOutputTokens
       FROM spans
       WHERE project_id = ? AND started_at >= ? AND model IS NOT NULL
       GROUP BY model
       ORDER BY cost DESC, calls DESC`,
    )
    .all(projectId, since);
}

export interface TraceRow {
  id: string;
  name: string;
  user_ref: string | null;
  environment: string | null;
  status: string;
  started_at: number;
  duration_ms: number;
  span_count: number;
  llm_call_count: number;
  error_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  unpriced_calls: number;
}

export interface TraceFilters {
  since: number;
  search?: string;
  status?: 'all' | 'ok' | 'error';
  model?: string;
  userRef?: string;
  limit?: number;
  offset?: number;
}

export function listTraces(
  projectId: string,
  filters: TraceFilters,
): { rows: TraceRow[]; total: number } {
  const db = getDb();
  const where: string[] = ['t.project_id = ?', 't.started_at >= ?'];
  const params: (string | number)[] = [projectId, filters.since];

  if (filters.status === 'error') where.push("t.status = 'error'");
  if (filters.status === 'ok') where.push("t.status = 'ok'");
  if (filters.search) {
    where.push('(t.name LIKE ? OR t.id LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.userRef) {
    where.push('t.user_ref = ?');
    params.push(filters.userRef);
  }
  if (filters.model) {
    where.push('EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.id AND s.model = ?)');
    params.push(filters.model);
  }

  const clause = where.join(' AND ');
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const total =
    db
      .prepare<(string | number)[], { n: number }>(
        `SELECT COUNT(*) AS n FROM traces t WHERE ${clause}`,
      )
      .get(...params)?.n ?? 0;

  const rows = db
    .prepare<(string | number)[], TraceRow>(
      `SELECT t.id, t.name, t.user_ref, t.environment, t.status, t.started_at,
              t.duration_ms, t.span_count, t.llm_call_count, t.error_count,
              t.input_tokens, t.output_tokens, t.cost_usd, t.unpriced_calls
         FROM traces t
        WHERE ${clause}
        ORDER BY t.started_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return { rows, total };
}

export interface SpanRow {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  provider: string | null;
  model: string | null;
  status: string;
  error_type: string | null;
  error_message: string | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  ttft_ms: number | null;
  stream: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  input_chars: number;
  output_chars: number;
  cost_input: number;
  cost_output: number;
  cost_cache: number;
  cost_total: number;
  priced: number;
  tags_json: string | null;
  metadata_json: string | null;
  input_preview: string | null;
  output_preview: string | null;
}

export function getTrace(projectId: string, traceId: string): TraceRow | null {
  return (
    getDb()
      .prepare<[string, string], TraceRow>(
        `SELECT id, name, user_ref, environment, status, started_at, duration_ms,
                span_count, llm_call_count, error_count, input_tokens, output_tokens,
                cost_usd, unpriced_calls
           FROM traces WHERE project_id = ? AND id = ?`,
      )
      .get(projectId, traceId) ?? null
  );
}

export function getTraceSpans(projectId: string, traceId: string): SpanRow[] {
  return getDb()
    .prepare<[string, string], SpanRow>(
      'SELECT * FROM spans WHERE project_id = ? AND trace_id = ? ORDER BY started_at, ended_at',
    )
    .all(projectId, traceId);
}

export interface NamedStat {
  label: string;
  calls: number;
  cost: number;
  tokens: number;
  errors: number;
}

export function topTraceNames(projectId: string, since: number, limit = 8): NamedStat[] {
  return getDb()
    .prepare<[string, number, number], NamedStat>(
      `SELECT name AS label, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(error_count), 0) AS errors
         FROM traces WHERE project_id = ? AND started_at >= ?
        GROUP BY name ORDER BY cost DESC LIMIT ?`,
    )
    .all(projectId, since, limit);
}

export function topUsers(projectId: string, since: number, limit = 8): NamedStat[] {
  return getDb()
    .prepare<[string, number, number], NamedStat>(
      `SELECT user_ref AS label, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(error_count), 0) AS errors
         FROM traces WHERE project_id = ? AND started_at >= ? AND user_ref IS NOT NULL
        GROUP BY user_ref ORDER BY cost DESC LIMIT ?`,
    )
    .all(projectId, since, limit);
}

export interface ErrorStat {
  errorType: string;
  model: string | null;
  count: number;
  lastSeen: number;
  sample: string | null;
}

export function errorBreakdown(projectId: string, since: number, limit = 10): ErrorStat[] {
  return getDb()
    .prepare<[string, number, number], ErrorStat>(
      `SELECT COALESCE(error_type, 'unknown') AS errorType,
              model,
              COUNT(*)      AS count,
              MAX(started_at) AS lastSeen,
              MAX(error_message) AS sample
         FROM spans
        WHERE project_id = ? AND status = 'error' AND started_at >= ?
        GROUP BY errorType, model
        ORDER BY count DESC LIMIT ?`,
    )
    .all(projectId, since, limit);
}

export function distinctModels(projectId: string): string[] {
  return getDb()
    .prepare<[string], { model: string }>(
      'SELECT DISTINCT model FROM spans WHERE project_id = ? AND model IS NOT NULL ORDER BY model',
    )
    .all(projectId)
    .map((r) => r.model);
}

export function monthToDateCost(projectId: string): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return (
    getDb()
      .prepare<[string, number], { cost: number }>(
        'SELECT COALESCE(SUM(cost_total), 0) AS cost FROM spans WHERE project_id = ? AND started_at >= ?',
      )
      .get(projectId, start.getTime())?.cost ?? 0
  );
}

export interface PricingWarnings {
  /** Models with recorded token usage but no configured rate — cost is understated. */
  unpriced: { model: string; calls: number; tokens: number }[];
  /** Models whose rate was seeded as a placeholder and never confirmed. */
  unverified: { model: string; cost: number }[];
}

/**
 * Pricing gaps that would otherwise make a cost chart quietly wrong.
 *
 * An unpriced model contributes $0.00, which is indistinguishable from "free"
 * on every chart in this app — so it has to be reported separately.
 */
export function pricingWarnings(projectId: string, since: number): PricingWarnings {
  const db = getDb();

  const unpriced = db
    .prepare<[string, number], { model: string; calls: number; tokens: number }>(
      `SELECT s.model AS model, COUNT(*) AS calls,
              COALESCE(SUM(s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens), 0) AS tokens
         FROM spans s
        WHERE s.project_id = ? AND s.started_at >= ? AND s.model IS NOT NULL AND s.priced = 0
          AND (s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens) > 0
        GROUP BY s.model ORDER BY tokens DESC`,
    )
    .all(projectId, since);

  const unverified = db
    .prepare<[string, number], { model: string; cost: number }>(
      `SELECT s.model AS model, COALESCE(SUM(s.cost_total), 0) AS cost
         FROM spans s JOIN model_prices p ON p.model = s.model
        WHERE s.project_id = ? AND s.started_at >= ? AND p.verified = 0 AND s.priced = 1
        GROUP BY s.model HAVING cost > 0 ORDER BY cost DESC`,
    )
    .all(projectId, since);

  return { unpriced, unverified };
}

export function hasAnySpans(projectId: string): boolean {
  return Boolean(
    getDb().prepare('SELECT 1 FROM spans WHERE project_id = ? LIMIT 1').get(projectId),
  );
}

export function activeApiKeyCount(projectId: string): number {
  return (
    getDb()
      .prepare<[string], { n: number }>(
        'SELECT COUNT(*) AS n FROM api_keys WHERE project_id = ? AND revoked_at IS NULL',
      )
      .get(projectId)?.n ?? 0
  );
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
