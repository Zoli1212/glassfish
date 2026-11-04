import { requireProject } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listPrices } from '@/lib/pricing';
import { Card, Notice, PageHeader } from '@/components/ui';
import { PriceTable, type PriceUsage } from '@/components/PriceTable';

export const dynamic = 'force-dynamic';

export default async function PricesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { project } = await requireProject(slug);

  const prices = listPrices();
  const families = getDb()
    .prepare<[], { id: string; label: string }>(
      'SELECT id, label FROM tokenizer_families ORDER BY label',
    )
    .all();

  const usage = getDb()
    .prepare<[string], PriceUsage>(
      `SELECT model, COUNT(*) AS calls,
              COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens
         FROM spans WHERE project_id = ? AND model IS NOT NULL GROUP BY model`,
    )
    .all(project.id);

  const usedModels = new Set(usage.map((u) => u.model));
  const unpricedInUse = prices.filter(
    (p) => usedModels.has(p.model) && (p.inputPerMTok === null || p.outputPerMTok === null),
  );
  const unverifiedInUse = prices.filter(
    (p) => usedModels.has(p.model) && !p.verified && p.inputPerMTok !== null,
  );

  return (
    <>
      <PageHeader
        title="Prices"
        description="Cost is computed from this table, not from the SDK. Correcting a rate here and re-pricing fixes history as well as new traffic."
      />

      {unpricedInUse.length > 0 ? (
        <div className="mb-5">
          <Notice
            tone="critical"
            title={`${unpricedInUse.length} model(s) in use have no rate — their spend reads as $0.`}
          >
            {unpricedInUse.map((p) => p.model).join(' · ')}
          </Notice>
        </div>
      ) : null}

      {unverifiedInUse.length > 0 ? (
        <div className="mb-5">
          <Notice
            tone="warning"
            title={`${unverifiedInUse.length} model(s) in use are priced from unverified placeholders.`}
          >
            Anthropic rates ship verified from a published catalogue snapshot. Other providers are
            seeded with community-reported figures that have not been confirmed — open each,
            check it against the provider&apos;s pricing page, and tick the confirmation box.
          </Notice>
        </div>
      ) : null}

      <Card className="p-5">
        <PriceTable slug={slug} prices={prices} families={families} usage={usage} />
      </Card>

      <Card title="Why prices live here" className="mt-5">
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-2">
          <p className="m-0">
            The SDK sends token counts, never money. Pricing a span server-side means a rate
            correction can be applied retroactively, and that a model nobody has priced yet shows
            up as <strong>unpriced</strong> rather than silently contributing $0.00 to a chart
            that looks complete.
          </p>
          <p className="m-0">
            A model seen for the first time is auto-registered here with empty rates, so a new
            model in production surfaces as a visible gap on the next dashboard load instead of a
            quietly understated bill.
          </p>
        </div>
      </Card>
    </>
  );
}
