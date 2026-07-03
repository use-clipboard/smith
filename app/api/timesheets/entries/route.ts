import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { mapRow } from '@/lib/timesheets/entryMap';

const EntrySchema = z.object({
  date: z.string(),
  start: z.string().optional().default('—'),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().optional().default('Internal'),
  taskId: z.string().uuid().nullable().optional(),
  taskTitle: z.string().optional().default(''),
  activity: z.string().min(1),
  department: z.string().optional().default('General'),
  type: z.enum(['billable', 'non_billable', 'internal']),
  minutes: z.number().int().positive(),
  ratePence: z.number().int().min(0).optional().default(0),
  notes: z.string().optional().default(''),
  source: z.enum(['manual', 'timer', 'ai']).optional().default('manual'),
});

const CreateSchema = z.object({ entries: z.array(EntrySchema).min(1).max(60) });

// GET /api/timesheets/entries?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns { available: boolean, entries }. available=false when the table
// hasn't been migrated yet — the client then falls back to local demo mode.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const taskId = url.searchParams.get('taskId');

  const supabase = createClient();
  let q = supabase
    .from('time_entries')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('entry_date', { ascending: false })
    .limit(2000);
  if (from) q = q.gte('entry_date', from);
  if (to) q = q.lte('entry_date', to);
  if (taskId) q = q.eq('task_id', taskId);

  const { data, error } = await q;
  if (error) {
    // Table not migrated yet → tell the client to use local demo mode.
    // Postgres reports 42P01; PostgREST reports PGRST205 (table not in schema
    // cache). Match either, plus a message fallback, so the demo fallback is
    // reliable without masking genuine query/RLS errors.
    const missing =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      /time_entries/.test(error.message ?? '') && /(does not exist|schema cache|find the table)/i.test(error.message ?? '');
    if (missing) return NextResponse.json({ available: false, entries: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ available: true, entries: (data ?? []).map(mapRow) });
}

// POST /api/timesheets/entries  { entries: [...] }
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const rows = parsed.data.entries.map(e => ({
    firm_id: ctx.firmId,
    user_id: ctx.userId,
    client_id: e.clientId ?? null,
    client_name: e.clientName,
    task_id: e.taskId ?? null,
    task_title: e.taskTitle,
    entry_date: e.date,
    start_time: e.start === '—' ? null : e.start,
    activity: e.activity,
    department: e.department,
    entry_type: e.type,
    minutes: e.minutes,
    rate_pence: e.ratePence,
    notes: e.notes,
    source: e.source,
  }));

  const supabase = createClient();
  let { data, error } = await supabase.from('time_entries').insert(rows).select('*');

  // Graceful fallback if the task columns haven't been migrated yet (42703 =
  // undefined column) — retry without task_id/task_title so entry creation
  // never breaks on a partially-migrated database.
  if (error?.code === '42703') {
    const stripped = rows.map(r => {
      const c: Record<string, unknown> = { ...r };
      delete c.task_id;
      delete c.task_title;
      return c;
    });
    ({ data, error } = await supabase.from('time_entries').insert(stripped).select('*'));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: (data ?? []).map(mapRow) });
}
