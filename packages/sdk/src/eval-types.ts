/** Types shared by the experiment runner and the scorers. */

export interface DatasetExample {
  id?: string;
  /** Stable key. Supply one and re-pushing updates in place instead of duplicating. */
  externalId?: string | null;
  input: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown> | null;
  split?: string;
}

export interface TaskContext {
  example: DatasetExample;
  input: unknown;
  expected: unknown;
  output: unknown;
  latencyMs: number;
  traceId: string;
}

export interface ScoreOutput {
  /**
   * 0..1, or null for "could not judge".
   *
   * Null matters: a scorer that could not run is not the same as a zero, and
   * averaging a failed judgement as 0 silently drags a model's score down.
   */
  value: number | null;
  label?: string;
  comment?: string;
  judgeModel?: string;
  judgeCostUsd?: number;
}

export interface Scorer {
  name: string;
  score(context: TaskContext): ScoreOutput | Promise<ScoreOutput>;
}

export interface ExperimentOptions<T = unknown> {
  /** Name shown in the dashboard. Reused names are fine — runs are compared by id. */
  name: string;
  /** Dataset name or id to pull examples from. */
  dataset: string;
  description?: string;
  /** Recorded on the experiment so a run can be traced back to what it tested. */
  targetModel?: string;
  /** Run this for every example. Its return value is the output being scored. */
  task: (example: DatasetExample) => Promise<T> | T;
  scorers?: Scorer[];
  /** How many examples to run at once. Default 4. */
  concurrency?: number;
  /** Only run examples in this split. */
  split?: string;
  /** Cap the run — useful while iterating on a prompt. */
  limit?: number;
  metadata?: Record<string, unknown>;
  /** Called after each example, for progress output. */
  onProgress?: (done: number, total: number) => void;
}

export interface ExperimentSummary {
  id: string;
  name: string;
  resultCount: number;
  errorCount: number;
  costUsd: number;
  avgLatencyMs: number;
  scores: { name: string; mean: number | null; count: number; passRate: number | null }[];
  url?: string;
}
