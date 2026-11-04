import { getDb } from './db';
import { familyCharsPerToken, guessFamily, guessProvider } from './catalogue';

export interface ModelPrice {
  model: string;
  provider: string;
  displayName: string;
  family: string;
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  contextWindow: number | null;
  maxOutput: number | null;
  verified: boolean;
  source: string;
  active: boolean;
  updatedAt: number;
}

interface PriceRow {
  model: string;
  provider: string;
  display_name: string;
  family: string;
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
  context_window: number | null;
  max_output: number | null;
  verified: number;
  source: string;
  active: number;
  updated_at: number;
}

function toPrice(row: PriceRow): ModelPrice {
  return {
    model: row.model,
    provider: row.provider,
    displayName: row.display_name,
    family: row.family,
    inputPerMTok: row.input_per_mtok,
    outputPerMTok: row.output_per_mtok,
    cacheReadPerMTok: row.cache_read_per_mtok,
    cacheWritePerMTok: row.cache_write_per_mtok,
    contextWindow: row.context_window,
    maxOutput: row.max_output,
    verified: row.verified === 1,
    source: row.source,
    active: row.active === 1,
    updatedAt: row.updated_at,
  };
}

export function listPrices(): ModelPrice[] {
  const rows = getDb()
    .prepare<[], PriceRow>('SELECT * FROM model_prices ORDER BY provider, model')
    .all();
  return rows.map(toPrice);
}

export function priceMap(): Map<string, ModelPrice> {
  return new Map(listPrices().map((price) => [price.model, price]));
}

export function getPrice(model: string): ModelPrice | null {
  const row = getDb()
    .prepare<[string], PriceRow>('SELECT * FROM model_prices WHERE model = ?')
    .get(model);
  return row ? toPrice(row) : null;
}

/**
 * Make sure every model we have seen exists in the price table.
 *
 * A model nobody has priced is inserted with NULL rates rather than zero, so
 * it shows up as "unpriced" in the dashboard instead of quietly contributing
 * $0.00 to the bill.
 */
export function ensureModelRegistered(model: string, provider?: string | null): ModelPrice {
  const existing = getPrice(model);
  if (existing) return existing;

  const resolvedProvider = provider && provider !== 'unknown' ? provider : guessProvider(model);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO model_prices
         (model, provider, display_name, family, input_per_mtok, output_per_mtok,
          cache_read_per_mtok, cache_write_per_mtok, context_window, max_output,
          verified, source, active, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, 1, ?)`,
    )
    .run(
      model,
      resolvedProvider,
      model,
      guessFamily(model, resolvedProvider),
      'Auto-registered on first use — no price configured yet.',
      now,
    );

  return getPrice(model) ?? {
    model,
    provider: resolvedProvider,
    displayName: model,
    family: guessFamily(model, resolvedProvider),
    inputPerMTok: null,
    outputPerMTok: null,
    cacheReadPerMTok: null,
    cacheWritePerMTok: null,
    contextWindow: null,
    maxOutput: null,
    verified: false,
    source: '',
    active: true,
    updatedAt: now,
  };
}

export interface UsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cache: number;
  total: number;
  /** False when the model has no configured rate — total is 0 but unknown, not free. */
  priced: boolean;
}

const UNPRICED: CostBreakdown = { input: 0, output: 0, cache: 0, total: 0, priced: false };

export function computeCost(price: ModelPrice | null, usage: UsageCounts): CostBreakdown {
  if (!price || price.inputPerMTok === null || price.outputPerMTok === null) return UNPRICED;

  const input = (usage.inputTokens / 1_000_000) * price.inputPerMTok;
  const output = (usage.outputTokens / 1_000_000) * price.outputPerMTok;

  // A provider without a published cache rate is charged at the base input
  // rate rather than skipped — understating cache cost is the worse error.
  const cacheReadRate = price.cacheReadPerMTok ?? price.inputPerMTok;
  const cacheWriteRate = price.cacheWritePerMTok ?? price.inputPerMTok;
  const cache =
    (usage.cacheReadTokens / 1_000_000) * cacheReadRate +
    (usage.cacheWriteTokens / 1_000_000) * cacheWriteRate;

  return { input, output, cache, total: input + output + cache, priced: true };
}

/** Fallback characters-per-token for a model, from its tokenizer family. */
export function fallbackCharsPerToken(price: ModelPrice | null): number {
  return familyCharsPerToken(price?.family);
}

export function formatUsd(value: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(value)) return '—';
  const digits = Math.abs(value) >= 1 ? 2 : maxFractionDigits;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString('en-US');
}
