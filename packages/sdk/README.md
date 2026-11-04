# glassfish-zero

Zero-dependency LLM observability SDK. Wrap your provider client, get traces,
token accounting, cost and model-swap analysis in your own Glassfish Zero
dashboard.

```bash
npm install glassfish-zero
```

## Quick start

```ts
import Anthropic from '@anthropic-ai/sdk';
import { Glassfish } from 'glassfish-zero';

const gf = new Glassfish({
  apiKey: process.env.GLASSFISH_API_KEY,   // gfz_live_...
  baseUrl: process.env.GLASSFISH_BASE_URL, // https://observability.example.com
});

const anthropic = gf.observe(new Anthropic());

await gf.trace('support-reply', async (t) => {
  t.setUser('user_8812').tag('plan', 'pro');

  // Recorded automatically: model, tokens, cache tokens, latency, cost, errors.
  await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Summarise this ticket…' }],
  });
});

await gf.flush();
```

`observe()` detects Anthropic and OpenAI clients. It returns a proxy — same
types, same behaviour, nothing to change at the call sites.

## What gets recorded

| Field | Source |
|---|---|
| model, provider | request / response |
| input, output, cache-read, cache-write, reasoning tokens | provider `usage` |
| **input and output characters** | prompt and completion text |
| latency, time-to-first-token | measured |
| status, error type and message | thrown errors and HTTP failures |
| trace / span / parent-span | ambient trace context |
| user, session, tags, environment, release | your code |

Character counts are what make the model-swap comparison honest. Tokens are
model-specific; characters are not. The server derives a measured
tokens-per-character ratio per model from your own traffic and uses it to
project what the same workload would have cost on a different model — instead
of multiplying by a guessed constant.

Cost is computed server-side from the price table, so correcting a price
re-prices history instead of only affecting new traffic.

## Streaming

Streaming works unchanged, including `messages.stream()` and
`stream: true`. The SDK tees the stream: your consumer gets every chunk in
order, and usage plus time-to-first-token are accumulated alongside.

```ts
const stream = anthropic.messages.stream({ model: 'claude-opus-5', /* … */ });
for await (const event of stream) { /* … */ }
```

For OpenAI chat streaming, pass `stream_options: { include_usage: true }` —
otherwise the provider never sends token counts and only characters are
recorded.

## Manual spans

```ts
await gf.trace('rag-answer', async (t) => {
  const docs = await t.span('retrieve', () => vectorStore.query(q), { kind: 'retrieval' });
  await anthropic.messages.create({ /* … */ });
});
```

For a provider the SDK does not wrap, record it yourself:

```ts
gf.record({
  name: 'mistral.chat',
  kind: 'llm',
  provider: 'mistral',
  model: 'mistral-large-latest',
  usage: { inputTokens: 1_200, outputTokens: 310 },
  chars: { input: 4_600, output: 1_180 },
  startedAt, endedAt,
});
```

## Configuration

| Option | Env var | Default |
|---|---|---|
| `apiKey` | `GLASSFISH_API_KEY` | — (required) |
| `baseUrl` | `GLASSFISH_BASE_URL` | `http://localhost:3000` |
| `environment` | `NODE_ENV` | `development` |
| `release` | `GLASSFISH_RELEASE` | — |
| `disabled` | `GLASSFISH_DISABLED=1` | `false` |
| `capturePayloads` | — | `false` |
| `payloadMaxChars` | — | `2000` |
| `batchSize` | — | `25` |
| `flushIntervalMs` | — | `5000` |
| `maxQueueSize` | — | `10000` |
| `timeoutMs` | — | `10000` |
| `maxRetries` | — | `3` |

`capturePayloads` sends truncated prompt and completion text to your
collector. It is off by default — turn it on deliberately.

## Operational guarantees

- **Never throws into your code.** Transport failures go to `onError`; a
  broken collector cannot take down the app it observes.
- **Never blocks.** Spans are queued and flushed in the background.
- **Bounded memory.** Past `maxQueueSize` spans are dropped and counted —
  read `gf.dropped` to detect under-reporting rather than discovering it in a
  silently short bill.
- **No missing key, no silent no-op.** Starting without an API key logs a
  warning rather than pretending to trace.

Call `await gf.shutdown()` before a short-lived process exits, so the last
batch is not lost.

## Serverless

In short-lived environments (Lambda, Vercel functions), flush at the end of
each invocation:

```ts
try {
  return await handler(event);
} finally {
  await gf.flush();
}
```

MIT licensed.
