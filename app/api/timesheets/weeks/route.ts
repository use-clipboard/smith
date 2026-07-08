import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';

export interface WeekStatusRow {
  userId: string;
  weekStart: string;
  status: 'submitted' | 'approved' | 'rejected';
  note: string | null;
  reviewedBy: string | null;
  managerId: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapRow = (r: any): WeekStatusRow => ({
  userId: r.user_id, weekStart: r.week_start, status: r.status, note: r.note ?? null,
  reviewedBy: r.reviewed_by ?? null, managerId: r.manager_id ?? null,
});

// The submitter's manager (users.manager_id). Graceful if the column/table
// isn't there yet → null (falls back to admin approval).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function managerOf(service: any, userId: string): Promise<string | null> {
  try {
    const { data } = await service.from('users').select('manager_id').eq('id', userId).single();
    return (data?.manager_id as string | null) ?? null;
  } catch {
    return null;
  }
}

// Notify whoever needs to approve a submitted week: the manager if set,
// otherwise all firm admins (the fallback). Best-effort — never blocks submit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyApprovers(service: any, firmId: string, submitterId: string, managerId: string | null, weekStart: string) {
  try {
    const { data: submitter } = await service.from('users').select('full_name, email').eq('id', submitterId).single();
    const name = submitter?.full_name || submitter?.email || 'A team member';

    let recipients: string[] = [];
    if (managerId && managerId !== submitterId) {
      recipients = [managerId];
    } else {
      const { data: admins } = await service.from('users').select('id').eq('firm_id', firmId).eq('role', 'admin');
      recipients = (admins ?? []).map((a: { id: string }) => a.id).filter((id: string) => id !== submitterId);
    }

    const [y, m, d] = weekStart.split('-');
    for (const rid of recipients) {
      void createNotification({
        userId: rid,
        firmId,
        type: 'timesheet_approval',
        title: `Timesheet submitted: ${name}`,
        body: `Week of ${d}-${m}-${y} is awaiting your approval.`,
        data: { link: '/timesheets' },
      });
    }
  } catch { /* non-critical */ }
}

// GET /api/timesheets/weeks → { available, weeks: WeekStatusRow[] }
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const service = createServiceClient();
  // Prefer the manager-aware select; fall back if the manager_id column isn't
  // migrated yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any = await service
    .from('timesheet_week_status')
    .select('user_id, week_start, status, note, reviewed_by, manager_id')
    .eq('firm_id', ctx.firmId)
    .order('week_start', { ascending: false });
  if (res.error && res.error.code === '42703') {
    res = await service
      .from('timesheet_week_status')
      .select('user_id, week_start, status, note, reviewed_by')
      .eq('firm_id', ctx.firmId)
      .order('week_start', { ascending: false });
  }
  const data = res.data as unknown[] | null;

  if (res.error) {
    const missing = res.error.code === '42P01' || res.error.code === 'PGRST205' || /timesheet_week_status/.test(res.error.message ?? '');
    if (missing) return NextResponse.json({ available: false, weeks: [] });
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  return NextResponse.json({ available: true, weeks: (data ?? []).map(mapRow) });
}

const PostSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 'reopen' clears the status back to draft from ANY state (incl. approved) —
  // used when a user edits an already-approved week (approval is a checkpoint).
  action: z.enum(['submit', 'withdraw', 'reopen', 'approve', 'reject']),
  userId: z.string().uuid().optional(),   // target user (admin review); defaults to self
  note: z.string().max(500).optional(),
});

// POST /api/timesheets/weeks  { weekStart, action, userId?, note? }
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { weekStart, action, note } = parsed.data;
  const targetUser = parsed.data.userId ?? ctx.userId;
  const service = createServiceClient();

  // Permission: self may submit/withdraw own weeks; the submitter's manager OR
  // an admin may review. (No manager set → only admins, the fallback.)
  const isReview = action === 'approve' || action === 'reject';
  if (isReview) {
    if (ctx.userRole !== 'admin') {
      // The manager the week was routed to (snapshot), falling back to the
      // user's current manager if the row/column predates the snapshot.
      let rowManager: string | null = null;
      const { data: existing } = await service
        .from('timesheet_week_status').select('manager_id')
        .eq('user_id', targetUser).eq('week_start', weekStart).maybeSingle();
      rowManager = (existing?.manager_id as string | null) ?? await managerOf(service, targetUser);
      if (rowManager !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (targetUser !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (action === 'withdraw') {
    // Back to draft — remove the row (only if not already approved).
    const { error } = await service
      .from('timesheet_week_status')
      .delete()
      .eq('user_id', targetUser)
      .eq('week_start', weekStart)
      .neq('status', 'approved');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: 'draft' });
  }

  if (action === 'reopen') {
    // Back to draft from ANY state, including approved — the owner edited the
    // week (or reopened it manually) so it needs approving again.
    const { error } = await service
      .from('timesheet_week_status')
      .delete()
      .eq('user_id', targetUser)
      .eq('week_start', weekStart);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: 'draft' });
  }

  if (action === 'submit') {
    const managerId = await managerOf(service, targetUser);
    const row: Record<string, unknown> = {
      firm_id: ctx.firmId, user_id: targetUser, week_start: weekStart,
      status: 'submitted', note: null, submitted_at: new Date().toISOString(),
      reviewed_by: null, reviewed_at: null, manager_id: managerId,
    };
    let { error } = await service.from('timesheet_week_status').upsert(row, { onConflict: 'user_id,week_start' });
    // Retry without manager_id if that column isn't migrated yet.
    if (error?.code === '42703') {
      delete row.manager_id;
      ({ error } = await service.from('timesheet_week_status').upsert(row, { onConflict: 'user_id,week_start' }));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Route a notification to the approver(s): the manager if set, else admins.
    void notifyApprovers(service, ctx.firmId, targetUser, managerId, weekStart);
    return NextResponse.json({ ok: true, status: 'submitted' });
  }

  // approve / reject
  const status = action === 'approve' ? 'approved' : 'rejected';
  const { error } = await service
    .from('timesheet_week_status')
    .upsert({
      firm_id: ctx.firmId, user_id: targetUser, week_start: weekStart,
      status, note: note ?? null, reviewed_by: ctx.userId, reviewed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,week_start' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
