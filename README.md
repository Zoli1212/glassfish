# Glassfish Zero

Self-hosted LLM observability: tracing, monitoring, cost accounting, and an
honest answer to *"what would this cost on a different model?"*

Two pieces:

| Package | What it is |
|---|---|
| [`packages/sdk`](packages/sdk) → npm `glassfish-zero` | Zero-dependency SDK. Wrap your Anthropic or OpenAI client, get spans. |
| [`apps/web`](apps/web) | Next.js dashboard + ingest API. SQLite-backed, no native modules. |

---

## Run it

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Then register an account, create a project, and copy the API key it shows you.
Point your application at it:

```bash
GLASSFISH_API_KEY=gfz_live_…
GLASSFISH_BASE_URL=http://localhost:3000
```

```ts
import Anthropic from '@anthropic-ai/sdk';
import { Glassfish } from 'glassfish-zero';

const gf = new Glassfish();                    // reads the two env vars
const anthropic = gf.observe(new Anthropic()); // same types, same behaviour

await gf.trace('support-reply', async (t) => {
  t.setUser('user_8812').tag('plan', 'pro');
  await anthropic.messages.create({ model: 'claude-opus-5', max_tokens: 1024, messages: [...] });
});
```

To see the dashboard populated before wiring up a real app, push a synthetic
workload through the real ingest endpoint:

```bash
npm run seed --workspace=@glassfish-zero/web -- --key gfz_live_… --url http://localhost:3000
```

For development, `npm run dev` instead of `build` + `start`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GLASSFISH_DB` | `apps/web/data/glassfish.db` | SQLite file path |
| `GLASSFISH_PUBLIC_URL` | `http://localhost:3000` | Origin shown in the settings snippet |
| `GLASSFISH_ALLOW_SIGNUP` | unset | `1` re-opens registration (see below) |
| `PORT` | `3000` | Server port |

Requires Node 23.4 or newer — the database runs on the built-in `node:sqlite`,
so there is no native module to compile and no database server to operate.
(Node 22.5–23.3 works too, but needs `--experimental-sqlite`.)

**Registration closes itself.** Accounts can be created only while the
instance has zero users. You register first and become the owner; the form
then shuts, so a public URL cannot be claimed by a stranger. Set
`GLASSFISH_ALLOW_SIGNUP=1` to deliberately re-open it.

---

## Deploying it

One container, one volume — see **[DEPLOY.md](DEPLOY.md)** for Fly.io, Render
and Railway, with configs in the repository ([`fly.toml`](fly.toml),
[`render.yaml`](render.yaml), [`railway.json`](railway.json)).

```bash
docker build -t glassfish-zero .
docker run -p 3000:3000 -v glassfish-data:/data glassfish-zero
```

**Run exactly one instance.** A volume attaches to a single machine, so a
second replica would boot with its own empty database. Every shipped config
pins the count to 1. Vercel and other serverless targets do not work for the
same reason — no persistent disk.

---

## What it records

Per span: model, provider, input / output / cache-read / cache-write /
reasoning tokens, prompt and completion **character counts**, latency,
time-to-first-token, status, error type and message, user, session, tags,
environment and release. Spans roll up into traces that follow your own
request boundaries.

Cost is computed **server-side** from an editable price table, never by the
SDK. That means correcting a rate and re-pricing fixes history, not just new
traffic — and a model nobody has priced shows up as **unpriced** rather than
contributing a confident-looking $0.00.

---

## The model-swap projection

Swapping a model changes two things at once: the price per token, and how
many tokens the same text becomes. Re-pricing recorded token counts answers
the wrong question — Anthropic's Opus 4.7-era tokenizer alone produces
roughly 1.0–1.35× the tokens of its predecessor for identical text, and
Claude Sonnet 5 measures about 30% denser than Sonnet 4.6.

So the projection converts through characters, which are model-independent:

```
projected_tokens(target) = recorded_chars / chars_per_token(target)
```

`chars_per_token` is **measured from your own traffic** whenever a model has
at least 20 spans on this project, and falls back to a tokenizer-family
constant otherwise. Every row says which basis it used. Spans that failed
before the provider reported usage are excluded from the measurement — their
characters would otherwise inflate the ratio and skew every projection built
on it.

The observed cache-hit share is preserved (swapping a model changes how text
tokenises, not how repetitive the traffic is), and the assumption about
answer length is an explicit control rather than a hidden constant.

**What it cannot tell you:** whether the other model is good enough. It
projects tokens and cost, not quality, refusal rate, or how a different
reasoning budget changes output volume. Route a slice of real traffic to the
candidate; once it has 20 spans, its column stops being an estimate.

---

## Pricing data

Anthropic rates ship **verified**, from a published catalogue snapshot dated
2026-06-24. Rates for other providers ship as **unverified placeholders** —
community-reported figures that have not been confirmed against the
provider's own pricing page. The dashboard flags them wherever they
contribute to a cost figure; confirm them on the Prices tab and tick the
confirmation box.

A model seen for the first time is auto-registered with empty rates, so a new
model in production surfaces as a visible gap on the next dashboard load.

---

## Layout

```
packages/sdk/        glassfish-zero — the npm package
apps/web/
  src/app/           pages, server actions, /api/v1/ingest
  src/lib/           db, pricing, ingest, queries, swap engine, auth
  src/components/    charts, tables, forms
  scripts/seed.mjs   synthetic workload generator
```

MIT licensed.
"# glassfish" 
