import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';

const SESSION_COOKIE = 'gfz_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SCRYPT_KEYLEN = 64;

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  createdAt: number;
  monthlyBudgetUsd: number | null;
}

// ------------------------------------------------------------ registration

/**
 * Whether anyone may still create an account.
 *
 * On a public URL an open registration form is a stranger's way in, so it
 * closes by itself: signup is permitted only while the instance has no users
 * (the one-time bootstrap) unless an operator deliberately re-opens it with
 * `GLASSFISH_ALLOW_SIGNUP=1`. Nothing to remember to turn off after deploying.
 */
export function signupAllowed(): boolean {
  if (process.env.GLASSFISH_ALLOW_SIGNUP === '1') return true;
  return userCount() === 0;
}

export function userCount(): number {
  return getDb().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0;
}

// --------------------------------------------------------------- passwords

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------- API keys

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString('base64url');
  const key = `gfz_live_${secret}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 16) };
}

/**
 * API keys are high-entropy random strings, so a single SHA-256 is the right
 * tool — a slow KDF here would only add latency to every ingest request
 * without adding meaningful resistance.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// ---------------------------------------------------------------- sessions

export async function createSession(userId: string): Promise<void> {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, now, now + SESSION_TTL_MS);

  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  store.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const row = getDb()
    .prepare<[string, number], { id: string; email: string; name: string }>(
      `SELECT u.id, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(id, Date.now());

  return row ?? null;
}

/**
 * Resolve the signed-in user or send them to sign in.
 *
 * Redirects rather than throwing: an expired session is an ordinary state,
 * and `redirect()` is correct in both server components and server actions —
 * a thrown error would surface as a 500 page instead.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

// ---------------------------------------------------------------- projects

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  created_at: number;
  monthly_budget_usd: number | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    monthlyBudgetUsd: row.monthly_budget_usd,
  };
}

export function listProjects(userId: string): Project[] {
  return getDb()
    .prepare<[string], ProjectRow>(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(userId)
    .map(toProject);
}

export function findProjectBySlug(userId: string, slug: string): Project | null {
  const row = getDb()
    .prepare<[string, string], ProjectRow>(
      'SELECT * FROM projects WHERE user_id = ? AND slug = ?',
    )
    .get(userId, slug);
  return row ? toProject(row) : null;
}

/**
 * Resolve a project owned by the signed-in user.
 *
 * A slug that exists but belongs to someone else is indistinguishable here
 * from one that does not exist, so ownership cannot be probed.
 */
export async function requireProject(slug: string): Promise<{ user: User; project: Project }> {
  const user = await requireUser();
  const project = findProjectBySlug(user.id, slug);
  if (!project) redirect('/dashboard');
  return { user, project };
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    // Strip combining diacritics so "Ügyfél" becomes "ugyfel", not "gyfl".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'project';
}

export function uniqueSlug(name: string): string {
  const db = getDb();
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
