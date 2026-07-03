import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { mapRow } from '@/lib/timesheets/entryMap';

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

// PATCH /api/timesheets/entries/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const p = parsed.data;

  // Map camelCase → column names; only include provided fields.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
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

  const supabase = createClient();
  // RLS restricts the update to the caller's own rows.
  const { data, error } = await supabase
    .from('time_entries')
    .update(patch)
    .eq('id', params.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ entry: mapRow(data) });
}

// DELETE /api/timesheets/entries/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const supabase = createClient();
  const { error } = await supabase.from('time_entries').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
