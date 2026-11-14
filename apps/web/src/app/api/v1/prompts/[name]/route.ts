import { NextResponse } from 'next/server';
import { authenticate, notFound, serverError } from '@/lib/api-auth';
import { getPrompt, getVersion, placeholders } from '@/lib/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fetch one version of a prompt — the latest, or a pinned one.
 *
 * Pinning matters: an experiment that scored version 3 should be able to
 * re-run against version 3, not against whatever has been published since.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const { name } = await params;
  const identifier = decodeURIComponent(name);

  try {
    const prompt = getPrompt(auth.projectId, identifier);
    if (!prompt) return notFound(`no prompt named "${identifier}" in this project`);

    const url = new URL(request.url);
    const raw = url.searchParams.get('version');
    const requested = raw === null || raw === 'latest' ? null : Number(raw);
    if (requested !== null && !Number.isInteger(requested)) {
      return notFound(`version must be an integer or "latest", got "${raw}"`);
    }

    const version = getVersion(prompt.id, requested);
    if (!version) {
      return notFound(
        requested === null
          ? `prompt "${identifier}" has no versions yet`
          : `prompt "${identifier}" has no version ${requested}`,
      );
    }

    return NextResponse.json({
      prompt: { id: prompt.id, name: prompt.name, description: prompt.description },
      version: {
        id: version.id,
        version: version.version,
        template: version.template,
        systemTemplate: version.systemTemplate,
        model: version.model,
        params: version.params,
        commitMessage: version.commitMessage,
        createdAt: version.createdAt,
        placeholders: placeholders(version.template),
      },
      latestVersion: prompt.latestVersion,
    });
  } catch (error) {
    return serverError(error, 'get prompt');
  }
}
