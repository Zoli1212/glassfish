import { NextResponse } from 'next/server';
import { authenticate, badRequest, readJson, serverError } from '@/lib/api-auth';
import { listPrompts, publishVersion } from '@/lib/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PublishBody {
  name?: string;
  description?: string;
  template?: string;
  systemTemplate?: string;
  model?: string;
  params?: Record<string, unknown>;
  commitMessage?: string;
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  try {
    return NextResponse.json({ prompts: listPrompts(auth.projectId) });
  } catch (error) {
    return serverError(error, 'list prompts');
  }
}

/** Append a version. Identical text is a no-op, reported as `unchanged`. */
export async function POST(request: Request) {
  const auth = authenticate(request);
  if ('response' in auth) return auth.response;

  const body = await readJson<PublishBody>(request);
  if (body instanceof NextResponse) return body;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest('name is required');
  if (typeof body.template !== 'string' || body.template.length === 0) {
    return badRequest('template is required');
  }
  if (body.template.length > 100_000) {
    return badRequest('template must be 100000 characters or fewer');
  }

  try {
    const result = publishVersion(
      auth.projectId,
      name,
      {
        template: body.template,
        systemTemplate: typeof body.systemTemplate === 'string' ? body.systemTemplate : null,
        model: typeof body.model === 'string' ? body.model : null,
        params: body.params ?? null,
        commitMessage: typeof body.commitMessage === 'string' ? body.commitMessage : '',
      },
      body.description ?? '',
    );

    return NextResponse.json(
      {
        prompt: { id: result.prompt.id, name: result.prompt.name },
        version: result.version.version,
        unchanged: result.unchanged,
      },
      { status: result.unchanged ? 200 : 201 },
    );
  } catch (error) {
    return serverError(error, 'publish prompt version');
  }
}
