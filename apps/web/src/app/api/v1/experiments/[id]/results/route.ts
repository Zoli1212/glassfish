import { NextResponse } from 'next/server';
import { authenticate, badRequest, notFound, readJson, serverError } from '@/lib/api-auth';
import { addResults, getExperiment, type ResultInput } from '@/lib/evals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RESULTS_PER_BATCH = 500;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const { id } = await params;
  const body = await readJson<{ results?: unknown }>(request);
  if (body instanceof NextResponse) return body;

  if (!Array.isArray(body.results)) return badRequest('body.results must be an array');
  if (body.results.length > MAX_RESULTS_PER_BATCH) {
    return badRequest(
      `batch too large: ${body.results.length} results (max ${MAX_RESULTS_PER_BATCH})`,
    );
  }

  try {
    const experiment = getExperiment(auth.projectId, id);
    if (!experiment) return notFound(`no experiment ${id} in this project`);

    const results: ResultInput[] = [];
    for (const [index, raw] of body.results.entries()) {
      if (typeof raw !== 'object' || raw === null) {
        return badRequest(`results[${index}] must be an object`);
      }
      const r = raw as Record<string, unknown>;
      const scores = Array.isArray(r.scores) ? r.scores : [];

      for (const [j, s] of scores.entries()) {
        if (typeof s !== 'object' || s === null || typeof (s as { name?: unknown }).name !== 'string') {
          return badRequest(`results[${index}].scores[${j}].name is required`);
        }
      }

      results.push({
        externalId: typeof r.externalId === 'string' ? r.externalId : null,
        exampleId: typeof r.exampleId === 'string' ? r.exampleId : null,
        traceId: typeof r.traceId === 'string' ? r.traceId : null,
        input: r.input,
        expected: r.expected,
        output: typeof r.output === 'string' ? r.output : null,
        status: r.status === 'error' ? 'error' : 'ok',
        errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage : null,
        latencyMs: Number(r.latencyMs) || 0,
        costUsd: Number(r.costUsd) || 0,
        inputTokens: Number(r.inputTokens) || 0,
        outputTokens: Number(r.outputTokens) || 0,
        scores: (scores as Record<string, unknown>[]).map((s) => ({
          name: String(s.name),
          value: typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : null,
          label: typeof s.label === 'string' ? s.label : null,
          comment: typeof s.comment === 'string' ? s.comment : null,
          source: typeof s.source === 'string' ? s.source : 'code',
          judgeModel: typeof s.judgeModel === 'string' ? s.judgeModel : null,
          judgeCostUsd: Number(s.judgeCostUsd) || 0,
        })),
      });
    }

    const written = addResults(auth.projectId, id, results);
    return NextResponse.json({ written }, { status: 202 });
  } catch (error) {
    return serverError(error, 'add experiment results');
  }
}
