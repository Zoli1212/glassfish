import { NextResponse } from 'next/server';
import { authenticate, notFound, serverError } from '@/lib/api-auth';
import { getExperiment, rollUpExperiment, scoreSummary } from '@/lib/evals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Close an experiment and return its score summary.
 *
 * The totals are recomputed from the stored results rather than accumulated
 * as they arrive, so a retried batch cannot inflate them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const { id } = await params;

  try {
    if (!getExperiment(auth.projectId, id)) {
      return notFound(`no experiment ${id} in this project`);
    }

    rollUpExperiment(id, true);
    const experiment = getExperiment(auth.projectId, id);

    return NextResponse.json({
      experiment: {
        id,
        name: experiment?.name,
        status: experiment?.status,
        resultCount: experiment?.resultCount ?? 0,
        errorCount: experiment?.errorCount ?? 0,
        costUsd: experiment?.costUsd ?? 0,
        avgLatencyMs: experiment?.avgLatencyMs ?? 0,
      },
      scores: scoreSummary(id),
    });
  } catch (error) {
    return serverError(error, 'finish experiment');
  }
}
