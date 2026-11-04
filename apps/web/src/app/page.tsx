import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { CopyBlock } from '@/components/CopyField';
import { ThemeToggle } from '@/components/ThemeToggle';

const QUICKSTART = `npm install glassfish-zero

import Anthropic from '@anthropic-ai/sdk';
import { Glassfish } from 'glassfish-zero';

const gf = new Glassfish({
  apiKey: process.env.GLASSFISH_API_KEY,   // gfz_live_…
  baseUrl: process.env.GLASSFISH_BASE_URL, // this dashboard
});

const anthropic = gf.observe(new Anthropic());

await gf.trace('support-reply', async (t) => {
  t.setUser('user_8812').tag('plan', 'pro');

  await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Summarise this ticket…' }],
  });
});`;

const CAPABILITIES = [
  {
    title: 'Tracing',
    body: 'Every provider call becomes a span with latency, time-to-first-token, status and error detail, grouped into traces that follow your own request boundaries.',
  },
  {
    title: 'Token accounting',
    body: 'Input, output, cache-read, cache-write and reasoning tokens are recorded separately — because they are billed separately.',
  },
  {
    title: 'Cost',
    body: 'Computed server-side from an editable price table, so correcting a rate re-prices history instead of only affecting new traffic.',
  },
  {
    title: 'Model-swap analysis',
    body: 'Projects what the same workload would have cost on another model, converting through characters and a tokens-per-character ratio measured on your own traffic.',
  },
];

export default async function LandingPage() {
  if (await currentUser()) redirect('/dashboard');

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-14 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-6 w-6 rounded-[7px]"
            style={{ background: 'var(--series-3)' }}
          />
          <span className="text-lg font-semibold">Glassfish Zero</span>
        </div>
        <nav className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link href="/register" className="btn btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <section className="mb-16 max-w-2xl">
        <h1 className="m-0 text-4xl font-semibold leading-tight tracking-tight">
          LLM observability you host yourself.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-2">
          Install one npm package, register your app, and get traces, token accounting, cost and
          an honest answer to <em>&ldquo;what would this cost on a different model?&rdquo;</em>
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/register" className="btn btn-primary">
            Create a project
          </Link>
          <Link href="/login" className="btn btn-ghost">
            I already have an account
          </Link>
        </div>
      </section>

      <section className="mb-16">
        <h2 className="m-0 mb-4 text-base font-semibold">Two minutes to first trace</h2>
        <CopyBlock code={QUICKSTART} />
        <p className="mt-3 text-sm text-ink-2">
          <code className="font-mono text-[0.85em]">observe()</code> detects Anthropic and OpenAI
          clients and returns a proxy — same types, same behaviour, nothing to change at the call
          sites. Streaming is teed, so your consumer still receives every chunk in order.
        </p>
      </section>

      <section className="mb-16 grid gap-4 sm:grid-cols-2">
        {CAPABILITIES.map((item) => (
          <article key={item.title} className="card p-5">
            <h3 className="m-0 text-sm font-semibold">{item.title}</h3>
            <p className="m-0 mt-2 text-sm leading-relaxed text-ink-2">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="card p-6">
        <h2 className="m-0 text-base font-semibold">Why the model-swap number is trustworthy</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Swapping a model changes two things at once: the price per token, and how many tokens
          the same text becomes. Applying a new price to old token counts answers the wrong
          question — Anthropic&apos;s Opus 4.7-era tokenizer alone produces roughly 1.0–1.35&times;
          the tokens of its predecessor for identical text.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Glassfish Zero records the <strong>character count</strong> of every prompt and
          completion alongside the provider&apos;s token counts. Characters are
          model-independent, so a tokens-per-character ratio can be measured per model from your
          own traffic and used to re-derive token counts for a candidate model. Where there is
          not enough traffic to measure, the projection falls back to a tokenizer-family constant
          and says so, every time.
        </p>
      </section>

      <footer className="mt-14 border-t border-hairline pt-6 text-sm text-ink-muted">
        Glassfish Zero · self-hosted · SQLite-backed · MIT licensed
      </footer>
    </main>
  );
}
