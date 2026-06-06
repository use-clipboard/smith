import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isHmrcConfigured } from '@/lib/hmrc/config';

// ── GET /api/mtd-it/agent/status ─────────────────────────────────────────────
// Whether the firm has an MTD-IT agent connection (tokens are service-role only,
// so we just report presence + when it was connected).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { data } = await service
    .from('hmrc_connections')
    .select('id, status, updated_at, creator:users!hmrc_connections_connected_by_fkey(full_name, email)')
    .eq('firm_id', ctx.firmId).eq('service', 'mtd_it').eq('kind', 'agent')
    .maybeSingle();

  const creator = Array.isArray(data?.creator) ? data?.creator[0] : data?.creator;
  return NextResponse.json({
    configured: isHmrcConfigured(),
    connected: Boolean(data && data.status === 'connected'),
    connectedAt: data?.updated_at ?? null,
    connectedBy: creator ? (creator.full_name ?? creator.email ?? null) : null,
  });
}
