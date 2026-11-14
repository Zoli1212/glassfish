import { getDb } from './db';
import { newId } from './auth';

/**
 * Prompt registry.
 *
 * A prompt that lives only in a source file is invisible to the thing
 * measuring it: an experiment's score moves and nobody can say which wording
 * produced it. Versions here are immutable and append-only, so a run can be
 * pinned to the exact text it scored.
 */

export interface Prompt {
  id: string;
  projectId: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  latestVersion: number | null;
  versionCount: number;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  template: string;
  systemTemplate: string | null;
  model: string | null;
  params: Record<string, unknown> | null;
  commitMessage: string;
  createdAt: number;
}

interface PromptRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
  latest_version: number | null;
  version_count: number;
}

const PROMPT_SELECT = `
  SELECT p.*,
         (SELECT MAX(version) FROM prompt_versions v WHERE v.prompt_id = p.id) AS latest_version,
         (SELECT COUNT(*)     FROM prompt_versions v WHERE v.prompt_id = p.id) AS version_count
    FROM prompts p`;

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersion: row.latest_version,
    versionCount: row.version_count,
  };
}

export function listPrompts(projectId: string): Prompt[] {
  return getDb()
    .prepare<[string], PromptRow>(
      `${PROMPT_SELECT} WHERE p.project_id = ? ORDER BY p.updated_at DESC`,
    )
    .all(projectId)
    .map(toPrompt);
}

export function getPrompt(projectId: string, idOrName: string): Prompt | null {
  const row = getDb()
    .prepare<[string, string, string], PromptRow>(
      `${PROMPT_SELECT} WHERE p.project_id = ? AND (p.id = ? OR p.name = ?)`,
    )
    .get(projectId, idOrName, idOrName);
  return row ? toPrompt(row) : null;
}

interface VersionRow {
  id: string;
  prompt_id: string;
  version: number;
  template: string;
  system_template: string | null;
  model: string | null;
  params_json: string | null;
  commit_message: string;
  created_at: number;
}

function toVersion(row: VersionRow): PromptVersion {
  let params: Record<string, unknown> | null = null;
  if (row.params_json) {
    try {
      params = JSON.parse(row.params_json) as Record<string, unknown>;
    } catch {
      params = null;
    }
  }
  return {
    id: row.id,
    promptId: row.prompt_id,
    version: row.version,
    template: row.template,
    systemTemplate: row.system_template,
    model: row.model,
    params,
    commitMessage: row.commit_message,
    createdAt: row.created_at,
  };
}

export function listVersions(promptId: string, limit = 100): PromptVersion[] {
  return getDb()
    .prepare<[string, number], VersionRow>(
      'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC LIMIT ?',
    )
    .all(promptId, limit)
    .map(toVersion);
}

export function getVersion(promptId: string, version?: number | null): PromptVersion | null {
  const db = getDb();
  const row =
    version === undefined || version === null
      ? db
          .prepare<[string], VersionRow>(
            'SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC LIMIT 1',
          )
          .get(promptId)
      : db
          .prepare<[string, number], VersionRow>(
            'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version = ?',
          )
          .get(promptId, version);
  return row ? toVersion(row) : null;
}

export interface NewVersion {
  template: string;
  systemTemplate?: string | null;
  model?: string | null;
  params?: Record<string, unknown> | null;
  commitMessage?: string;
}

export interface PublishResult {
  prompt: Prompt;
  version: PromptVersion;
  /** True when the text was identical to the current version and nothing was written. */
  unchanged: boolean;
}

/**
 * Append a version.
 *
 * Publishing text identical to the current version is a no-op rather than a
 * new row: a deploy script that pushes on every boot would otherwise fill the
 * history with duplicates and make the version number meaningless as a
 * record of what actually changed.
 */
export function publishVersion(
  projectId: string,
  name: string,
  next: NewVersion,
  description = '',
): PublishResult {
  const db = getDb();
  const now = Date.now();

  let prompt = getPrompt(projectId, name);
  if (!prompt) {
    const id = newId('pr');
    db.prepare(
      'INSERT INTO prompts (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, projectId, name, description, now, now);
    prompt = getPrompt(projectId, name)!;
  } else if (description && description !== prompt.description) {
    db.prepare('UPDATE prompts SET description = ?, updated_at = ? WHERE id = ?').run(
      description,
      now,
      prompt.id,
    );
  }

  const current = getVersion(prompt.id);
  const systemTemplate = next.systemTemplate ?? null;
  const model = next.model ?? null;
  const paramsJson = next.params ? JSON.stringify(next.params) : null;

  if (
    current &&
    current.template === next.template &&
    current.systemTemplate === systemTemplate &&
    current.model === model &&
    (current.params ? JSON.stringify(current.params) : null) === paramsJson
  ) {
    return { prompt, version: current, unchanged: true };
  }

  const version = (prompt.latestVersion ?? 0) + 1;
  const versionId = newId('pv');

  db.transaction(() => {
    db.prepare(
      `INSERT INTO prompt_versions
         (id, prompt_id, version, template, system_template, model, params_json, commit_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versionId,
      prompt!.id,
      version,
      next.template,
      systemTemplate,
      model,
      paramsJson,
      next.commitMessage ?? '',
      now,
    );
    db.prepare('UPDATE prompts SET updated_at = ? WHERE id = ?').run(now, prompt!.id);
  })();

  return {
    prompt: getPrompt(projectId, name)!,
    version: getVersion(prompt.id, version)!,
    unchanged: false,
  };
}

/**
 * Substitute `{{name}}` placeholders.
 *
 * A placeholder with no matching variable is left in place rather than
 * replaced with an empty string: an unresolved `{{customer}}` reaching the
 * model is obvious in the output, while a silently emptied one produces a
 * plausible-looking answer about nobody.
 */
export function render(template: string, variables: Record<string, unknown> = {}): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) return match;
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/** Placeholders a template expects, for showing what a caller must supply. */
export function placeholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) found.add(match[1]);
  return [...found].sort();
}

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/**
 * Line diff between two versions, via longest common subsequence.
 *
 * Small enough to do here: prompts are a few dozen lines, and a dependency
 * for this would be more code than the algorithm.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ type: 'removed', text: a[i++] });
  while (j < b.length) out.push({ type: 'added', text: b[j++] });

  return out;
}
