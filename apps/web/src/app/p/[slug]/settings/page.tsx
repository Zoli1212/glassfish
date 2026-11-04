import { requireProject } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Card, Notice, PageHeader } from '@/components/ui';
import { BudgetForm, CreateKeyForm } from '@/components/SettingsForms';
import { CopyBlock } from '@/components/CopyField';
import { deleteProjectAction, revokeApiKeyAction } from '@/app/actions';
import { formatRelative, formatTime } from '@/components/chart-utils';

export const dynamic = 'force-dynamic';

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { project } = await requireProject(slug);

  const keys = getDb()
    .prepare<[string], KeyRow>(
      'SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE project_id = ? ORDER BY created_at DESC',
    )
    .all(project.id);

  const activeKeys = keys.filter((k) => k.revoked_at === null);

  const envSnippet = `GLASSFISH_API_KEY=gfz_live_…
GLASSFISH_BASE_URL=${process.env.GLASSFISH_PUBLIC_URL ?? 'http://localhost:3000'}`;

  return (
    <>
      <PageHeader title="Settings" description={`Project “${project.name}” · /${project.slug}`} />

      {error ? (
        <div className="mb-5">
          <Notice tone="critical" title={error} />
        </div>
      ) : null}

      {activeKeys.length === 0 ? (
        <div className="mb-5">
          <Notice tone="critical" title="This project has no active API key.">
            Nothing can send spans to it until you create one.
          </Notice>
        </div>
      ) : null}

      <Card
        title="API keys"
        description="One key per application or environment. Revoking a key stops ingest from it immediately; recorded spans are untouched."
        className="mb-5"
      >
        <CreateKeyForm slug={slug} />

        <div className="scroll-x mt-5">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td className="font-medium">{key.name}</td>
                  <td className="font-mono text-xs">{key.key_prefix}…</td>
                  <td className="whitespace-nowrap text-ink-2">{formatTime(key.created_at)}</td>
                  <td className="whitespace-nowrap text-ink-2">
                    {key.last_used_at ? formatRelative(key.last_used_at) : 'never'}
                  </td>
                  <td>
                    {key.revoked_at ? (
                      <Badge tone="critical">✕ revoked</Badge>
                    ) : (
                      <Badge tone="good">✓ active</Badge>
                    )}
                  </td>
                  <td>
                    {key.revoked_at ? null : (
                      <form action={revokeApiKeyAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="keyId" value={key.id} />
                        <button type="submit" className="btn btn-danger px-2 py-1 text-xs">
                          Revoke
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Application configuration"
        description="What the SDK reads from the environment."
        className="mb-5"
      >
        <CopyBlock code={envSnippet} />
      </Card>

      <Card
        title="Monthly budget"
        description="A target to measure month-to-date spend against. It reports; it does not block traffic."
        className="mb-5"
      >
        <BudgetForm slug={slug} current={project.monthlyBudgetUsd} />
      </Card>

      <Card title="Delete this project">
        <p className="m-0 mb-4 text-sm text-ink-2">
          Deletes the project, its API keys, and every trace and span recorded against it. The
          shared model price table is not affected. This cannot be undone.
        </p>
        <form action={deleteProjectAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="slug" value={slug} />
          <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-xs">
            <span className="font-medium text-ink-2">
              Type <strong>{project.name}</strong> to confirm
            </span>
            <input name="confirm" className="field" autoComplete="off" required />
          </label>
          <button type="submit" className="btn btn-danger">
            Delete project
          </button>
        </form>
      </Card>
    </>
  );
}
