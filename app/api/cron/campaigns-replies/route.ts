import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { runCampaignReplyScan } from '@/lib/campaigns/replies';

// ─── /api/cron/campaigns-replies ───────────────────────────────────────────
// Detects replies to recent campaigns and links each reply thread to the client
// in Email Triage (timeline + allocation). Runs hourly.

export const maxDuration = 300;

function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[campaigns-replies] CRON_SECRET not set — allowing request.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  try {
    const result = await runCampaignReplyScan(service);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[campaigns-replies]', err);
    return NextResponse.json({ error: 'Reply scan failed' }, { status: 500 });
  }
}
