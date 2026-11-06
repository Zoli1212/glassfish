'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  createSession,
  destroySession,
  generateApiKey,
  hashPassword,
  newId,
  requireProject,
  requireUser,
  signupAllowed,
  uniqueSlug,
  verifyPassword,
} from '@/lib/auth';
import { getDb } from '@/lib/db';
import { guessFamily, guessProvider } from '@/lib/catalogue';
import { addScore, deleteScore } from '@/lib/evals';
import { applyRetention, previewRetention } from '@/lib/retention';
import type { ActionState } from '@/lib/action-state';

// -------------------------------------------------------------------- auth

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  // Enforced here as well as on the page: a closed form that still accepts a
  // hand-crafted POST is not closed.
  if (!signupAllowed()) {
    return { error: 'Registration is closed on this instance. Ask an operator for an account.' };
  }

  if (!name || !email || !password) return { error: 'Name, email and password are all required.' };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'That email address is not valid.' };

  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return { error: 'An account with that email already exists.' };
  }

  const id = newId('usr');
  const { salt, hash } = hashPassword(password);
  db.prepare(
    'INSERT INTO users (id, email, name, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, email, name, salt, hash, Date.now());

  await createSession(id);
  redirect('/dashboard');
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  const row = getDb()
    .prepare<[string], { id: string; password_salt: string; password_hash: string }>(
      'SELECT id, password_salt, password_hash FROM users WHERE email = ?',
    )
    .get(email);

  // Same message either way — a distinct "no such user" leaks which addresses
  // have accounts.
  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
    return { error: 'Email or password is incorrect.' };
  }

  await createSession(row.id);
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}

// ---------------------------------------------------------------- projects

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Give the project a name.' };

  const slug = uniqueSlug(name);
  const projectId = newId('prj');
  const { key, hash, prefix } = generateApiKey();
  const now = Date.now();

  const db = getDb();
  db.transaction(() => {
    db.prepare(
      'INSERT INTO projects (id, user_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(projectId, user.id, name, slug, now);
    db.prepare(
      'INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(newId('key'), projectId, 'Default key', hash, prefix, now);
  })();

  // Returned, never redirected with: a key in the URL ends up in browser
  // history, proxy logs and the Referer header.
  return {
    slug,
    secret: key,
    message: `Project "${name}" created. Copy the key below — it is not shown again.`,
  };
}

export async function setBudgetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get('slug') ?? '');
  const { project } = await requireProject(slug);
  const raw = String(formData.get('budget') ?? '').trim();

  if (raw === '') {
    getDb().prepare('UPDATE projects SET monthly_budget_usd = NULL WHERE id = ?').run(project.id);
    revalidatePath(`/p/${slug}/settings`);
    return { message: 'Monthly budget cleared.' };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return { error: 'Enter a non-negative number.' };

  getDb().prepare('UPDATE projects SET monthly_budget_usd = ? WHERE id = ?').run(value, project.id);
  revalidatePath(`/p/${slug}`);
  revalidatePath(`/p/${slug}/settings`);
  return { message: `Monthly budget set to $${value.toLocaleString('en-US')}.` };
}

export async function deleteProjectAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const confirmation = String(formData.get('confirm') ?? '').trim();
  const { project } = await requireProject(slug);
  if (confirmation !== project.name) {
    redirect(`/p/${slug}/settings?error=${encodeURIComponent('Type the project name to confirm.')}`);
  }
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  redirect('/dashboard');
}

// ---------------------------------------------------------------- API keys

export async function createApiKeyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get('slug') ?? '');
  const { project } = await requireProject(slug);
  const name = String(formData.get('name') ?? '').trim() || 'Untitled key';

  const { key, hash, prefix } = generateApiKey();
  getDb()
    .prepare(
      'INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(newId('key'), project.id, name, hash, prefix, Date.now());

  revalidatePath(`/p/${slug}/settings`);
  return { secret: key, message: 'Key created. Copy it now — it is not shown again.' };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const keyId = String(formData.get('keyId') ?? '');
  const { project } = await requireProject(slug);

  getDb()
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND project_id = ?')
    .run(Date.now(), keyId, project.id);

  revalidatePath(`/p/${slug}/settings`);
}

// ---------------------------------------------------------------- feedback

/**
 * Record a human judgement on a trace.
 *
 * Lands in the same `scores` table as eval scores, so "was this good?" is one
 * question whether a person answered it or a scorer did.
 */
export async function addFeedbackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get('slug') ?? '');
  const { project } = await requireProject(slug);

  const traceId = String(formData.get('traceId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim() || 'quality';
  const rawValue = String(formData.get('value') ?? '').trim();
  const comment = String(formData.get('comment') ?? '').trim();

  if (!traceId) return { error: 'Missing trace.' };
  if (rawValue === '' && comment === '') {
    return { error: 'Give a rating, a comment, or both.' };
  }

  const value = rawValue === '' ? null : Number(rawValue);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
    return { error: 'Rating must be between 0 and 1.' };
  }

  // A score on a trace from another project would quietly skew its averages.
  const trace = getDb()
    .prepare<[string, string], { id: string }>(
      'SELECT id FROM traces WHERE project_id = ? AND id = ?',
    )
    .get(project.id, traceId);
  if (!trace) return { error: 'That trace does not belong to this project.' };

  addScore(project.id, {
    traceId,
    name,
    value,
    comment: comment || null,
    source: 'human',
  });

  revalidatePath(`/p/${slug}/traces/${traceId}`);
  return { message: 'Feedback recorded.' };
}

export async function deleteFeedbackAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const traceId = String(formData.get('traceId') ?? '');
  const scoreId = String(formData.get('scoreId') ?? '');
  const { project } = await requireProject(slug);

  deleteScore(project.id, scoreId);
  revalidatePath(`/p/${slug}/traces/${traceId}`);
}

// --------------------------------------------------------------- retention

/**
 * Delete spans older than the chosen horizon.
 *
 * Requires typing the number of days back as confirmation: this destroys cost
 * history, and an accidental click should not be able to do it.
 */
export async function applyRetentionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get('slug') ?? '');
  const { project } = await requireProject(slug);

  const days = Number(String(formData.get('days') ?? '').trim());
  const confirm = String(formData.get('confirm') ?? '').trim();

  if (!Number.isFinite(days) || days < 1) return { error: 'Enter a horizon of at least 1 day.' };
  if (confirm !== String(days)) {
    return { error: `Type ${days} in the confirmation box to delete data older than ${days} days.` };
  }

  const preview = previewRetention(project.id, days);
  if (preview.spans === 0) {
    return { message: `Nothing older than ${days} days — no spans deleted.` };
  }

  const result = applyRetention(project.id, days);

  revalidatePath(`/p/${slug}`);
  revalidatePath(`/p/${slug}/settings`);
  return {
    message: `Deleted ${result.deletedSpans.toLocaleString('en-US')} span(s) across ${result.deletedTraces.toLocaleString('en-US')} trace(s).${
      result.keptForExperiments > 0
        ? ` ${result.keptForExperiments} trace(s) were kept because an experiment result points at them.`
        : ''
    }`,
  };
}

// ------------------------------------------------------------ model prices

export async function upsertPriceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const slug = String(formData.get('slug') ?? '');
  const model = String(formData.get('model') ?? '').trim();
  if (!model) return { error: 'Model id is required.' };

  const numeric = (field: string): number | null => {
    const raw = String(formData.get(field) ?? '').trim();
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  const input = numeric('inputPerMTok');
  const output = numeric('outputPerMTok');
  if ((input === null) !== (output === null)) {
    return { error: 'Set both the input and output rate, or neither.' };
  }

  const provider = String(formData.get('provider') ?? '').trim() || guessProvider(model);
  const family = String(formData.get('family') ?? '').trim() || guessFamily(model, provider);
  const displayName = String(formData.get('displayName') ?? '').trim() || model;
  const contextWindow = numeric('contextWindow');
  const maxOutput = numeric('maxOutput');
  const verified = formData.get('verified') === 'on' ? 1 : 0;

  getDb()
    .prepare(
      `INSERT INTO model_prices
         (model, provider, display_name, family, input_per_mtok, output_per_mtok,
          cache_read_per_mtok, cache_write_per_mtok, context_window, max_output,
          verified, source, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(model) DO UPDATE SET
         provider = excluded.provider,
         display_name = excluded.display_name,
         family = excluded.family,
         input_per_mtok = excluded.input_per_mtok,
         output_per_mtok = excluded.output_per_mtok,
         cache_read_per_mtok = excluded.cache_read_per_mtok,
         cache_write_per_mtok = excluded.cache_write_per_mtok,
         context_window = excluded.context_window,
         max_output = excluded.max_output,
         verified = excluded.verified,
         source = excluded.source,
         updated_at = excluded.updated_at`,
    )
    .run(
      model,
      provider,
      displayName,
      family,
      input,
      output,
      numeric('cacheReadPerMTok'),
      numeric('cacheWritePerMTok'),
      contextWindow,
      maxOutput,
      verified,
      verified ? 'Confirmed by an operator in this workspace.' : 'Edited in this workspace.',
      Date.now(),
    );

  revalidatePath(`/p/${slug}/prices`);
  return { message: `Saved pricing for ${model}. Existing spans keep their recorded cost — use "Re-price history" to apply it retroactively.` };
}

/**
 * Recompute stored cost for every span against the current price table.
 *
 * Correcting a price should fix the past, not only the future; without this a
 * dashboard permanently under-reports whatever ran while a model was unpriced.
 */
export async function repriceHistoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get('slug') ?? '');
  const { project } = await requireProject(slug);
  const db = getDb();

  const updated = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE spans SET
           cost_input  = (input_tokens / 1000000.0) * p.input_per_mtok,
           cost_output = (output_tokens / 1000000.0) * p.output_per_mtok,
           cost_cache  = (cache_read_tokens / 1000000.0) * COALESCE(p.cache_read_per_mtok, p.input_per_mtok)
                       + (cache_write_tokens / 1000000.0) * COALESCE(p.cache_write_per_mtok, p.input_per_mtok),
           cost_total  = (input_tokens / 1000000.0) * p.input_per_mtok
                       + (output_tokens / 1000000.0) * p.output_per_mtok
                       + (cache_read_tokens / 1000000.0) * COALESCE(p.cache_read_per_mtok, p.input_per_mtok)
                       + (cache_write_tokens / 1000000.0) * COALESCE(p.cache_write_per_mtok, p.input_per_mtok),
           priced = 1
         FROM model_prices p
         WHERE spans.model = p.model
           AND spans.project_id = ?
           AND p.input_per_mtok IS NOT NULL
           AND p.output_per_mtok IS NOT NULL`,
      )
      .run(project.id);

    // Spans whose model lost its price must fall back to "unpriced", not keep
    // a stale number.
    db.prepare(
      `UPDATE spans SET cost_input = 0, cost_output = 0, cost_cache = 0, cost_total = 0, priced = 0
         WHERE project_id = ?
           AND model IS NOT NULL
           AND model IN (SELECT model FROM model_prices
                          WHERE input_per_mtok IS NULL OR output_per_mtok IS NULL)`,
    ).run(project.id);

    const traces = db
      .prepare<[string], { id: string }>('SELECT id FROM traces WHERE project_id = ?')
      .all(project.id);
    for (const trace of traces) {
      db.prepare(
        `UPDATE traces SET
           cost_usd = (SELECT COALESCE(SUM(cost_total), 0) FROM spans WHERE trace_id = traces.id),
           unpriced_calls = (SELECT COUNT(*) FROM spans
                              WHERE trace_id = traces.id AND kind = 'llm' AND priced = 0
                                AND (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) > 0)
         WHERE id = ?`,
      ).run(trace.id);
    }

    return result.changes;
  })();

  revalidatePath(`/p/${slug}`);
  revalidatePath(`/p/${slug}/prices`);
  return { message: `Re-priced ${updated.toLocaleString('en-US')} span(s) against the current price table.` };
}
