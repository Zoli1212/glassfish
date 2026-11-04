import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashApiKey } from '@/lib/auth';
import { IngestError, ingestSpans } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface KeyRow {
  id: string;
  project_id: string;
}

function unauthorized(message: string) {
  return NextResponse.json(
    { error: 'unauthorized', message },
    { status: 401, headers: { 'www-authenticate': 'Bearer realm="glassfish-zero"' } },
  );
}

export async function POST(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return unauthorized('missing Bearer token');

  const db = getDb();
  const keyRow = db
    .prepare<[string], KeyRow>(
      'SELECT id, project_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
    )
    .get(hashApiKey(match[1].trim()));

  if (!keyRow) return unauthorized('unknown or revoked API key');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'bad_request', message: 'body must be valid JSON' },
      { status: 400 },
    );
  }

  const payload = body as { spans?: unknown; sdk?: { name?: string; version?: string } };
  const sdkLabel = payload.sdk?.name
    ? `${payload.sdk.name}@${payload.sdk.version ?? 'unknown'}`
    : null;

  try {
    const result = ingestSpans(keyRow.project_id, payload.spans, sdkLabel);
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), keyRow.id);

    return NextResponse.json(
      {
        accepted: result.accepted,
        rejected: result.rejected,
        traces: result.traces,
        // Surfaced so an SDK user finds out about an unpriced model from the
        // response, not from a cost chart that silently reads zero.
        warnings: result.unpricedModels.length
          ? [
              {
                code: 'unpriced_models',
                message: `No price configured for: ${result.unpricedModels.join(', ')}. Spans are stored, cost is reported as unpriced.`,
                models: result.unpricedModels,
              },
            ]
          : [],
      },
      { status: result.rejected.length > 0 ? 207 : 202 },
    );
  } catch (error) {
    if (error instanceof IngestError) {
      return NextResponse.json({ error: 'bad_request', message: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'unexpected ingest failure';
    console.error('[glassfish-zero] ingest failed:', error);
    return NextResponse.json({ error: 'server_error', message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'method_not_allowed', message: 'POST a batch of spans to this endpoint' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
