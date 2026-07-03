import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { canAccessTimesheets } from '@/lib/timesheets/access';
import { createClient } from '@/lib/supabase-server';
import { DEPARTMENTS, SEED_ACTIVITIES } from '@/lib/timesheets/seed';

const DEFAULTS = {
  departments: [...DEPARTMENTS] as string[],
  activities: SEED_ACTIVITIES.map(a => ({ id: a.id, label: a.label, type: a.type, department: a.department })),
};

const ActivitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  type: z.enum(['billable', 'non_billable', 'internal']),
  department: z.string().max(60).default('General'),
});
const SettingsSchema = z.object({
  departments: z.array(z.string().min(1).max(60)).max(40),
  activities: z.array(ActivitySchema).max(80),
});

// GET /api/timesheets/settings → firm departments + activities (or defaults).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');
  if (!canAccessTimesheets(ctx.email)) return moduleNotActive('timesheets');

  const supabase = createClient();
  const { data } = await supabase.from('firms').select('timesheet_settings').eq('id', ctx.firmId).single();
  const s = (data?.timesheet_settings ?? null) as Partial<typeof DEFAULTS> | null;

  return NextResponse.json({
    departments: s?.departments?.length ? s.departments : DEFAULTS.departments,
    activities: s?.activities?.length ? s.activities : DEFAULTS.activities,
  });
}

// PUT /api/timesheets/settings — save firm config (admin only).
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');
  if (!canAccessTimesheets(ctx.email)) return moduleNotActive('timesheets');
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = SettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('firms')
    .update({ timesheet_settings: parsed.data })
    .eq('id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
