import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * POST /api/presence/ping
 * Records that the signed-in user is currently using the app, so their profile
 * can show an accurate "last seen" when they're offline. Called on a heartbeat
 * by PresenceHeartbeat. Best-effort: a missing column (pre-migration) is a
 * silent no-op.
 */
export async function POST() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });

  const svc = createServiceClient();
  await svc.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', ctx.userId);
  return NextResponse.json({ ok: true });
}
