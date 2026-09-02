import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';

// "From your plan" timesheet suggestions (timesheet_plan_suggestions).
// GET → the user's pending suggestions (with client name); POST → record one
// when a task is ticked done in the Organise-my-day planner (upsert per day).

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const supabase = createClient();
  const { data } = await supabase
    .from('timesheet_plan_suggestions')
    .select('id, task_id, client_id, title, is_internal, minutes, work_date, clients(name)')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false });

  const suggestions = ((data ?? []) as unknown as { id: string; task_id: string | null; client_id: string | null; title: string; is_internal: boolean; minutes: number; work_date: string; clients?: { name?: string } | null }[])
    .map(r => ({ id: r.id, taskId: r.task_id, clientId: r.client_id, clientName: r.clients?.name ?? null, title: r.title, isInternal: r.is_internal, minutes: r.minutes, date: r.work_date }));
  return NextResponse.json({ suggestions });
}

const Body = z.object({
  taskId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  isInternal: z.boolean().default(false),
  minutes: z.number().int().min(1).max(1440),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  // Don't suggest time already logged against this task today.
  const { count: already } = await supabase
    .from('time_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ctx.userId).eq('task_id', body.taskId).eq('entry_date', body.date);
  if ((already ?? 0) > 0) return NextResponse.json({ ok: true, skipped: 'already-logged' });

  const { error } = await supabase.from('timesheet_plan_suggestions').upsert({
    user_id: ctx.userId, firm_id: ctx.firmId, task_id: body.taskId, client_id: body.clientId ?? null,
    title: body.title, is_internal: body.isInternal, minutes: body.minutes, work_date: body.date,
  }, { onConflict: 'user_id,task_id,work_date' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
