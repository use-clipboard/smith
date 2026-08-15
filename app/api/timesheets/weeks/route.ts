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

// Notify the ONE approver a submitted week is routed to: the submitter's manager.
// No manager → the week is auto-approved (see the submit action), so this is
// never called with a null manager. No admin fallback — only the manager is
// notified. Best-effort — never blocks submit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyApprovers(service: any, firmId: string, submitterId: string, managerId: string | null, weekStart: string) {
  try {
    if (!managerId || managerId === submitterId) return; // no manager → nobody to notify
    const { data: submitter } = await service.from('users').select('full_name, email').eq('id', submitterId).single();
    const name = submitter?.full_name || submitter?.email || 'A team member';

    const [y, m, d] = weekStart.split('-');
    void createNotification({
      userId: managerId,
      firmId,
      type: 'timesheet_approval',
      title: `Timesheet submitted: ${name}`,
      body: `Week of ${d}-${m}-${y} is awaiting your approval.`,
      data: { link: '/timesheets' },
    });
  } catch { /* non-critical */ }
}

// Notify the approver that a week they'd already approved has been reopened
// (the owner edited it, so it needs approving again). Only the actual approver
// is notified — no admin fallback. An auto-approved (manager-less) week has no
// approver, so nobody is notified. Best-effort — never blocks the reopen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyReopen(service: any, firmId: string, submitterId: string, approverId: string | null, weekStart: string) {
  try {
    if (!approverId || approverId === submitterId) return; // nobody specific approved it → nobody to notify
    const { data: submitter } = await service.from('users').select('full_name, email').eq('id', submitterId).single();
    const name = submitter?.full_name || submitter?.email || 'A team member';

    const [y, m, d] = weekStart.split('-');
    void createNotification({
      userId: approverId,
      firmId,
      type: 'timesheet_approval',
      title: `Timesheet reopened: ${name}`,
      body: `The approved week of ${d}-${m}-${y} was reopened and will need approving again.`,
      data: { link: '/timesheets' },
    });
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

  // Permission: self may submit/withdraw own weeks; ONLY the manager the week was
  // routed to may approve/reject — no admin override. A week with no manager is
  // auto-approved at submit time, so it never reaches a manual review here.
  const isReview = action === 'approve' || action === 'reject';
  if (isReview) {
    // The manager the week was routed to (snapshot), falling back to the user's
    // current manager if the row/column predates the snapshot.
    const { data: existing } = await service
      .from('timesheet_week_status').select('manager_id')
      .eq('user_id', targetUser).eq('week_start', weekStart).maybeSingle();
    const rowManager = (existing?.manager_id as string | null) ?? await managerOf(service, targetUser);
    if (!rowManager || rowManager !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    // week (or reopened it manually) so it needs approving again. Read the row
    // first so we can tell the approver if it had already been approved.
    const { data: existing } = await service
      .from('timesheet_week_status')
      .select('status, reviewed_by')
      .eq('user_id', targetUser).eq('week_start', weekStart).maybeSingle();

    const { error } = await service
      .from('timesheet_week_status')
      .delete()
      .eq('user_id', targetUser)
      .eq('week_start', weekStart);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (existing?.status === 'approved') {
      void notifyReopen(service, ctx.firmId, targetUser, (existing.reviewed_by as string | null) ?? null, weekStart);
    }
    return NextResponse.json({ ok: true, status: 'draft' });
  }

  if (action === 'submit') {
    const rawManager = await managerOf(service, targetUser);
    // A user who is (somehow) their own manager counts as having no manager.
    const managerId = rawManager && rawManager !== targetUser ? rawManager : null;

    // No manager → nobody needs to approve this: auto-approve it and notify no
    // one. With a manager → route it to them for approval.
    const now = new Date().toISOString();
    const autoApprove = !managerId;
    const row: Record<string, unknown> = {
      firm_id: ctx.firmId, user_id: targetUser, week_start: weekStart,
      status: autoApprove ? 'approved' : 'submitted', note: null, submitted_at: now,
      reviewed_by: null, reviewed_at: autoApprove ? now : null, manager_id: managerId,
    };
    let { error } = await service.from('timesheet_week_status').upsert(row, { onConflict: 'user_id,week_start' });
    // Retry without manager_id if that column isn't migrated yet.
    if (error?.code === '42703') {
      delete row.manager_id;
      ({ error } = await service.from('timesheet_week_status').upsert(row, { onConflict: 'user_id,week_start' }));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (autoApprove) return NextResponse.json({ ok: true, status: 'approved', autoApproved: true });

    // Route a notification to the one approver — the submitter's manager.
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
