// Billing module — the scheduled statement run (cron, daily).
//
// Fires every morning; each firm's own frequency/day decides whether it's their
// day. Statements go out with the table + portal link (no PDF — there's no
// browser here to render one).

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { isAuthorisedCron } from '@/lib/cronAuth';
import { runStatements } from '@/lib/billing/statementRun';

export async function GET(req: Request) {
  if (!isAuthorisedCron(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createServiceClient();
  try {
    const result = await runStatements(supabase);
    return NextResponse.json(result);
  } catch (err) {
    console.error('billing/statements/run', err);
    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
