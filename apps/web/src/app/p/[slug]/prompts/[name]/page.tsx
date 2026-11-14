import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProject } from '@/lib/auth';
import { diffLines, getPrompt, listVersions, placeholders } from '@/lib/prompts';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatRelative, formatTime } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

export default async function PromptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; name: string }>;
  searchParams: Promise<{ v?: string; against?: string }>;
}) {
  const { slug, name } = await params;
  const { v, against } = await searchParams;
  const { project } = await requireProject(slug);

  const prompt = getPrompt(project.id, decodeURIComponent(name));
  if (!prompt) notFound();

  const versions = listVersions(prompt.id, 100);
  if (versions.length === 0) {
    return (
      <>
        <PageHeader title={prompt.name} description={prompt.description} />
        <EmptyState title="This prompt has no versions yet" />
      </>
    );
  }

  const selected = versions.find((x) => String(x.version) === v) ?? versions[0];
  const previousDefault = versions.find((x) => x.version < selected.version);
  const comparedTo = versions.find((x) => String(x.version) === against) ?? previousDefault;
  const diff = comparedTo ? diffLines(comparedTo.template, selected.template) : null;
  const vars = placeholders(selected.template);

  return (
    <>
      <PageHeader
        title={prompt.name}
        description={prompt.description || 'No description.'}
        action={
          <Link href={`/p/${slug}/prompts`} className="btn btn-ghost">
            All prompts
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card title="Versions" className="h-fit">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {versions.map((version) => {
              const active = version.version === selected.version;
              return (
                <li key={version.id}>
                  <Link
                    href={`/p/${slug}/prompts/${encodeURIComponent(prompt.name)}?v=${version.version}`}
                    className={`block rounded-md px-2.5 py-2 text-sm ${
                      active ? 'bg-surface-3 font-medium' : 'hover:bg-surface-2'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span>v{version.version}</span>
                      {version.version === prompt.latestVersion ? (
                        <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                          latest
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {formatRelative(version.createdAt)}
                    </div>
                    {version.commitMessage ? (
                      <div className="mt-0.5 truncate text-xs text-ink-2">
                        {version.commitMessage}
                      </div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="flex flex-col gap-4">
          <Card
            title={`Version ${selected.version}`}
            description={formatTime(selected.createdAt)}
            action={
              selected.model ? (
                <span className="font-mono text-xs text-ink-2">{selected.model}</span>
              ) : null
            }
          >
            {vars.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-muted">Placeholders:</span>
                {vars.map((variable) => (
                  <Badge key={variable} tone="info">
                    {`{{${variable}}}`}
                  </Badge>
                ))}
              </div>
            ) : null}

            {selected.systemTemplate ? (
              <>
                <h3 className="m-0 mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  System
                </h3>
                <pre className="scroll-x m-0 mb-4 whitespace-pre-wrap break-words rounded-lg border border-hairline bg-surface-2 p-3 font-mono text-xs">
                  {selected.systemTemplate}
                </pre>
              </>
            ) : null}

            <h3 className="m-0 mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
              Template
            </h3>
            <pre className="scroll-x m-0 whitespace-pre-wrap break-words rounded-lg border border-hairline bg-surface-2 p-3 font-mono text-xs">
              {selected.template}
            </pre>

            {selected.params ? (
              <>
                <h3 className="m-0 mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Parameters
                </h3>
                <pre className="scroll-x m-0 rounded-lg border border-hairline bg-surface-2 p-3 font-mono text-xs">
                  {JSON.stringify(selected.params, null, 2)}
                </pre>
              </>
            ) : null}
          </Card>

          {diff && comparedTo ? (
            <Card
              title={`Changes from v${comparedTo.version} to v${selected.version}`}
              description={selected.commitMessage || undefined}
            >
              <pre className="scroll-x m-0 rounded-lg border border-hairline bg-surface-2 p-3 font-mono text-xs leading-relaxed">
                {diff.map((line, index) => (
                  <div
                    key={index}
                    className={
                      line.type === 'added'
                        ? 'text-success-text'
                        : line.type === 'removed'
                          ? 'text-danger-text'
                          : 'text-ink-2'
                    }
                  >
                    <span aria-hidden className="select-none opacity-60">
                      {line.type === 'added' ? '+ ' : line.type === 'removed' ? '− ' : '  '}
                    </span>
                    {line.text || ' '}
                  </div>
                ))}
              </pre>
            </Card>
          ) : (
            <Card title="Changes">
              <p className="m-0 text-sm text-ink-muted">
                This is the first version — there is nothing to compare it against.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
