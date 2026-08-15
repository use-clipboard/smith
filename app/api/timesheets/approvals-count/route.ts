import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

// GET /api/timesheets/approvals-count
// Number of submitted weeks awaiting THIS user's approval — drives the
// Timesheets sidebar badge. A manager sees their reports' submitted weeks;
// admins also pick up any submitted week with no manager set (the fallback
// approver, matching the submit-notify logic).
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

    let unmanaged = 0;
    if (ctx.userRole === 'admin') {
      const { count } = await service
        .from('timesheet_week_status')
        .select('user_id', { count: 'exact', head: true })
        .eq('firm_id', ctx.firmId)
        .eq('status', 'submitted')
        .is('manager_id', null);
      unmanaged = count ?? 0;
    }

    return NextResponse.json({ count: (mine ?? 0) + unmanaged });
  } catch {
    // Table/column missing pre-migration → badge just hides.
    return NextResponse.json({ count: 0 });
  }
}
