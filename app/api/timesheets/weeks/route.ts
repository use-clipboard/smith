import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';
import { getApprovalMode } from '@/lib/timesheets/approvalMode';

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

// Notify the approver(s) a submitted week is routed to. The caller decides who
// (the manager in 'manager' mode, the firm's admins in 'admins' mode) so this
// just fans a notification out to that list. Best-effort — never blocks submit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifySubmitted(service: any, firmId: string, submitterId: string, recipients: string[], weekStart: string) {
  try {
    if (recipients.length === 0) return;
    const { data: submitter } = await service.from('users').select('full_name, email').eq('id', submitterId).single();
    const name = submitter?.full_name || submitter?.email || 'A team member';

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

// The firm's admins (approvers in 'admins' mode), excluding one user (the
// submitter shouldn't approve their own week).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function firmAdminIds(service: any, firmId: string, excludeUserId?: string): Promise<string[]> {
  try {
    const { data } = await service.from('users').select('id').eq('firm_id', firmId).eq('role', 'admin');
    return (data ?? []).map((a: { id: string }) => a.id).filter((id: string) => id !== excludeUserId);
  } catch {
    return [];
  }
}

// Notify that a week which had been approved was reopened (the owner edited it,
// so it needs approving again). Caller supplies the recipients (the original
// approver in 'manager' mode; the firm's admins in 'admins' mode). Best-effort.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyReopen(service: any, firmId: string, submitterId: string, recipients: string[], weekStart: string) {
  try {
    if (recipients.length === 0) return;
    const { data: submitter } = await service.from('users').select('full_name, email').eq('id', submitterId).single();
    const name = submitter?.full_name || submitter?.email || 'A team member';

    const [y, m, d] = weekStart.split('-');
    for (const rid of recipients) {
      void createNotification({
        userId: rid,
        firmId,
        type: 'timesheet_approval',
        title: `Timesheet reopened: ${name}`,
        body: `The approved week of ${d}-${m}-${y} was reopened and will need approving again.`,
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

  // Firm-wide approval routing: 'manager' (the submitter's manager only) or
  // 'admins' (any firm admin approves anyone). Set in Timesheets settings.
  const mode = await getApprovalMode(service, ctx.firmId);

  // Permission: self may submit/withdraw/reopen own weeks. For approve/reject:
  //   'manager' mode — ONLY the manager the week was routed to may review.
  //   'admins' mode  — any firm admin may review.
  const isReview = action === 'approve' || action === 'reject';
  if (isReview) {
    if (mode === 'admins') {
      if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else {
      // The manager the week was routed to (snapshot), falling back to the
      // user's current manager if the row/column predates the snapshot.
      const { data: existing } = await service
        .from('timesheet_week_status').select('manager_id')
        .eq('user_id', targetUser).eq('week_start', weekStart).maybeSingle();
      const rowManager = (existing?.manager_id as string | null) ?? await managerOf(service, targetUser);
      if (!rowManager || rowManager !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      // Tell whoever would re-approve it: the admins in 'admins' mode, else the
      // original approver (an auto-approved week has none → nobody notified).
      const approver = (existing.reviewed_by as string | null) ?? null;
      const recipients = mode === 'admins'
        ? await firmAdminIds(service, ctx.firmId, targetUser)
        : (approver && approver !== targetUser ? [approver] : []);
      void notifyReopen(service, ctx.firmId, targetUser, recipients, weekStart);
    }
    return NextResponse.json({ ok: true, status: 'draft' });
  }

  if (action === 'submit') {
    const rawManager = await managerOf(service, targetUser);
    // A user who is (somehow) their own manager counts as having no manager.
    const managerId = rawManager && rawManager !== targetUser ? rawManager : null;

    // Who this week is routed to for approval:
    //   'admins' mode  — every firm admin (bar the submitter).
    //   'manager' mode — the submitter's manager, if any.
    const recipients = mode === 'admins'
      ? await firmAdminIds(service, ctx.firmId, targetUser)
      : (managerId ? [managerId] : []);

    // Nobody to approve (no manager in manager-mode, or the submitter is the only
    // admin in admins-mode) → auto-approve and notify no one.
    const autoApprove = recipients.length === 0;
    const now = new Date().toISOString();
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

    void notifySubmitted(service, ctx.firmId, targetUser, recipients, weekStart);
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
