import { randomUUID, randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  try {
    return `${prefix}_${randomUUID().replace(/-/g, '')}`;
  } catch {
    return `${prefix}_${randomBytes(16).toString('hex')}`;
  }
}

export function now(): number {
  return Date.now();
}

export function truncate(value: unknown, maxChars: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[+${text.length - maxChars} chars]`;
}

/**
 * Length in characters of whatever text a prompt or completion carries.
 * Walks the content-block shapes Anthropic and OpenAI use so the count
 * reflects actual text, not JSON punctuation.
 */
export function textLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += textLength(item);
    return total;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    let total = 0;
    // Known text-bearing fields across provider content-block shapes.
    for (const key of ['content', 'text', 'thinking', 'input', 'arguments', 'output']) {
      if (key in obj) total += textLength(obj[key]);
    }
    if (total === 0) {
      try {
        return JSON.stringify(obj).length;
      } catch {
        return 0;
      }
    }
    return total;
  }
  return 0;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never keep the process alive just for a retry backoff.
    if (typeof timer.unref === 'function') timer.unref();
  });
}

export function describeError(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    const type = status ? `${error.name}(${status})` : error.name;
    return { type, message: error.message };
  }
  return { type: 'UnknownError', message: String(error) };
}
