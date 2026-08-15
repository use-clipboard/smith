import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

// GET /api/timesheets/approvals-count
// Number of submitted weeks awaiting THIS user's approval — drives the
// Timesheets sidebar badge. Only weeks routed to this user as the submitter's
// manager count; there is no admin fallback (a week with no manager is
// auto-approved, so it never awaits anyone).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ count: 0 });
  if (!ctx.activeModules.includes('timesheets')) return NextResponse.json({ count: 0 });

  const service = createServiceClient();
  try {
    const { count: mine } = await service
      .from('timesheet_week_status')
      .select('user_id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firmId)
      .eq('status', 'submitted')
      .eq('manager_id', ctx.userId);

    return NextResponse.json({ count: mine ?? 0 });
  } catch {
    // Table/column missing pre-migration → badge just hides.
    return NextResponse.json({ count: 0 });
  }
}
