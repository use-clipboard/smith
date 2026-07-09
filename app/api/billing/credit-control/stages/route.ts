import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { ensureStages } from '@/lib/billing/creditControl';
import type { CreditControlStage } from '@/lib/billing/types';

interface StageRow {
  id: string; position: number; stage_key: string; name: string; tone: string;
  offset_days: number; subject: string; body: string; enabled: boolean;
}
function mapStage(r: StageRow): CreditControlStage {
  return { id: r.id, position: r.position, stageKey: r.stage_key, name: r.name, tone: r.tone as CreditControlStage['tone'], offsetDays: r.offset_days, subject: r.subject, body: r.body, enabled: r.enabled };
}

// GET /api/billing/credit-control/stages → the firm's reminder ladder (seeded on first use).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const rows = await ensureStages(supabase, ctx.firmId);
  const canEdit = ctx.userRole === 'admin';
  return NextResponse.json({ stages: (rows as StageRow[]).map(mapStage), canEdit });
}

const StageSchema = z.object({
  stageKey: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  tone: z.enum(['friendly', 'reminder', 'firm', 'final', 'legal']),
  offsetDays: z.number().int().min(-90).max(365),
  subject: z.string().max(200),
  body: z.string().max(4000),
  enabled: z.boolean(),
});
const PutSchema = z.object({ stages: z.array(StageSchema).max(20) });

// PUT /api/billing/credit-control/stages — replace the whole ladder (admin only).
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid ladder' }, { status: 400 });

  // Stage keys must be unique within the firm.
  const keys = parsed.data.stages.map(s => s.stageKey);
  if (new Set(keys).size !== keys.length) return NextResponse.json({ error: 'Stage keys must be unique.' }, { status: 400 });

  const supabase = createClient();
  // Replace: delete all, insert the new set. (Simple + fine at this scale.)
  await supabase.from('credit_control_stages').delete().eq('firm_id', ctx.firmId);
  if (parsed.data.stages.length > 0) {
    const rows = parsed.data.stages.map((s, i) => ({
      firm_id: ctx.firmId, position: i, stage_key: s.stageKey, name: s.name, tone: s.tone,
      offset_days: s.offsetDays, subject: s.subject, body: s.body, enabled: s.enabled,
    }));
    const { error } = await supabase.from('credit_control_stages').insert(rows);
    if (error) return NextResponse.json({ error: 'Could not save ladder' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
