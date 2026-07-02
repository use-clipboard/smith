import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { canAccessTimesheets } from '@/lib/timesheets/access';
import { createClient } from '@/lib/supabase-server';

// Shape returned to the client — matches the TimeEntry type field names so the
// provider can consume rows directly.
export interface ApiEntry {
  id: string;
  userId: string;
  date: string;
  start: string;
  clientId: string | null;
  clientName: string;
  taskTitle: string;
  activity: string;
  department: string;
  type: 'billable' | 'non_billable' | 'internal';
  minutes: number;
  ratePence: number;
  notes: string;
  source: 'manual' | 'timer' | 'ai';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRow(r: any): ApiEntry {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.entry_date,
    start: r.start_time ?? '—',
    clientId: r.client_id ?? null,
    clientName: r.client_name ?? 'Internal',
    taskTitle: r.task_title ?? '',
    activity: r.activity,
    department: r.department ?? 'General',
    type: r.entry_type,
    minutes: r.minutes,
    ratePence: r.rate_pence ?? 0,
    notes: r.notes ?? '',
    source: r.source ?? 'manual',
  };
}

const EntrySchema = z.object({
  date: z.string(),
  start: z.string().optional().default('—'),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().optional().default('Internal'),
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
  if (!canAccessTimesheets(ctx.email)) return moduleNotActive('timesheets');

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const supabase = createClient();
  let q = supabase
    .from('time_entries')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('entry_date', { ascending: false })
    .limit(2000);
  if (from) q = q.gte('entry_date', from);
  if (to) q = q.lte('entry_date', to);

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
  if (!canAccessTimesheets(ctx.email)) return moduleNotActive('timesheets');

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const rows = parsed.data.entries.map(e => ({
    firm_id: ctx.firmId,
    user_id: ctx.userId,
    client_id: e.clientId ?? null,
    client_name: e.clientName,
    entry_date: e.date,
    start_time: e.start === '—' ? null : e.start,
    activity: e.activity,
    task_title: e.taskTitle,
    department: e.department,
    entry_type: e.type,
    minutes: e.minutes,
    rate_pence: e.ratePence,
    notes: e.notes,
    source: e.source,
  }));

  const supabase = createClient();
  const { data, error } = await supabase.from('time_entries').insert(rows).select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: (data ?? []).map(mapRow) });
}
