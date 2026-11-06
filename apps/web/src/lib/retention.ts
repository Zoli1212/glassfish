import { getDb } from './db';

/**
 * Span retention.
 *
 * Nothing prunes by default: silently deleting someone's cost history is a
 * worse failure than a full disk, and the right horizon depends on the
 * project. This is the machinery; the operator chooses when to run it.
 *
 * Experiment results are never pruned — they are the record of what was
 * measured, they are small, and a comparison that loses half its rows is
 * worse than useless. Only the spans and traces behind them age out.
 */

export interface RetentionPreview {
  cutoff: number;
  traces: number;
  spans: number;
  /** Traces referenced by an experiment result; kept regardless of age. */
  protectedTraces: number;
  estimatedBytes: number;
}

const AVERAGE_SPAN_BYTES = 420;

function cutoffFor(days: number): number {
  return Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
}

export function previewRetention(projectId: string, days: number): RetentionPreview {
  const db = getDb();
  const cutoff = cutoffFor(days);

  const traces =
    db
      .prepare<[string, number], { n: number }>(
        `SELECT COUNT(*) AS n FROM traces
          WHERE project_id = ? AND started_at < ?
            AND id NOT IN (SELECT trace_id FROM experiment_results WHERE trace_id IS NOT NULL)`,
      )
      .get(projectId, cutoff)?.n ?? 0;

  const spans =
    db
      .prepare<[string, number], { n: number }>(
        `SELECT COUNT(*) AS n FROM spans
          WHERE project_id = ? AND started_at < ?
            AND trace_id NOT IN (SELECT trace_id FROM experiment_results WHERE trace_id IS NOT NULL)`,
      )
      .get(projectId, cutoff)?.n ?? 0;

  const protectedTraces =
    db
      .prepare<[string, number], { n: number }>(
        `SELECT COUNT(*) AS n FROM traces
          WHERE project_id = ? AND started_at < ?
            AND id IN (SELECT trace_id FROM experiment_results WHERE trace_id IS NOT NULL)`,
      )
      .get(projectId, cutoff)?.n ?? 0;

  return { cutoff, traces, spans, protectedTraces, estimatedBytes: spans * AVERAGE_SPAN_BYTES };
}

export interface RetentionResult {
  deletedSpans: number;
  deletedTraces: number;
  keptForExperiments: number;
}

/**
 * Delete spans and traces older than `days`.
 *
 * Scores attached to a deleted trace go with it (the judgement is about an
 * output nobody can look at any more), but scores attached to an experiment
 * result survive, because the result row survives.
 */
export function applyRetention(projectId: string, days: number): RetentionResult {
  const db = getDb();
  const cutoff = cutoffFor(days);
  const preview = previewRetention(projectId, days);

  db.transaction(() => {
    db.prepare(
      `DELETE FROM scores
        WHERE project_id = ?
          AND result_id IS NULL
          AND trace_id IN (
            SELECT id FROM traces WHERE project_id = ? AND started_at < ?
              AND id NOT IN (SELECT trace_id FROM experiment_results WHERE trace_id IS NOT NULL)
          )`,
    ).run(projectId, projectId, cutoff);

    db.prepare(
      `DELETE FROM spans
        WHERE project_id = ? AND started_at < ?
          AND trace_id NOT IN (SELECT trace_id FROM experiment_results WHERE trace_id IS NOT NULL)`,
    ).run(projectId, cutoff);

    db.prepare(
      `DELETE FROM traces
        WHERE project_id = ? AND started_at < ?
          AND id NOT IN (SELECT trace_id FROM experiment_results WHERE trace_id IS NOT NULL)`,
    ).run(projectId, cutoff);
  })();

  // Reclaim the freed pages; without this the file keeps its high-water mark
  // and a volume-full incident is "fixed" with no disk actually returned.
  try {
    db.exec('PRAGMA incremental_vacuum');
  } catch {
    // Only works when the database is in incremental auto-vacuum mode; a
    // plain delete still frees pages for reuse, just not back to the OS.
  }

  return {
    deletedSpans: preview.spans,
    deletedTraces: preview.traces,
    keptForExperiments: preview.protectedTraces,
  };
}

export interface StorageUsage {
  spans: number;
  traces: number;
  experimentResults: number;
  oldestSpanAt: number | null;
  estimatedBytes: number;
}

export function storageUsage(projectId: string): StorageUsage {
  const db = getDb();
  const row = db
    .prepare<[string], { spans: number; oldest: number | null }>(
      'SELECT COUNT(*) AS spans, MIN(started_at) AS oldest FROM spans WHERE project_id = ?',
    )
    .get(projectId);

  const traces =
    db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM traces WHERE project_id = ?')
      .get(projectId)?.n ?? 0;

  const experimentResults =
    db
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM experiment_results r
           JOIN experiments e ON e.id = r.experiment_id
          WHERE e.project_id = ?`,
      )
      .get(projectId)?.n ?? 0;

  return {
    spans: row?.spans ?? 0,
    traces,
    experimentResults,
    oldestSpanAt: row?.oldest ?? null,
    estimatedBytes: (row?.spans ?? 0) * AVERAGE_SPAN_BYTES,
  };
}
