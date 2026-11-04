#!/usr/bin/env node
/**
 * Push a synthetic but internally-consistent workload at a running
 * Glassfish Zero instance.
 *
 * It posts to the real /api/v1/ingest endpoint rather than writing to SQLite,
 * so a successful run proves the whole path — auth, validation, pricing,
 * trace rollup — not just that rows can be inserted.
 *
 *   node scripts/seed.mjs --key gfz_live_xxx [--url http://localhost:3000] [--days 14]
 */

const args = parseArgs(process.argv.slice(2));
const apiKey = args.key ?? process.env.GLASSFISH_API_KEY;
const baseUrl = (args.url ?? process.env.GLASSFISH_BASE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const days = Number(args.days ?? 14);
const traceCount = Number(args.traces ?? 260);

if (!apiKey) {
  console.error(`
Missing API key.

  1. Start the app:            npm run dev
  2. Register and create a project in the browser
  3. Copy the API key it shows you, then:

     node scripts/seed.mjs --key gfz_live_xxx
`);
  process.exit(1);
}

/**
 * Characters per token per model, chosen to match the real tokenizer
 * families so the model-swap simulator has something true to measure:
 * the Opus 4.7-era Anthropic tokenizer is denser than its predecessor.
 */
const MODELS = [
  { model: 'claude-opus-5', provider: 'anthropic', charsPerToken: 3.05, weight: 42, latency: 4200 },
  { model: 'claude-sonnet-5', provider: 'anthropic', charsPerToken: 3.1, weight: 28, latency: 2400 },
  { model: 'claude-haiku-4-5', provider: 'anthropic', charsPerToken: 3.85, weight: 20, latency: 900 },
  { model: 'gpt-4o', provider: 'openai', charsPerToken: 4.0, weight: 10, latency: 2100 },
];

const TRACES = [
  {
    name: 'support-reply',
    weight: 45,
    promptChars: [2_400, 9_000],
    outputChars: [400, 1_800],
    steps: ['retrieve-ticket', 'llm'],
  },
  {
    name: 'doc-summary',
    weight: 30,
    promptChars: [12_000, 48_000],
    outputChars: [900, 3_200],
    steps: ['load-document', 'llm'],
  },
  {
    name: 'rag-answer',
    weight: 25,
    promptChars: [5_000, 18_000],
    outputChars: [600, 2_400],
    steps: ['embed-query', 'vector-search', 'llm', 'llm'],
  },
];

const USERS = ['user_8812', 'user_1043', 'user_7729', 'user_3356', 'user_9001', 'user_2284'];
const PLANS = ['free', 'pro', 'enterprise'];

const ERRORS = [
  { type: 'RateLimitError(429)', message: 'rate_limit_error: requests per minute exceeded' },
  { type: 'APIConnectionError', message: 'socket hang up while streaming the response' },
  { type: 'BadRequestError(400)', message: 'max_tokens: must be less than the model output cap' },
];

let seed = 20261103;
/** Deterministic PRNG so repeated runs produce a comparable dataset. */
function rng() {
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return seed / 4_294_967_296;
}

function between(min, max) {
  return min + rng() * (max - min);
}

function pick(items) {
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight ?? 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function pickOne(list) {
  return list[Math.floor(rng() * list.length)];
}

function id(prefix) {
  return `${prefix}_${Math.floor(rng() * 1e9).toString(36)}${Math.floor(rng() * 1e9).toString(36)}`;
}

function buildSpans() {
  const spans = [];
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;

  for (let i = 0; i < traceCount; i += 1) {
    const shape = pick(TRACES);
    const traceId = id('tr');
    const userRef = pickOne(USERS);
    const sessionRef = id('ses');
    const tags = { plan: pickOne(PLANS), surface: rng() > 0.5 ? 'web' : 'api' };

    // Weight recent traffic more heavily, the way a growing product looks.
    const age = windowMs * rng() ** 1.6;
    let cursor = now - age;
    const traceStart = cursor;

    for (const step of shape.steps) {
      if (step === 'llm') {
        const spec = pick(MODELS);
        const promptChars = Math.round(between(shape.promptChars[0], shape.promptChars[1]));
        const outputChars = Math.round(between(shape.outputChars[0], shape.outputChars[1]));

        const promptTokens = Math.round(promptChars / spec.charsPerToken);
        const outputTokens = Math.round(outputChars / spec.charsPerToken);

        // Repeated system prompts and documents cache well; model it as a
        // share of the prompt rather than an all-or-nothing flag.
        const cacheShare = rng() < 0.55 ? between(0.3, 0.85) : 0;
        const cacheReadTokens = Math.round(promptTokens * cacheShare);
        const cacheWriteTokens = cacheShare > 0 && rng() < 0.2 ? Math.round(promptTokens * 0.2) : 0;
        const freshInput = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);

        const failed = rng() < 0.035;
        const streamed = rng() < 0.6;
        const duration = Math.round(
          spec.latency * between(0.45, 2.1) * (1 + outputTokens / 1500),
        );
        const startedAt = Math.round(cursor);
        const endedAt = startedAt + (failed ? Math.round(duration * 0.3) : duration);

        const span = {
          traceId,
          spanId: id('sp'),
          traceName: shape.name,
          name: spec.provider === 'anthropic' ? 'messages.create' : 'chat.completions.create',
          kind: 'llm',
          provider: spec.provider,
          model: spec.model,
          status: failed ? 'error' : 'ok',
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          stream: streamed,
          userRef,
          sessionRef,
          tags,
          environment: 'production',
          release: '2026.11.1',
          metadata: { maxTokens: 4096, thinking: 'adaptive', effort: 'high' },
        };

        if (failed) {
          const error = pickOne(ERRORS);
          span.errorType = error.type;
          span.errorMessage = error.message;
          span.chars = { input: promptChars, output: 0 };
        } else {
          span.usage = {
            inputTokens: freshInput,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            reasoningTokens: spec.model.startsWith('claude-opus')
              ? Math.round(outputTokens * between(0.1, 0.5))
              : 0,
          };
          span.chars = { input: promptChars, output: outputChars };
          if (streamed) span.ttftMs = Math.round(duration * between(0.08, 0.3));
        }

        spans.push(span);
        cursor = endedAt + between(5, 60);
      } else {
        const duration = Math.round(between(12, 340));
        const startedAt = Math.round(cursor);
        spans.push({
          traceId,
          spanId: id('sp'),
          traceName: shape.name,
          name: step,
          kind: step.includes('search') || step.includes('retrieve') ? 'retrieval' : 'tool',
          status: 'ok',
          startedAt,
          endedAt: startedAt + duration,
          durationMs: duration,
          userRef,
          sessionRef,
          tags,
          environment: 'production',
          release: '2026.11.1',
        });
        cursor = startedAt + duration + between(2, 25);
      }
    }

    // The chain span the SDK emits when a trace closes.
    spans.push({
      traceId,
      spanId: id('sp'),
      traceName: shape.name,
      name: shape.name,
      kind: 'chain',
      status: 'ok',
      startedAt: Math.round(traceStart),
      endedAt: Math.round(cursor),
      durationMs: Math.round(cursor - traceStart),
      userRef,
      sessionRef,
      tags,
      environment: 'production',
      release: '2026.11.1',
    });
  }

  return spans;
}

async function main() {
  const spans = buildSpans();
  console.log(
    `Generated ${spans.length} span(s) across ${traceCount} traces over ${days} day(s).`,
  );

  let accepted = 0;
  let rejected = 0;
  const warnings = new Set();

  for (let i = 0; i < spans.length; i += 200) {
    const batch = spans.slice(i, i + 200);
    const response = await fetch(`${baseUrl}/api/v1/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ sdk: { name: 'glassfish-zero-seed', version: '0.1.0' }, spans: batch }),
    });

    if (!response.ok && response.status !== 207) {
      console.error(`\nIngest failed: HTTP ${response.status}`);
      console.error(await response.text());
      process.exit(1);
    }

    const body = await response.json();
    accepted += body.accepted ?? 0;
    rejected += body.rejected?.length ?? 0;
    for (const warning of body.warnings ?? []) warnings.add(warning.message);
    process.stdout.write(`\rSent ${Math.min(i + 200, spans.length)}/${spans.length}…`);
  }

  console.log(`\n\nAccepted ${accepted} span(s); ${rejected} rejected.`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log(`\nOpen ${baseUrl} to see it.`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

main().catch((error) => {
  console.error('\nSeeding failed:', error.message);
  process.exit(1);
});
