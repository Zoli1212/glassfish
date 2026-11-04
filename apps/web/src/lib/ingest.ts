import { getDb } from './db';
import { computeCost, ensureModelRegistered, type ModelPrice } from './pricing';

export interface IngestSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  traceName?: string;
  name: string;
  kind?: string;
  provider?: string;
  model?: string;
  status?: string;
  errorType?: string;
  errorMessage?: string;
  startedAt: number;
  endedAt: number;
  durationMs?: number;
  ttftMs?: number;
  stream?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  };
  chars?: { input?: number; output?: number };
  input?: string;
  output?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  userRef?: string;
  sessionRef?: string;
  environment?: string;
  release?: string;
}

export interface IngestResult {
  accepted: number;
  rejected: { index: number; reason: string }[];
  traces: number;
  unpricedModels: string[];
}

const VALID_KINDS = new Set(['llm', 'embedding', 'tool', 'retrieval', 'chain', 'custom']);
const MAX_PREVIEW_CHARS = 4_000;
const MAX_SPANS_PER_BATCH = 1_000;

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function ingestSpans(
  projectId: string,
  spans: unknown,
  sdkLabel: string | null,
): IngestResult {
  if (!Array.isArray(spans)) {
    throw new IngestError('body.spans must be an array', 400);
  }
  if (spans.length > MAX_SPANS_PER_BATCH) {
    throw new IngestError(`batch too large: ${spans.length} spans (max ${MAX_SPANS_PER_BATCH})`, 413);
  }

  const db = getDb();
  const rejected: { index: number; reason: string }[] = [];
  const valid: IngestSpan[] = [];

  spans.forEach((raw, index) => {
    const error = validate(raw);
    if (error) rejected.push({ index, reason: error });
    else valid.push(raw as IngestSpan);
  });

  const priceCache = new Map<string, ModelPrice>();
  const unpricedModels = new Set<string>();
  const traceSeeds = new Map<string, TraceSeed>();

  const insertSpan = db.prepare(`
    INSERT OR REPLACE INTO spans (
      id, project_id, trace_id, parent_span_id, name, kind, provider, model,
      status, error_type, error_message, started_at, ended_at, duration_ms,
      ttft_ms, stream, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, reasoning_tokens, input_chars, output_chars,
      cost_input, cost_output, cost_cache, cost_total, priced,
      user_ref, session_ref, environment, release, tags_json, metadata_json,
      input_preview, output_preview, received_at
    ) VALUES (
      @id, @projectId, @traceId, @parentSpanId, @name, @kind, @provider, @model,
      @status, @errorType, @errorMessage, @startedAt, @endedAt, @durationMs,
      @ttftMs, @stream, @inputTokens, @outputTokens, @cacheReadTokens,
      @cacheWriteTokens, @reasoningTokens, @inputChars, @outputChars,
      @costInput, @costOutput, @costCache, @costTotal, @priced,
      @userRef, @sessionRef, @environment, @release, @tagsJson, @metadataJson,
      @inputPreview, @outputPreview, @receivedAt
    )
  `);

  const receivedAt = Date.now();

  db.transaction(() => {
    for (const span of valid) {
      const kind = VALID_KINDS.has(span.kind ?? '') ? (span.kind as string) : 'custom';
      const usage = {
        inputTokens: nonNegative(span.usage?.inputTokens),
        outputTokens: nonNegative(span.usage?.outputTokens),
        cacheReadTokens: nonNegative(span.usage?.cacheReadTokens),
        cacheWriteTokens: nonNegative(span.usage?.cacheWriteTokens),
      };

      let price: ModelPrice | null = null;
      if (span.model) {
        price = priceCache.get(span.model) ?? ensureModelRegistered(span.model, span.provider);
        priceCache.set(span.model, price);
      }

      const hasTokens =
        usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens > 0;
      const cost = computeCost(price, usage);
      if (span.model && hasTokens && !cost.priced) unpricedModels.add(span.model);

      insertSpan.run({
        id: span.spanId,
        projectId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId ?? null,
        name: String(span.name).slice(0, 200),
        kind,
        provider: span.provider ?? price?.provider ?? null,
        model: span.model ?? null,
        status: span.status === 'error' ? 'error' : 'ok',
        errorType: truncateOrNull(span.errorType, 120),
        errorMessage: truncateOrNull(span.errorMessage, 1_000),
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        durationMs: span.durationMs ?? Math.max(0, span.endedAt - span.startedAt),
        ttftMs: Number.isFinite(span.ttftMs) ? span.ttftMs : null,
        stream: span.stream ? 1 : 0,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: nonNegative(span.usage?.reasoningTokens),
        inputChars: nonNegative(span.chars?.input),
        outputChars: nonNegative(span.chars?.output),
        costInput: cost.input,
        costOutput: cost.output,
        costCache: cost.cache,
        costTotal: cost.total,
        priced: cost.priced ? 1 : 0,
        userRef: truncateOrNull(span.userRef, 120),
        sessionRef: truncateOrNull(span.sessionRef, 120),
        environment: truncateOrNull(span.environment, 60),
        release: truncateOrNull(span.release, 60),
        tagsJson: span.tags && Object.keys(span.tags).length ? JSON.stringify(span.tags) : null,
        metadataJson: span.metadata ? JSON.stringify(span.metadata) : null,
        inputPreview: truncateOrNull(span.input, MAX_PREVIEW_CHARS),
        outputPreview: truncateOrNull(span.output, MAX_PREVIEW_CHARS),
        receivedAt,
      });

      const seed = traceSeeds.get(span.traceId) ?? {};
      traceSeeds.set(span.traceId, {
        name: seed.name ?? span.traceName ?? undefined,
        userRef: seed.userRef ?? span.userRef,
        sessionRef: seed.sessionRef ?? span.sessionRef,
        environment: seed.environment ?? span.environment,
        release: seed.release ?? span.release,
      });
    }

    for (const [traceId, seed] of traceSeeds) {
      rollUpTrace(projectId, traceId, seed);
    }

    db.prepare(
      'INSERT INTO ingest_log (project_id, received_at, accepted, rejected, sdk) VALUES (?, ?, ?, ?, ?)',
    ).run(projectId, receivedAt, valid.length, rejected.length, sdkLabel);
  })();

  return {
    accepted: valid.length,
    rejected,
    traces: traceSeeds.size,
    unpricedModels: [...unpricedModels],
  };
}

interface TraceSeed {
  name?: string;
  userRef?: string;
  sessionRef?: string;
  environment?: string;
  release?: string;
}

interface TraceAggregate {
  started_at: number;
  ended_at: number;
  span_count: number;
  llm_call_count: number;
  error_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  unpriced_calls: number;
}

/**
 * Recompute a trace's rollup from its spans.
 *
 * Derived rather than incremented, so a retried batch (same span ids,
 * INSERT OR REPLACE) can never double-count a trace's cost.
 */
export function rollUpTrace(projectId: string, traceId: string, seed: TraceSeed = {}): void {
  const db = getDb();
  const agg = db
    .prepare<[string, string], TraceAggregate>(
      `SELECT
         COALESCE(MIN(started_at), 0)                              AS started_at,
         COALESCE(MAX(ended_at), 0)                                AS ended_at,
         COUNT(*)                                                  AS span_count,
         SUM(CASE WHEN kind = 'llm' THEN 1 ELSE 0 END)             AS llm_call_count,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)         AS error_count,
         COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0)                           AS output_tokens,
         COALESCE(SUM(cost_total), 0)                              AS cost_usd,
         SUM(CASE WHEN kind = 'llm' AND priced = 0 AND
                       (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) > 0
                  THEN 1 ELSE 0 END)                               AS unpriced_calls
       FROM spans WHERE project_id = ? AND trace_id = ?`,
    )
    .get(projectId, traceId);

  if (!agg || agg.span_count === 0) {
    db.prepare('DELETE FROM traces WHERE id = ? AND project_id = ?').run(traceId, projectId);
    return;
  }

  // The trace name is whichever `chain` span carries it; fall back to the
  // traceName the SDK stamps on every span, then to the first span's name.
  const nameRow = db
    .prepare<[string, string], { name: string }>(
      `SELECT name FROM spans
        WHERE project_id = ? AND trace_id = ?
        ORDER BY CASE WHEN kind = 'chain' THEN 0 ELSE 1 END, started_at
        LIMIT 1`,
    )
    .get(projectId, traceId);

  db.prepare(
    `INSERT INTO traces (
       id, project_id, name, user_ref, session_ref, environment, release, status,
       started_at, ended_at, duration_ms, span_count, llm_call_count, error_count,
       input_tokens, output_tokens, total_tokens, cost_usd, unpriced_calls
     ) VALUES (
       @id, @projectId, @name, @userRef, @sessionRef, @environment, @release, @status,
       @startedAt, @endedAt, @durationMs, @spanCount, @llmCallCount, @errorCount,
       @inputTokens, @outputTokens, @totalTokens, @costUsd, @unpricedCalls
     )
     ON CONFLICT(id) DO UPDATE SET
       name           = COALESCE(excluded.name, traces.name),
       user_ref       = COALESCE(excluded.user_ref, traces.user_ref),
       session_ref    = COALESCE(excluded.session_ref, traces.session_ref),
       environment    = COALESCE(excluded.environment, traces.environment),
       release        = COALESCE(excluded.release, traces.release),
       status         = excluded.status,
       started_at     = excluded.started_at,
       ended_at       = excluded.ended_at,
       duration_ms    = excluded.duration_ms,
       span_count     = excluded.span_count,
       llm_call_count = excluded.llm_call_count,
       error_count    = excluded.error_count,
       input_tokens   = excluded.input_tokens,
       output_tokens  = excluded.output_tokens,
       total_tokens   = excluded.total_tokens,
       cost_usd       = excluded.cost_usd,
       unpriced_calls = excluded.unpriced_calls`,
  ).run({
    id: traceId,
    projectId,
    name: seed.name ?? nameRow?.name ?? 'trace',
    userRef: seed.userRef ?? null,
    sessionRef: seed.sessionRef ?? null,
    environment: seed.environment ?? null,
    release: seed.release ?? null,
    status: agg.error_count > 0 ? 'error' : 'ok',
    startedAt: agg.started_at,
    endedAt: agg.ended_at,
    durationMs: Math.max(0, agg.ended_at - agg.started_at),
    spanCount: agg.span_count,
    llmCallCount: agg.llm_call_count,
    errorCount: agg.error_count,
    inputTokens: agg.input_tokens,
    outputTokens: agg.output_tokens,
    totalTokens: agg.input_tokens + agg.output_tokens,
    costUsd: agg.cost_usd,
    unpricedCalls: agg.unpriced_calls,
  });
}

function validate(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'span must be an object';
  const span = raw as Record<string, unknown>;
  if (typeof span.traceId !== 'string' || !span.traceId) return 'traceId is required';
  if (typeof span.spanId !== 'string' || !span.spanId) return 'spanId is required';
  if (typeof span.name !== 'string' || !span.name) return 'name is required';
  if (!Number.isFinite(span.startedAt)) return 'startedAt must be an epoch millisecond number';
  if (!Number.isFinite(span.endedAt)) return 'endedAt must be an epoch millisecond number';
  if ((span.endedAt as number) < (span.startedAt as number)) return 'endedAt precedes startedAt';
  return null;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function truncateOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.length <= max ? value : value.slice(0, max);
}
