import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';

// GET /api/timesheets/budgets → { available, budgets: { [clientId]: weeklyMinutes } }
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('timesheet_client_budgets')
    .select('client_id, weekly_budget_minutes')
    .eq('firm_id', ctx.firmId);

  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205' || /timesheet_client_budgets/.test(error.message ?? '');
    if (missing) return NextResponse.json({ available: false, budgets: {} });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const budgets: Record<string, number> = {};
  for (const r of data ?? []) budgets[r.client_id] = r.weekly_budget_minutes;
  return NextResponse.json({ available: true, budgets });
}

const PutSchema = z.object({
  clientId: z.string().uuid(),
  weeklyMinutes: z.number().int().min(0).max(100_000),
});

// PUT /api/timesheets/budgets  { clientId, weeklyMinutes }
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('timesheet_client_budgets')
    .upsert({
      firm_id: ctx.firmId,
      client_id: parsed.data.clientId,
      weekly_budget_minutes: parsed.data.weeklyMinutes,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id,client_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
