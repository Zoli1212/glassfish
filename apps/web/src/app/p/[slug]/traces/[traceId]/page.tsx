import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProject } from '@/lib/auth';
import { getTrace, getTraceSpans } from '@/lib/queries';
import { formatTokens, formatUsd } from '@/lib/pricing';
import { Badge, Card, Notice, PageHeader, StatTile } from '@/components/ui';
import { TraceExplorer, type SpanDetail } from '@/components/TraceExplorer';
import { FeedbackPanel } from '@/components/FeedbackPanel';
import { traceScores } from '@/lib/evals';
import { formatDuration, formatTime } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ slug: string; traceId: string }>;
}) {
  const { slug, traceId } = await params;
  const { project } = await requireProject(slug);

  const decoded = decodeURIComponent(traceId);
  const trace = getTrace(project.id, decoded);
  if (!trace) notFound();

  const scores = traceScores(project.id, decoded);
  const rows = getTraceSpans(project.id, decoded);
  const spans: SpanDetail[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    model: row.model,
    provider: row.provider,
    status: row.status,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    costTotal: row.cost_total,
    priced: row.priced,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    errorType: row.error_type,
    errorMessage: row.error_message,
    ttftMs: row.ttft_ms,
    stream: row.stream,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    inputChars: row.input_chars,
    outputChars: row.output_chars,
    costInput: row.cost_input,
    costOutput: row.cost_output,
    costCache: row.cost_cache,
    tags: parseJson<Record<string, string>>(row.tags_json),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    inputPreview: row.input_preview,
    outputPreview: row.output_preview,
  }));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {trace.name}
            {trace.status === 'error' ? (
              <Badge tone="critical">✕ failed</Badge>
            ) : (
              <Badge tone="good">✓ ok</Badge>
            )}
          </span>
        }
        description={
          <span className="font-mono text-xs">
            {trace.id} · {formatTime(trace.started_at)}
            {trace.user_ref ? ` · user ${trace.user_ref}` : ''}
            {trace.environment ? ` · ${trace.environment}` : ''}
          </span>
        }
        action={
          <Link href={`/p/${slug}/traces`} className="btn btn-ghost">
            Back to traces
          </Link>
        }
      />

      {trace.unpriced_calls > 0 ? (
        <div className="mb-5">
          <Notice
            tone="warning"
            title={`${trace.unpriced_calls} call(s) in this trace use a model with no configured price.`}
          >
            The cost below covers only the priced calls.{' '}
            <Link href={`/p/${slug}/prices`} className="font-medium underline">
              Set the missing rates
            </Link>
            .
          </Notice>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Duration" value={formatDuration(trace.duration_ms)} />
        <StatTile
          label="Spans"
          value={trace.span_count.toLocaleString('en-US')}
          sub={`${trace.llm_call_count} LLM call(s)`}
        />
        <StatTile
          label="Tokens"
          value={formatTokens(trace.input_tokens + trace.output_tokens)}
          sub={`${formatTokens(trace.input_tokens)} in · ${formatTokens(trace.output_tokens)} out`}
        />
        <StatTile
          label="Cost"
          value={formatUsd(trace.cost_usd)}
          tone={trace.unpriced_calls > 0 ? 'warning' : 'neutral'}
          sub={trace.unpriced_calls > 0 ? 'Incomplete — some calls unpriced' : undefined}
        />
      </div>

      <TraceExplorer
        spans={spans}
        traceStart={trace.started_at}
        traceDuration={Math.max(1, trace.duration_ms)}
      />

      <Card
        title="Was this good?"
        description="Human and automated judgements share one table, so quality and cost can be read side by side."
        className="mt-5"
      >
        <FeedbackPanel slug={slug} traceId={trace.id} scores={scores} />
      </Card>
    </>
  );
}
