import { NextResponse } from 'next/server';
import { authenticate, badRequest, readJson, serverError } from '@/lib/api-auth';
import { listDatasets, putExamples, upsertDataset, type ExampleInput } from '@/lib/evals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PushBody {
  name?: string;
  description?: string;
  examples?: unknown;
}

/** List this project's datasets. */
export async function GET(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  try {
    return NextResponse.json({ datasets: listDatasets(auth.projectId) });
  } catch (error) {
    return serverError(error, 'list datasets');
  }
}

/**
 * Create or update a dataset and its examples.
 *
 * Examples carrying an `externalId` are matched on it, so re-running a push
 * script updates rows in place instead of appending a second copy of the
 * whole dataset — which would silently double the cost of every later run.
 */
export async function POST(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const body = await readJson<PushBody>(request);
  if (body instanceof NextResponse) return body;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest('name is required');
  if (name.length > 120) return badRequest('name must be 120 characters or fewer');

  const rawExamples = Array.isArray(body.examples) ? body.examples : [];
  if (rawExamples.length > 5_000) {
    return badRequest(`too many examples: ${rawExamples.length} (max 5000 per request)`);
  }

  const examples: ExampleInput[] = [];
  for (const [index, raw] of rawExamples.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return badRequest(`examples[${index}] must be an object`);
    }
    const example = raw as Record<string, unknown>;
    if (!('input' in example)) return badRequest(`examples[${index}].input is required`);
    examples.push({
      externalId:
        typeof example.externalId === 'string' && example.externalId ? example.externalId : null,
      input: example.input,
      expected: example.expected,
      metadata:
        typeof example.metadata === 'object' && example.metadata !== null
          ? (example.metadata as Record<string, unknown>)
          : null,
      split: typeof example.split === 'string' ? example.split : 'test',
    });
  }

  try {
    const dataset = upsertDataset(auth.projectId, name, body.description ?? '');
    const written = examples.length > 0 ? putExamples(dataset.id, examples) : 0;
    return NextResponse.json({ dataset: { id: dataset.id, name: dataset.name }, written });
  } catch (error) {
    return serverError(error, 'push dataset');
  }
}
