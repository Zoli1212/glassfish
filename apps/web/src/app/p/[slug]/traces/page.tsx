import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { resolveRange } from '@/lib/constants';
import { formatTokens, formatUsd } from '@/lib/pricing';
import { distinctModels, listTraces } from '@/lib/queries';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { TraceFilters } from '@/components/TraceFilters';
import { formatDuration, formatTime } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function TracesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    range?: string;
    status?: string;
    model?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const { project } = await requireProject(slug);
  const range = resolveRange(query.range);

  const page = Math.max(1, Number(query.page ?? '1') || 1);
  const { rows, total } = listTraces(project.id, {
    since: range.since,
    status: query.status === 'error' || query.status === 'ok' ? query.status : 'all',
    model: query.model || undefined,
    search: query.q || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const models = distinctModels(project.id);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(target: number): string {
    const next = new URLSearchParams();
    if (query.range) next.set('range', query.range);
    if (query.status) next.set('status', query.status);
    if (query.model) next.set('model', query.model);
    if (query.q) next.set('q', query.q);
    next.set('page', String(target));
    return `/p/${slug}/traces?${next.toString()}`;
  }

  return (
    <>
      <PageHeader
        title="Traces"
        description={`${total.toLocaleString('en-US')} trace(s) matching the current filters.`}
      />

      <TraceFilters models={models} />

      {rows.length === 0 ? (
        <EmptyState title="No traces match these filters">
          Widen the time range, or clear the status and model filters.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Trace</th>
                  <th>Started</th>
                  <th className="num">Duration</th>
                  <th className="num">Calls</th>
                  <th className="num">Tokens</th>
                  <th className="num">Cost</th>
                  <th>User</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((trace) => (
                  <tr key={trace.id}>
                    <td>
                      <Link
                        href={`/p/${slug}/traces/${encodeURIComponent(trace.id)}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {trace.name}
                      </Link>
                      <div className="font-mono text-[11px] text-ink-muted">{trace.id}</div>
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{formatTime(trace.started_at)}</td>
                    <td className="num tnum">{formatDuration(trace.duration_ms)}</td>
                    <td className="num tnum">{trace.llm_call_count}</td>
                    <td className="num tnum">
                      {formatTokens(trace.input_tokens + trace.output_tokens)}
                    </td>
                    <td className="num tnum">
                      {trace.unpriced_calls > 0 ? (
                        <span title={`${trace.unpriced_calls} call(s) have no configured price`}>
                          {formatUsd(trace.cost_usd)}
                          <span className="ml-1 text-warning">▲</span>
                        </span>
                      ) : (
                        formatUsd(trace.cost_usd)
                      )}
                    </td>
                    <td className="text-ink-2">{trace.user_ref ?? '—'}</td>
                    <td>
                      {trace.status === 'error' ? (
                        <Badge tone="critical">✕ failed</Badge>
                      ) : (
                        <Badge tone="good">✓ ok</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-sm">
              <span className="text-ink-2">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="btn btn-ghost">
                    Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={pageHref(page + 1)} className="btn btn-ghost">
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
