import Link from 'next/link';
import { requireProject } from '@/lib/auth';
import { listPrompts } from '@/lib/prompts';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { CopyBlock } from '@/components/CopyField';
import { formatRelative } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

const SNIPPET = `// Publish a version from your deploy script or a migration
await gf.prompts.publish('support-reply', {
  template: 'Answer the question using only the context.\\n\\n{{question}}',
  systemTemplate: 'You are terse and never invent policy.',
  model: 'claude-opus-5',
  commitMessage: 'tighten the no-invention instruction',
});

// Read it back in your application, pinned so a later publish
// cannot change what this code sends
const prompt = await gf.prompts.get('support-reply', 3);

await anthropic.messages.create({
  model: prompt.model,
  max_tokens: 1024,
  system: prompt.renderSystem(),
  messages: [{ role: 'user', content: prompt.render({ question }) }],
});`;

export default async function PromptsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { project } = await requireProject(slug);
  const prompts = listPrompts(project.id);

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Versioned prompt text. A prompt that lives only in a source file is invisible to the thing measuring it."
      />

      {prompts.length === 0 ? (
        <>
          <EmptyState title="No prompts registered yet">
            Prompts are published from your code — there is nothing to create here first.
          </EmptyState>
          <Card title="Publish one" className="mt-5">
            <CopyBlock code={SNIPPET} />
            <p className="m-0 mt-3 text-sm text-ink-2">
              Publishing identical text is a no-op, so a deploy script that pushes on every boot
              will not fill the history with duplicates and make the version number meaningless.
            </p>
          </Card>
        </>
      ) : (
        <Card className="p-0">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th className="num">Versions</th>
                  <th className="num">Latest</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((prompt) => (
                  <tr key={prompt.id}>
                    <td>
                      <Link
                        href={`/p/${slug}/prompts/${encodeURIComponent(prompt.name)}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {prompt.name}
                      </Link>
                      {prompt.description ? (
                        <div className="text-xs text-ink-muted">{prompt.description}</div>
                      ) : null}
                    </td>
                    <td className="num tnum">{prompt.versionCount}</td>
                    <td className="num tnum">
                      {prompt.latestVersion === null ? '—' : `v${prompt.latestVersion}`}
                    </td>
                    <td className="whitespace-nowrap text-ink-2">
                      {formatRelative(prompt.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
