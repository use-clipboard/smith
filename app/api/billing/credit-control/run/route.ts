import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { isAuthorisedCron } from '@/lib/cronAuth';
import { runCreditControlChase } from '@/lib/billing/creditControl';

// GET /api/billing/credit-control/run
// Vercel Cron (GET + Authorization: Bearer <CRON_SECRET>). Fires due reminder
// stages across every firm with auto-chase enabled. Service-role client.
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const supabase = createServiceClient();
  try {
    const result = await runCreditControlChase(supabase);
    return NextResponse.json(result);
  } catch (err) {
    console.error('billing/credit-control/run', err);
    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
