import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { modulesForPlan } from '@/config/modules.config';

// ── PATCH /api/firms/plan ────────────────────────────────────────────────────
// Admin-only. Sets the firm's tier (Compliance/Practice) and, in one shot,
// writes the matching active_modules preset — so all existing module gating
// keeps working unchanged. In Phase 2 the Stripe webhook calls the same logic.
//
// 'internal' is deliberately NOT selectable here — it's the full-access tier for
// the firm(s) we run ourselves, set directly in the DB, not via the customer UI.
const schema = z.object({
  plan: z.enum(['compliance', 'practice']),
  seatCount: z.number().int().min(1).max(1000).optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', message: 'Only firm admins can change the plan.' }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { plan, seatCount } = parsed.data;

  const activeModules = modulesForPlan(plan);
  const updates: Record<string, unknown> = { subscription_tier: plan, active_modules: activeModules };
  if (seatCount !== undefined) updates.seat_count = seatCount;

  const supabase = createClient();
  const { error } = await supabase.from('firms').update(updates).eq('id', ctx.firmId);
  if (error) {
    console.error('[/api/firms/plan PATCH]', error);
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true, plan, activeModules });
}
