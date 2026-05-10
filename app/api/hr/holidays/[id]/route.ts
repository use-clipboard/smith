import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';
import { calcTotalDays } from '@/lib/hrHolidays';
import { addCalendarEventForUser } from '@/lib/hrCalendarPush';

const HalfMarker = z.enum(['full', 'morning', 'afternoon']);

const PatchSchema = z.object({
  // Approve / reject / cancel
  action: z.enum(['approve', 'reject', 'cancel']).optional(),
  rejection_reason: z.string().optional(),
  push_to_calendar: z.boolean().optional(),
  // Edit (manager / admin / requester pre-approval)
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_half: HalfMarker.optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_half: HalfMarker.optional(),
  reason: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchSchema>;
  try { body = PatchSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  const { data: row } = await supabase
    .from('hr_holiday_requests')
    .select('*, requester:users!user_id ( id, full_name, email )')
    .eq('id', params.id)
    .maybeSingle();
  if (!row || row.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isRequester = row.user_id === ctx.userId;
  const isManager = row.manager_id === ctx.userId;
  const isAdmin = ctx.userRole === 'admin';
  if (!isRequester && !isManager && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Approve ───────────────────────────────────────────────────
  if (body.action === 'approve') {
    if (!isManager && !isAdmin) return NextResponse.json({ error: 'Only the assigned manager or an admin can approve.' }, { status: 403 });
    if (row.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be approved.' }, { status: 400 });

    const update: Record<string, unknown> = {
      status: 'approved',
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
      rejection_reason: null,
      pushed_to_calendar: body.push_to_calendar === true,
    };

    let calendarEventId: string | null = null;
    if (body.push_to_calendar) {
      try {
        calendarEventId = await addCalendarEventForUser({
          userId: row.user_id,
          firmId: ctx.firmId,
          startDate: row.start_date,
          startHalf: row.start_half,
          endDate: row.end_date,
          endHalf: row.end_half,
          summary: 'Holiday',
        });
        update.google_calendar_event_id = calendarEventId;
      } catch (e) {
        console.error('[hr_holidays] calendar push failed:', e);
      }
    }

    const { error } = await supabase.from('hr_holiday_requests').update(update).eq('id', row.id);
    if (error) return NextResponse.json({ error: 'Approve failed' }, { status: 500 });

    void createNotification({
      userId: row.user_id,
      firmId: ctx.firmId,
      type: 'hr_holiday_decided',
      title: 'Holiday approved',
      body: `${row.start_date}${row.start_date === row.end_date ? '' : ` → ${row.end_date}`}`,
      data: { holiday_id: row.id, link: '/hr', outcome: 'approved' },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Reject ────────────────────────────────────────────────────
  if (body.action === 'reject') {
    if (!isManager && !isAdmin) return NextResponse.json({ error: 'Only the assigned manager or an admin can reject.' }, { status: 403 });
    if (row.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be rejected.' }, { status: 400 });
    const reason = (body.rejection_reason ?? '').trim();
    if (!reason) return NextResponse.json({ error: 'A reason is required when rejecting a request.' }, { status: 400 });

    const { error } = await supabase.from('hr_holiday_requests').update({
      status: 'rejected',
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
      rejection_reason: reason,
    }).eq('id', row.id);
    if (error) return NextResponse.json({ error: 'Reject failed' }, { status: 500 });

    void createNotification({
      userId: row.user_id,
      firmId: ctx.firmId,
      type: 'hr_holiday_decided',
      title: 'Holiday rejected',
      body: reason,
      data: { holiday_id: row.id, link: '/hr', outcome: 'rejected' },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Cancel ────────────────────────────────────────────────────
  if (body.action === 'cancel') {
    // Requester can cancel their own (pending or approved). Manager/admin can also cancel.
    if (!isRequester && !isManager && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (row.status === 'cancelled' || row.status === 'rejected') {
      return NextResponse.json({ error: 'Already finalised.' }, { status: 400 });
    }
    const { error } = await supabase.from('hr_holiday_requests').update({
      status: 'cancelled',
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (error) return NextResponse.json({ error: 'Cancel failed' }, { status: 500 });

    // Notify the manager when a staff member cancels
    if (isRequester && row.manager_id && row.manager_id !== ctx.userId) {
      void createNotification({
        userId: row.manager_id,
        firmId: ctx.firmId,
        type: 'hr_holiday_cancelled',
        title: 'Holiday cancelled',
        body: `${row.requester?.full_name ?? row.requester?.email ?? 'Team member'} cancelled their booking for ${row.start_date}.`,
        data: { holiday_id: row.id, link: '/hr?tab=team-holidays' },
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Edit (date/reason changes) ────────────────────────────────
  // Manager/admin can edit anything. Requester can only edit while pending.
  if (!isManager && !isAdmin && row.status !== 'pending') {
    return NextResponse.json({ error: 'Cannot edit a finalised request.' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.start_date) update.start_date = body.start_date;
  if (body.start_half) update.start_half = body.start_half;
  if (body.end_date) update.end_date = body.end_date;
  if (body.end_half) update.end_half = body.end_half;
  if (body.reason !== undefined) update.reason = body.reason;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No changes' }, { status: 400 });

  // Recompute total_days if dates/halves changed.
  const next = {
    start_date: (update.start_date as string) ?? row.start_date,
    start_half: (update.start_half as string) ?? row.start_half,
    end_date: (update.end_date as string) ?? row.end_date,
    end_half: (update.end_half as string) ?? row.end_half,
  };
  if (next.end_date < next.start_date) {
    return NextResponse.json({ error: 'End date cannot be before start date.' }, { status: 400 });
  }
  update.total_days = calcTotalDays(next.start_date, next.start_half as 'full' | 'morning' | 'afternoon', next.end_date, next.end_half as 'full' | 'morning' | 'afternoon');
  update.updated_at = new Date().toISOString();

  const { error } = await supabase.from('hr_holiday_requests').update(update).eq('id', row.id);
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('hr_holiday_requests').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
