import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { SDK_WIRE_VERSION } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const row = getDb()
      .prepare<[], { models: number }>('SELECT COUNT(*) AS models FROM model_prices')
      .get();
    return NextResponse.json({
      status: 'ok',
      wireVersion: SDK_WIRE_VERSION,
      pricedModels: row?.models ?? 0,
      time: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'database unavailable';
    return NextResponse.json({ status: 'error', message }, { status: 503 });
  }
}
