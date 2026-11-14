/** Prompt registry client. */

export interface ResolvedPrompt {
  name: string;
  version: number;
  template: string;
  systemTemplate: string | null;
  model: string | null;
  params: Record<string, unknown> | null;
  commitMessage: string;
  /** Placeholder names the template expects. */
  placeholders: string[];
  /** Fill `{{name}}` placeholders. Unknown ones are left in place. */
  render(variables?: Record<string, unknown>): string;
  /** Fill the system template, if there is one. */
  renderSystem(variables?: Record<string, unknown>): string | null;
}

/**
 * Substitute `{{name}}` placeholders.
 *
 * A placeholder with no matching variable is left as-is rather than replaced
 * with an empty string: an unresolved `{{customer}}` reaching the model is
 * obvious in the output, while a silently emptied one produces a
 * plausible-looking answer about nobody.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, unknown> = {},
): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) return match;
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

interface PromptResponse {
  prompt: { name: string };
  version: {
    version: number;
    template: string;
    systemTemplate: string | null;
    model: string | null;
    params: Record<string, unknown> | null;
    commitMessage: string;
    placeholders: string[];
  };
}

export interface PromptTransport {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>;
}

export function makePromptsApi(transport: PromptTransport) {
  return {
    /**
     * Fetch a prompt. Omit `version` for the latest, or pin one so a change
     * published later cannot silently alter what your code sends.
     */
    async get(name: string, version?: number | 'latest'): Promise<ResolvedPrompt> {
      const query = version === undefined ? '' : `?version=${version}`;
      const data = await transport.request<PromptResponse>(
        'GET',
        `/api/v1/prompts/${encodeURIComponent(name)}${query}`,
      );

      const { template, systemTemplate } = data.version;
      return {
        name: data.prompt.name,
        version: data.version.version,
        template,
        systemTemplate,
        model: data.version.model,
        params: data.version.params,
        commitMessage: data.version.commitMessage,
        placeholders: data.version.placeholders,
        render: (variables) => renderTemplate(template, variables),
        renderSystem: (variables) =>
          systemTemplate === null ? null : renderTemplate(systemTemplate, variables),
      };
    },

    /** Publish a version. Identical text is a no-op and reports `unchanged`. */
    async publish(
      name: string,
      payload: {
        template: string;
        systemTemplate?: string;
        model?: string;
        params?: Record<string, unknown>;
        commitMessage?: string;
        description?: string;
      },
    ): Promise<{ version: number; unchanged: boolean }> {
      const result = await transport.request<{ version: number; unchanged: boolean }>(
        'POST',
        '/api/v1/prompts',
        { name, ...payload },
      );
      return { version: result.version, unchanged: result.unchanged };
    },

    async list(): Promise<{ name: string; latestVersion: number | null }[]> {
      const result = await transport.request<{
        prompts: { name: string; latestVersion: number | null }[];
      }>('GET', '/api/v1/prompts');
      return result.prompts;
    },
  };
}
