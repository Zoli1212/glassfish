import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, findProjectBySlug } from '@/lib/auth';
import { ProjectNav } from '@/components/ProjectNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { logoutAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');

  const project = findProjectBySlug(user.id, slug);
  if (!project) redirect('/dashboard');

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-5 w-5 rounded-[6px]"
                style={{ background: 'var(--series-3)' }}
              />
              <span className="font-semibold">Glassfish Zero</span>
            </Link>
            <span aria-hidden className="text-ink-muted">
              /
            </span>
            <span className="font-medium">{project.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <form action={logoutAction}>
              <button type="submit" className="btn btn-ghost">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6">
          <ProjectNav slug={slug} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
