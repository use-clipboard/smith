import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { UNIFIED_TIME_SELECT, unifiedRowToTaskTimeEntry, isMissingSchema, type UnifiedTimeRow } from '@/lib/tasks/taskTime';

const CreateTimeEntrySchema = z.object({
  step_id: z.string().uuid().optional().nullable(),
  started_at: z.string(),
  ended_at: z.string().optional().nullable(),
  duration_minutes: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// GET /api/tasks/[id]/time — task time, from the unified Timesheets ledger
// (time_entries) with a fallback to the legacy task_time_entries table until
// the unify migration is applied.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const uni = await supabase
    .from('time_entries')
    .select(UNIFIED_TIME_SELECT)
    .eq('task_id', params.id)
    .order('entry_date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false });

  if (!uni.error) {
    return NextResponse.json({ entries: (uni.data ?? []).map(r => unifiedRowToTaskTimeEntry(r as unknown as UnifiedTimeRow)) });
  }
  if (!isMissingSchema(uni.error)) {
    return NextResponse.json({ error: 'Failed to load time entries' }, { status: 500 });
  }

  // Legacy fallback (pre-migration).
  const { data: entries, error } = await supabase
    .from('task_time_entries')
    .select('*, user:users(id, full_name, email), step:task_steps(id, step_key, title)')
    .eq('task_id', params.id)
    .order('started_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load time entries' }, { status: 500 });
  return NextResponse.json({ entries });
}

// POST /api/tasks/[id]/time — log time against a task into the unified ledger.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateTimeEntrySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  const { data: task } = await supabase
    .from('tasks')
    .select('id, client_id, is_internal, title, client:clients(name)')
    .eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Duration in whole minutes (>= 1).
  let minutes = parsed.data.duration_minutes ?? null;
  if (!minutes && parsed.data.started_at && parsed.data.ended_at) {
    minutes = Math.round((new Date(parsed.data.ended_at).getTime() - new Date(parsed.data.started_at).getTime()) / 60000);
  }
  minutes = Math.max(1, minutes ?? 1);

  const isInternal = !!(task as { is_internal?: boolean }).is_internal;
  const entryType = isInternal ? 'internal' : 'billable';
  const clientName = (task as { client?: { name?: string } | null }).client?.name ?? 'Internal';
  const title = (task as { title?: string }).title ?? 'Task time';

  let ratePence = 0;
  if (entryType === 'billable') {
    const { data: u } = await supabase.from('users').select('charge_out_rate_pence').eq('id', ctx.userId).single();
    ratePence = (u as { charge_out_rate_pence?: number } | null)?.charge_out_rate_pence ?? 0;
  }

  const entryDate = parsed.data.started_at.slice(0, 10);
  const startTime = parsed.data.started_at.slice(11, 16) || null;

  const unifiedRow = {
    firm_id: ctx.firmId,
    user_id: ctx.userId,
    client_id: (task as { client_id?: string | null }).client_id ?? null,
    client_name: clientName,
    task_id: params.id,
    task_title: title,
    step_id: parsed.data.step_id ?? null,
    entry_date: entryDate,
    start_time: startTime,
    activity: title || 'Task time',
    department: null as string | null,
    entry_type: entryType,
    minutes,
    rate_pence: ratePence,
    notes: parsed.data.notes ?? null,
    source: 'timer',
  };

  const ins = await supabase.from('time_entries').insert(unifiedRow).select(UNIFIED_TIME_SELECT).single();
  if (!ins.error) {
    return NextResponse.json({ entry: unifiedRowToTaskTimeEntry(ins.data as unknown as UnifiedTimeRow) }, { status: 201 });
  }
  if (!isMissingSchema(ins.error)) {
    console.error('POST /api/tasks/[id]/time (unified)', ins.error);
    return NextResponse.json({ error: 'Failed to log time' }, { status: 500 });
  }

  // Legacy fallback (pre-migration) — original behaviour.
  const { data: entry, error } = await supabase
    .from('task_time_entries')
    .insert({
      task_id: params.id,
      step_id: parsed.data.step_id ?? null,
      user_id: ctx.userId,
      started_at: parsed.data.started_at,
      ended_at: parsed.data.ended_at ?? null,
      duration_minutes: minutes,
      notes: parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/tasks/[id]/time (legacy)', error);
    return NextResponse.json({ error: 'Failed to log time' }, { status: 500 });
  }
  return NextResponse.json({ entry }, { status: 201 });
}
