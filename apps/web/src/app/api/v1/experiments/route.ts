import { NextResponse } from 'next/server';
import { authenticate, badRequest, readJson, serverError } from '@/lib/api-auth';
import { createExperiment, getDataset, listExperiments } from '@/lib/evals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateBody {
  name?: string;
  description?: string;
  dataset?: string;
  targetModel?: string;
  exampleCount?: number;
  metadata?: Record<string, unknown>;
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  try {
    return NextResponse.json({ experiments: listExperiments(auth.projectId) });
  } catch (error) {
    return serverError(error, 'list experiments');
  }
}

/** Open an experiment. Results are streamed in afterwards and rolled up. */
export async function POST(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const body = await readJson<CreateBody>(request);
  if (body instanceof NextResponse) return body;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest('name is required');

  try {
    // A dataset reference that does not resolve is reported rather than
    // silently dropped: an experiment with no dataset cannot be compared
    // against another run, which is the whole point of recording it.
    let datasetId: string | null = null;
    if (body.dataset) {
      const dataset = getDataset(auth.projectId, body.dataset);
      if (!dataset) return badRequest(`no dataset named "${body.dataset}" in this project`);
      datasetId = dataset.id;
    }

    const id = createExperiment(auth.projectId, {
      name,
      description: body.description,
      datasetId,
      targetModel: body.targetModel ?? null,
      exampleCount: Number.isFinite(body.exampleCount) ? Number(body.exampleCount) : 0,
      metadata: body.metadata ?? null,
    });

    return NextResponse.json({ experiment: { id, name } }, { status: 201 });
  } catch (error) {
    return serverError(error, 'create experiment');
  }
}
