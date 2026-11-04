import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SEED_PRICES, TOKENIZER_FAMILIES } from './catalogue';

/**
 * Storage layer.
 *
 * Built on Node's own `node:sqlite`, so the app installs with zero native
 * modules and no compiler toolchain — the thing most likely to stop a
 * self-hosted tool from starting at all.
 *
 * The thin wrapper below exposes the `prepare / get / all / run / transaction`
 * surface the rest of the app uses, with the parameter coercions `node:sqlite`
 * requires (it rejects booleans and `undefined`) handled in one place.
 */

type SqlValue = string | number | bigint | null | Uint8Array;

export interface Stmt<Row> {
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): { changes: number };
}

export interface DB {
  prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Stmt<R>;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

function coerce(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  // Objects reaching here are named-parameter bags; the caller passes them
  // as a single argument and they are handled before coerce() is reached.
  return String(value);
}

function coerceParams(params: unknown[]): unknown[] {
  if (params.length === 1 && isNamedBag(params[0])) {
    const bag = params[0] as Record<string, unknown>;
    const out: Record<string, SqlValue> = {};
    for (const [key, value] of Object.entries(bag)) out[key] = coerce(value);
    return [out];
  }
  return params.map(coerce);
}

function isNamedBag(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/**
 * `node:sqlite` returns rows as null-prototype objects. React Server
 * Components refuse to serialise those to a Client Component, so rows are
 * reshaped into ordinary objects once, here, rather than at every call site
 * that happens to pass a query result into a chart.
 */
function toPlain<R>(row: unknown): R {
  return (row === undefined || row === null ? row : { ...(row as object) }) as R;
}

function wrap(db: DatabaseSync): DB {
  const cache = new Map<string, StatementSync>();

  function compile(sql: string): StatementSync {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  }

  return {
    prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Stmt<R> {
      void (undefined as unknown as P);
      return {
        get(...params: unknown[]) {
          const row = compile(sql).get(...(coerceParams(params) as never[]));
          return row === undefined ? undefined : toPlain<R>(row);
        },
        all(...params: unknown[]) {
          return compile(sql)
            .all(...(coerceParams(params) as never[]))
            .map((row) => toPlain<R>(row));
        },
        run(...params: unknown[]) {
          const result = compile(sql).run(...(coerceParams(params) as never[]));
          return { changes: Number(result.changes) };
        },
      };
    },
    exec(sql: string) {
      db.exec(sql);
    },
    /**
     * `node:sqlite` has no transaction helper, so this is the explicit
     * BEGIN/COMMIT/ROLLBACK. Nesting is not supported and not needed —
     * every caller is a single top-level write.
     */
    transaction<T>(fn: () => T): () => T {
      return () => {
        db.exec('BEGIN');
        try {
          const result = fn();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // A rollback failure must not mask the original error.
          }
          throw error;
        }
      };
    },
    close() {
      cache.clear();
      db.close();
    },
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  monthly_budget_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS model_prices (
  model               TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  family              TEXT NOT NULL,
  input_per_mtok      REAL,
  output_per_mtok     REAL,
  cache_read_per_mtok REAL,
  cache_write_per_mtok REAL,
  context_window      INTEGER,
  max_output          INTEGER,
  verified            INTEGER NOT NULL DEFAULT 0,
  source              TEXT NOT NULL DEFAULT '',
  active              INTEGER NOT NULL DEFAULT 1,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokenizer_families (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  chars_per_token REAL NOT NULL,
  note            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS traces (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'trace',
  user_ref     TEXT,
  session_ref  TEXT,
  environment  TEXT,
  release      TEXT,
  status       TEXT NOT NULL DEFAULT 'ok',
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  span_count   INTEGER NOT NULL DEFAULT 0,
  llm_call_count INTEGER NOT NULL DEFAULT 0,
  error_count  INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0,
  unpriced_calls INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_project_name ON traces(project_id, name);
CREATE INDEX IF NOT EXISTS idx_traces_project_user ON traces(project_id, user_ref);

CREATE TABLE IF NOT EXISTS spans (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trace_id       TEXT NOT NULL,
  parent_span_id TEXT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'custom',
  provider       TEXT,
  model          TEXT,
  status         TEXT NOT NULL DEFAULT 'ok',
  error_type     TEXT,
  error_message  TEXT,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  ttft_ms        INTEGER,
  stream         INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
  input_chars    INTEGER NOT NULL DEFAULT 0,
  output_chars   INTEGER NOT NULL DEFAULT 0,
  cost_input     REAL NOT NULL DEFAULT 0,
  cost_output    REAL NOT NULL DEFAULT 0,
  cost_cache     REAL NOT NULL DEFAULT 0,
  cost_total     REAL NOT NULL DEFAULT 0,
  priced         INTEGER NOT NULL DEFAULT 0,
  user_ref       TEXT,
  session_ref    TEXT,
  environment    TEXT,
  release        TEXT,
  tags_json      TEXT,
  metadata_json  TEXT,
  input_preview  TEXT,
  output_preview TEXT,
  received_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_project_time ON spans(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_project_model ON spans(project_id, model, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_project_kind ON spans(project_id, kind, started_at DESC);

CREATE TABLE IF NOT EXISTS ingest_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  accepted    INTEGER NOT NULL,
  rejected    INTEGER NOT NULL,
  sdk         TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingest_log_project ON ingest_log(project_id, received_at DESC);

-- ---------------------------------------------------------------- evaluation

CREATE TABLE IF NOT EXISTS datasets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dataset_examples (
  id            TEXT PRIMARY KEY,
  dataset_id    TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  -- Stable key supplied by the caller, so re-pushing a dataset updates rows
  -- in place instead of duplicating them and silently doubling every run.
  external_id   TEXT,
  input_json    TEXT NOT NULL,
  expected_json TEXT,
  metadata_json TEXT,
  split         TEXT NOT NULL DEFAULT 'test',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(dataset_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_examples_dataset ON dataset_examples(dataset_id, position);

CREATE TABLE IF NOT EXISTS experiments (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_id      TEXT REFERENCES datasets(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  target_model    TEXT,
  prompt_version_id TEXT,
  status          TEXT NOT NULL DEFAULT 'running',
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  example_count   INTEGER NOT NULL DEFAULT 0,
  result_count    INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms  REAL NOT NULL DEFAULT 0,
  metadata_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiments_dataset ON experiments(dataset_id, started_at DESC);

CREATE TABLE IF NOT EXISTS experiment_results (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  example_id    TEXT,
  external_id   TEXT,
  trace_id      TEXT,
  input_json    TEXT,
  expected_json TEXT,
  output_text   TEXT,
  status        TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_experiment ON experiment_results(experiment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_results_external ON experiment_results(experiment_id, external_id);

-- One table for every judgement, whatever produced it. A score attached to a
-- trace is user feedback; attached to an experiment result it is an eval
-- score. Keeping them apart would mean two of every query and chart.
CREATE TABLE IF NOT EXISTS scores (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  result_id     TEXT REFERENCES experiment_results(id) ON DELETE CASCADE,
  experiment_id TEXT,
  trace_id      TEXT,
  name          TEXT NOT NULL,
  value         REAL,
  label         TEXT,
  comment       TEXT,
  source        TEXT NOT NULL DEFAULT 'code',
  judge_model   TEXT,
  judge_cost_usd REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_result ON scores(result_id);
CREATE INDEX IF NOT EXISTS idx_scores_experiment ON scores(experiment_id, name);
CREATE INDEX IF NOT EXISTS idx_scores_trace ON scores(trace_id);
CREATE INDEX IF NOT EXISTS idx_scores_project ON scores(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prompts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id             TEXT PRIMARY KEY,
  prompt_id      TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  template       TEXT NOT NULL,
  system_template TEXT,
  model          TEXT,
  params_json    TEXT,
  commit_message TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  UNIQUE(prompt_id, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions ON prompt_versions(prompt_id, version DESC);
`;

function resolveDbPath(): string {
  const configured = process.env.GLASSFISH_DB;
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), 'data', 'glassfish.db');
}

function create(): DB {
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');

  const db = wrap(raw);
  db.exec(SCHEMA);
  seedReferenceData(db);
  return db;
}

/**
 * Insert catalogue rows that do not exist yet.
 *
 * Deliberately never UPDATEs: once an operator has corrected a price, a
 * redeploy must not quietly overwrite it with the shipped default.
 */
function seedReferenceData(db: DB): void {
  const insertFamily = db.prepare(
    `INSERT OR IGNORE INTO tokenizer_families (id, label, chars_per_token, note)
     VALUES (@id, @label, @charsPerToken, @note)`,
  );
  const insertPrice = db.prepare(
    `INSERT OR IGNORE INTO model_prices
       (model, provider, display_name, family, input_per_mtok, output_per_mtok,
        cache_read_per_mtok, cache_write_per_mtok, context_window, max_output,
        verified, source, active, updated_at)
     VALUES
       (@model, @provider, @displayName, @family, @inputPerMTok, @outputPerMTok,
        @cacheReadPerMTok, @cacheWritePerMTok, @contextWindow, @maxOutput,
        @verified, @source, 1, @updatedAt)`,
  );

  const now = Date.now();
  db.transaction(() => {
    for (const family of TOKENIZER_FAMILIES) insertFamily.run(family);
    for (const price of SEED_PRICES) {
      insertPrice.run({ ...price, verified: price.verified ? 1 : 0, updatedAt: now });
    }
  })();
}

declare global {
  // eslint-disable-next-line no-var
  var __glassfishDb: DB | undefined;
}

export function getDb(): DB {
  // Next.js keeps module state across hot reloads inconsistently; a global
  // handle avoids opening a new connection on every edit.
  if (!globalThis.__glassfishDb) {
    globalThis.__glassfishDb = create();
  }
  return globalThis.__glassfishDb;
}
