import { NextResponse } from 'next/server';
import { authenticate, notFound, serverError } from '@/lib/api-auth';
import { getDataset, listExamples } from '@/lib/evals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pull a dataset's examples, so a runner can iterate them. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const { name } = await params;
  const identifier = decodeURIComponent(name);

  try {
    const dataset = getDataset(auth.projectId, identifier);
    if (!dataset) return notFound(`no dataset named "${identifier}" in this project`);

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '1000') || 1000, 5_000);
    const split = url.searchParams.get('split');

    const all = listExamples(dataset.id, limit);
    const examples = split ? all.filter((e) => e.split === split) : all;

    return NextResponse.json({
      dataset: {
        id: dataset.id,
        name: dataset.name,
        description: dataset.description,
        exampleCount: dataset.exampleCount,
      },
      examples: examples.map((e) => ({
        id: e.id,
        externalId: e.externalId,
        input: e.input,
        expected: e.expected,
        metadata: e.metadata,
        split: e.split,
      })),
    });
  } catch (error) {
    return serverError(error, 'pull dataset');
  }
}
