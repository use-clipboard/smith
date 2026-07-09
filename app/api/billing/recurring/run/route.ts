import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { isAuthorisedCron } from '@/lib/cronAuth';
import { generateDueRecurringInvoices } from '@/lib/billing/recurrence';

// GET /api/billing/recurring/run
// Vercel Cron (GET + Authorization: Bearer <CRON_SECRET>). Mints invoices for
// every recurring schedule that is due today, across all firms. Service-role
// client — the cron has no user session and RLS would hide every row.
export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const supabase = createServiceClient();
  try {
    const result = await generateDueRecurringInvoices(supabase);
    return NextResponse.json(result);
  } catch (err) {
    console.error('billing/recurring/run', err);
    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
