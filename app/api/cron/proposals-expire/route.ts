import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Daily cron: flip any sent/viewed proposal whose expires_at has passed to 'expired'.
function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const service = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await service
    .from('proposals')
    .update({ status: 'expired', updated_at: nowIso })
    .in('status', ['sent', 'viewed'])
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)
    .select('id');
  if (error) {
    console.error('[proposals-expire]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, expired: data?.length ?? 0 });
}
