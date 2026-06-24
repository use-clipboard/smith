import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { getHmrcConnection } from '@/lib/hmrc/api';
import { HMRC_ENV, isHmrcConfigured } from '@/lib/hmrc/config';

// ── GET /api/hmrc/vat-test/status ────────────────────────────────────────────
// Admin sandbox harness — reports whether a VAT HMRC connection exists for the
// firm (any kind) so the tester knows if it can call obligations/submit.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const supa = createServiceClient();
  const conn = await getHmrcConnection(supa, 'vat', ctx.firmId, {});
  return NextResponse.json({
    env: HMRC_ENV,
    configured: isHmrcConfigured(),
    connected: !!conn,
    kind: conn?.kind ?? null,
    vrn: conn?.vrn ?? null,
  });
}
