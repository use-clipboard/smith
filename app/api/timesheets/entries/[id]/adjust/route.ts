import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';
import { mapRow } from '@/lib/timesheets/entryMap';
import { createNotification } from '@/lib/notifications';
import { startOfWeek, fmtDuration } from '@/lib/timesheets/format';

// PATCH /api/timesheets/entries/[id]/adjust
//
// Lets an APPROVER (the week's manager, or a firm admin) correct a team
// member's time entry — for genuine mistakes — without bouncing the whole week
// back. RLS scopes normal entry edits to the owner, so this uses the service
// client behind an explicit permission check (mirrors /week-entries + /weeks).
// The edit is ATTRIBUTED (edited_by / edited_at) and the OWNER IS NOTIFIED, so a
// change by someone else is never silent. Owners edit via the normal PATCH.

const PatchSchema = z.object({
  date: z.string().optional(),
  start: z.string().optional(),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().optional(),
  taskId: z.string().uuid().nullable().optional(),
  taskTitle: z.string().optional(),
  activity: z.string().optional(),
  department: z.string().optional(),
  type: z.enum(['billable', 'non_billable', 'internal']).optional(),
  minutes: z.number().int().positive().optional(),
  ratePence: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function managerOf(service: any, userId: string): Promise<string | null> {
  try {
    const { data } = await service.from('users').select('manager_id').eq('id', userId).single();
    return (data?.manager_id as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const p = parsed.data;

  const service = createServiceClient();

  // Load the target entry to find its owner + week.
  const { data: before, error: loadErr } = await service
    .from('time_entries').select('*').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const owner = before.user_id as string;
  // Owners edit through the normal path — this route is approver-only.
  if (owner === ctx.userId) {
    return NextResponse.json({ error: 'Use the normal editor for your own time.' }, { status: 400 });
  }

  // Permission: admins may adjust anyone; a manager may adjust weeks routed to
  // them (the week's snapshot manager, else the owner's current manager).
  if (ctx.userRole !== 'admin') {
    const weekStart = startOfWeek(before.entry_date as string);
    let rowManager: string | null = null;
    const { data: wk } = await service
      .from('timesheet_week_status').select('manager_id')
      .eq('user_id', owner).eq('week_start', weekStart).maybeSingle();
    rowManager = (wk?.manager_id as string | null) ?? await managerOf(service, owner);
    if (rowManager !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Build the column patch (only provided fields) + attribution.
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    edited_by: ctx.userId,
    edited_at: new Date().toISOString(),
  };
  if (p.date !== undefined) patch.entry_date = p.date;
  if (p.start !== undefined) patch.start_time = p.start === '—' ? null : p.start;
  if (p.clientId !== undefined) patch.client_id = p.clientId;
  if (p.clientName !== undefined) patch.client_name = p.clientName;
  if (p.taskId !== undefined) patch.task_id = p.taskId;
  if (p.taskTitle !== undefined) patch.task_title = p.taskTitle;
  if (p.activity !== undefined) patch.activity = p.activity;
  if (p.department !== undefined) patch.department = p.department;
  if (p.type !== undefined) patch.entry_type = p.type;
  if (p.minutes !== undefined) patch.minutes = p.minutes;
  if (p.ratePence !== undefined) patch.rate_pence = p.ratePence;
  if (p.notes !== undefined) patch.notes = p.notes;

  let { data, error } = await service
    .from('time_entries').update(patch).eq('id', params.id).select('*').single();
  // Attribution columns missing (migration not applied yet) → still save the
  // correction + notify, just without the edited_by/edited_at stamp.
  if (error?.code === '42703') {
    delete patch.edited_by;
    delete patch.edited_at;
    ({ data, error } = await service.from('time_entries').update(patch).eq('id', params.id).select('*').single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Human summary of what changed, for the owner's notification.
  const changes: string[] = [];
  if (p.minutes !== undefined && p.minutes !== before.minutes) changes.push(`duration ${fmtDuration(before.minutes)} → ${fmtDuration(p.minutes)}`);
  if (p.clientName !== undefined && p.clientName !== (before.client_name ?? '')) changes.push(`client → ${p.clientName || 'Internal'}`);
  if (p.activity !== undefined && p.activity !== before.activity) changes.push(`activity → ${p.activity}`);
  if (p.type !== undefined && p.type !== before.entry_type) changes.push(`type → ${p.type.replace('_', '-')}`);
  if (p.date !== undefined && p.date !== before.entry_date) changes.push('date changed');
  if (p.notes !== undefined && (p.notes ?? '') !== (before.notes ?? '')) changes.push('notes updated');

  // Notify the owner — attribution must never be silent.
  try {
    const { data: editor } = await service.from('users').select('full_name, email').eq('id', ctx.userId).single();
    const who = editor?.full_name || editor?.email || 'A manager';
    const [y, m, d] = String(before.entry_date).slice(0, 10).split('-');
    void createNotification({
      userId: owner,
      firmId: ctx.firmId,
      type: 'timesheet_approval',
      title: `Timesheet adjusted by ${who}`,
      body: `Your entry on ${d}-${m}-${y} was adjusted${changes.length ? `: ${changes.join(', ')}` : ''}.`,
      data: { link: '/timesheets' },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ entry: mapRow(data) });
}
