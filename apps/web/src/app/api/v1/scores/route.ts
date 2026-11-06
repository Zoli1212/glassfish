import { NextResponse } from 'next/server';
import { authenticate, badRequest, readJson, serverError } from '@/lib/api-auth';
import { addScore } from '@/lib/evals';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScoreBody {
  traceId?: string;
  name?: string;
  value?: number;
  label?: string;
  comment?: string;
  source?: string;
}

/**
 * Attach a score to a trace — the feedback channel.
 *
 * Deliberately the same table the eval scores land in: a judgement is a
 * judgement, whether it came from a person clicking thumbs-down or from a
 * scorer in a batch run. Keeping them apart would mean two of every query.
 */
export async function POST(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const body = await readJson<ScoreBody>(request);
  if (body instanceof NextResponse) return body;

  const traceId = typeof body.traceId === 'string' ? body.traceId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!traceId) return badRequest('traceId is required');
  if (!name) return badRequest('name is required');

  const hasValue = typeof body.value === 'number' && Number.isFinite(body.value);
  const hasLabel = typeof body.label === 'string' && body.label.length > 0;
  if (!hasValue && !hasLabel) return badRequest('provide a numeric value, a label, or both');

  try {
    // A score pointing at a trace this project never recorded is a typo, not
    // data — storing it would quietly skew every average that reads it.
    const trace = getDb()
      .prepare<[string, string], { id: string }>(
        'SELECT id FROM traces WHERE project_id = ? AND id = ?',
      )
      .get(auth.projectId, traceId);
    if (!trace) return badRequest(`no trace ${traceId} in this project`);

    const id = addScore(auth.projectId, {
      traceId,
      name,
      value: hasValue ? body.value : null,
      label: hasLabel ? body.label : null,
      comment: typeof body.comment === 'string' ? body.comment : null,
      source: body.source === 'human' || body.source === 'judge' ? body.source : 'code',
    });

    return NextResponse.json({ score: { id, traceId, name } }, { status: 201 });
  } catch (error) {
    return serverError(error, 'add score');
  }
}
