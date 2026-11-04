import type { ReactNode } from 'react';

export function Card({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {title || action ? (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? <h2 className="m-0 text-base font-semibold">{title}</h2> : null}
            {description ? (
              <p className="m-0 mt-1 text-sm text-ink-2">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A single headline figure. No plot, so no hover layer — the number is the
 * whole message and a sparkline would add ink without adding information.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-success-text'
      : tone === 'critical'
        ? 'text-danger-text'
        : tone === 'warning'
          ? 'text-warning'
          : '';
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold leading-none ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-1.5 text-xs text-ink-2">{sub}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'info';
  title?: string;
}) {
  const styles: Record<string, string> = {
    neutral: 'border-hairline-strong text-ink-2',
    good: 'border-good/40 text-success-text',
    warning: 'border-warning/50 text-warning',
    critical: 'border-critical/50 text-danger-text',
    info: 'border-series-1/40 text-series-1',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A problem the operator must see. Used for unpriced models and unverified
 * prices: an understated cost figure that looks confident is worse than a
 * loud warning.
 */
export function Notice({
  tone = 'warning',
  title,
  children,
}: {
  tone?: 'warning' | 'critical' | 'info';
  title: ReactNode;
  children?: ReactNode;
}) {
  const icon = tone === 'critical' ? '✕' : tone === 'info' ? 'ℹ' : '▲';
  const border =
    tone === 'critical'
      ? 'border-critical/45'
      : tone === 'info'
        ? 'border-series-1/40'
        : 'border-warning/55';
  const ink =
    tone === 'critical' ? 'text-danger-text' : tone === 'info' ? 'text-series-1' : 'text-warning';
  return (
    <div className={`card flex gap-3 border px-4 py-3 ${border}`}>
      <span aria-hidden className={`mt-px shrink-0 font-bold ${ink}`}>
        {icon}
      </span>
      <div className="min-w-0 text-sm">
        <div className="font-medium">{title}</div>
        {children ? <div className="mt-1 text-ink-2">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-hairline-strong px-6 py-10 text-center">
      <p className="m-0 font-medium">{title}</p>
      {children ? <div className="mt-2 text-sm text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-semibold">{title}</h1>
        {description ? <p className="m-0 mt-1 text-sm text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
