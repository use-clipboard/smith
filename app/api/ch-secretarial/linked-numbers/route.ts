import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getLinkedCompanyNumbers } from '@/lib/chLinkedNumbers';

// GET /api/ch-secretarial/linked-numbers
// Company numbers with an active CH-deadline task link for this firm. The manual
// refresh unions these into whatever list it's about to fetch, so a company a
// task depends on is never dropped from the cache (matching the cron's safety net).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const service = createServiceClient();
  const numbers = await getLinkedCompanyNumbers(service, ctx.firmId);
  return NextResponse.json({ numbers });
}
