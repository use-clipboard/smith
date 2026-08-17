import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { getApprovalMode } from '@/lib/timesheets/approvalMode';

// GET /api/timesheets/approvals-count
// Number of submitted weeks awaiting THIS user's approval — drives the
// Timesheets sidebar badge. Respects the firm's approval mode:
//   'manager' — weeks routed to this user as the submitter's manager.
//   'admins'  — every submitted week in the firm (only for admins).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ count: 0 });
  if (!ctx.activeModules.includes('timesheets')) return NextResponse.json({ count: 0 });

  const service = createServiceClient();
  try {
    const mode = await getApprovalMode(service, ctx.firmId);

    let q = service
      .from('timesheet_week_status')
      .select('user_id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firmId)
      .eq('status', 'submitted');

    if (mode === 'admins') {
      // Any admin approves anyone → count every submitted week. Non-admins have
      // nothing to approve in this mode.
      if (ctx.userRole !== 'admin') return NextResponse.json({ count: 0 });
    } else {
      // Manager mode → only weeks routed to me.
      q = q.eq('manager_id', ctx.userId);
    }

    const { count } = await q;
    return NextResponse.json({ count: count ?? 0 });
  } catch {
    // Table/column missing pre-migration → badge just hides.
    return NextResponse.json({ count: 0 });
  }
}
