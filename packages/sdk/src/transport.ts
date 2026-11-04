import type { FlushResult, SpanPayload } from './types';
import { sleep } from './utils';

export const SDK_NAME = 'glassfish-zero';
export const SDK_VERSION = '0.1.0';

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  debug: boolean;
  onError: (error: Error) => void;
}

/**
 * Batched, retrying HTTP transport.
 *
 * Deliberately never throws into application code: a broken collector must
 * not take down the app it is observing. Failures go to onError.
 */
export class Transport {
  constructor(private readonly options: TransportOptions) {}

  async send(spans: SpanPayload[]): Promise<FlushResult> {
    if (spans.length === 0) return { sent: 0, failed: 0 };

    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/api/v1/ingest`;
    const body = JSON.stringify({
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      sentAt: Date.now(),
      spans,
    });

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.options.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
            'user-agent': `${SDK_NAME}/${SDK_VERSION}`,
          },
          body,
          signal: controller.signal,
        });

        if (response.ok) {
          if (this.options.debug) {
            console.log(`[glassfish-zero] flushed ${spans.length} span(s)`);
          }
          return { sent: spans.length, failed: 0 };
        }

        // 4xx other than 408/429 means the payload or key is wrong. Retrying
        // an unauthorized or malformed batch only burns requests.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          const detail = await safeText(response);
          this.options.onError(
            new Error(`ingest rejected with ${response.status}: ${detail}`),
          );
          return { sent: 0, failed: spans.length };
        }

        if (attempt === this.options.maxRetries) {
          this.options.onError(
            new Error(`ingest failed after ${attempt + 1} attempt(s): HTTP ${response.status}`),
          );
          return { sent: 0, failed: spans.length };
        }
      } catch (error) {
        if (attempt === this.options.maxRetries) {
          const message = error instanceof Error ? error.message : String(error);
          this.options.onError(
            new Error(`ingest failed after ${attempt + 1} attempt(s): ${message}`),
          );
          return { sent: 0, failed: spans.length };
        }
      } finally {
        clearTimeout(timer);
      }

      await sleep(Math.min(250 * 2 ** attempt, 4000));
    }

    return { sent: 0, failed: spans.length };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '<unreadable body>';
  }
}
