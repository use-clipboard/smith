import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/hr/badge-counts
// Returns notification + actionable-item counts that drive the HR sidebar
// badge and the HR sub-tab badges.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();

  // Unread HR notifications grouped by type
  const { data: notifs } = await supabase
    .from('notifications')
    .select('type')
    .eq('user_id', ctx.userId)
    .eq('read', false)
    .like('type', 'hr_%');
  const byType = new Map<string, number>();
  for (const n of notifs ?? []) {
    byType.set(n.type as string, (byType.get(n.type as string) ?? 0) + 1);
  }

  // Pending approvals for managers / admins — RLS lets a manager see their team's pendings.
  const { count: pendingApprovals } = await supabase
    .from('hr_holiday_requests')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', ctx.firmId)
    .eq('status', 'pending')
    .eq('manager_id', ctx.userId);

  const total = (notifs?.length ?? 0) + (pendingApprovals ?? 0);

  return NextResponse.json({
    total,
    notificationsByType: Object.fromEntries(byType),
    // Convenience aggregates for the UI
    pendingApprovals: pendingApprovals ?? 0,
    holidayDecisions: byType.get('hr_holiday_decided') ?? 0,
    holidayCancellations: byType.get('hr_holiday_cancelled') ?? 0,
    holidayRequestsReceived: byType.get('hr_holiday_requested') ?? 0,
    newBriefings: byType.get('hr_briefing_published') ?? 0,
    newDisclosures: byType.get('hr_disclosure_filed') ?? 0,
    appraisalsSubmitted: byType.get('hr_appraisal_submitted') ?? 0,
  });
}
