import { NextResponse } from 'next/server';
import { getDb } from './db';
import { hashApiKey } from './auth';

/**
 * Bearer-key authentication for the programmatic API.
 *
 * Returns the project id, or a ready-to-return 401. Callers branch on
 * `'response' in result` so an unauthenticated request can never fall through
 * to the handler body by accident.
 */
export type AuthResult = { projectId: string; keyId: string } | { response: NextResponse };

export function authenticate(request: Request): AuthResult {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return { response: unauthorized('missing Bearer token') };

  const row = getDb()
    .prepare<[string], { id: string; project_id: string }>(
      'SELECT id, project_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
    )
    .get(hashApiKey(match[1].trim()));

  if (!row) return { response: unauthorized('unknown or revoked API key') };

  getDb().prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { projectId: row.project_id, keyId: row.id };
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', message },
    { status: 401, headers: { 'www-authenticate': 'Bearer realm="glassfish-zero"' } },
  );
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400 });
}

export function notFound(message: string): NextResponse {
  return NextResponse.json({ error: 'not_found', message }, { status: 404 });
}

export function serverError(error: unknown, context: string): NextResponse {
  const message = error instanceof Error ? error.message : 'unexpected failure';
  console.error(`[glassfish-zero] ${context}:`, error);
  return NextResponse.json({ error: 'server_error', message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T | NextResponse> {
  try {
    return (await request.json()) as T;
  } catch {
    return badRequest('body must be valid JSON');
  }
}
