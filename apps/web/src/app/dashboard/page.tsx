import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, listProjects } from '@/lib/auth';
import { monthToDateCost, overview } from '@/lib/queries';
import { formatTokens, formatUsd } from '@/lib/pricing';
import { Card, EmptyState, PageHeader, StatTile } from '@/components/ui';
import { NewProjectForm } from '@/components/NewProjectForm';
import { ThemeToggle } from '@/components/ThemeToggle';
import { logoutAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const projects = listProjects(user.id);
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const cards = projects.map((project) => ({
    project,
    stats: overview(project.id, since),
    mtd: monthToDateCost(project.id),
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-5 w-5 rounded-[6px]"
            style={{ background: 'var(--series-3)' }}
          />
          <span className="font-semibold">Glassfish Zero</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-2">{user.email}</span>
          <ThemeToggle />
          <form action={logoutAction}>
            <button type="submit" className="btn btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <PageHeader
        title="Projects"
        description="One project per application or environment. Each has its own API keys and its own cost history."
      />

      <Card title="New project" className="mb-8">
        <NewProjectForm />
      </Card>

      {cards.length === 0 ? (
        <EmptyState title="No projects yet">
          Create one above to get an API key and start sending spans.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map(({ project, stats, mtd }) => (
            <Link key={project.id} href={`/p/${project.slug}`} className="card block p-5 hover:bg-surface-2">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 text-base font-semibold">{project.name}</h2>
                <span className="font-mono text-xs text-ink-muted">/{project.slug}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <StatTile label="Spend · 7d" value={formatUsd(stats.cost)} />
                <StatTile label="Spend · month to date" value={formatUsd(mtd)} />
                <StatTile label="LLM calls · 7d" value={stats.llmCalls.toLocaleString('en-US')} />
                <StatTile
                  label="Tokens · 7d"
                  value={formatTokens(stats.totalTokens)}
                  sub={stats.errors > 0 ? `${stats.errors} failed span(s)` : undefined}
                  tone={stats.errors > 0 ? 'critical' : 'neutral'}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
