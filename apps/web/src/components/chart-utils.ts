export function niceMax(value: number, steps = 4): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const rough = value / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const stepFactor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return stepFactor * magnitude * steps;
}

export function ticks(max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push((max / count) * i);
  return out;
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 1) return value.toFixed(0);
  return value.toFixed(2);
}

export function compactUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000) return `$${compactNumber(value)}`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs === 0) return '$0';
  if (abs >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(5)}`;
}

export function formatBucketLabel(bucket: string): string {
  // Buckets are either YYYY-MM-DD or YYYY-MM-DDTHH:00.
  if (bucket.includes('T')) {
    const [date, time] = bucket.split('T');
    const day = date.slice(5).replace('-', '/');
    return `${day} ${time}`;
  }
  return bucket.slice(5).replace('-', '/');
}

/** Pick ~n evenly spaced indices so axis labels never collide. */
export function sparseIndices(length: number, max: number): Set<number> {
  if (length <= max) return new Set(Array.from({ length }, (_, i) => i));
  const step = Math.ceil(length / max);
  const out = new Set<number>();
  for (let i = 0; i < length; i += step) out.add(i);
  out.add(length - 1);
  return out;
}

export const SPAN_KIND_COLORS: Record<string, string> = {
  llm: 'var(--series-1)',
  tool: 'var(--series-2)',
  retrieval: 'var(--series-3)',
  embedding: 'var(--series-4)',
  chain: 'var(--series-5)',
  custom: 'var(--axis)',
};

export const SPAN_KIND_LABELS: Record<string, string> = {
  llm: 'LLM call',
  tool: 'Tool',
  retrieval: 'Retrieval',
  embedding: 'Embedding',
  chain: 'Chain',
  custom: 'Custom',
};

export function spanKindColor(kind: string): string {
  return SPAN_KIND_COLORS[kind] ?? SPAN_KIND_COLORS.custom;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
