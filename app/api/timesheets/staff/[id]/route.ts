import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';

const PatchSchema = z.object({
  ratePence: z.number().int().min(0).max(1_000_000).nullable().optional(),
  capacityHours: z.number().min(0).max(168).nullable().optional(),
  department: z.string().max(60).nullable().optional(),
});

// PATCH /api/timesheets/staff/[id] — set charge-out rate / weekly capacity.
// Admins may edit anyone in their firm; other users may only edit themselves.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  if (ctx.userRole !== 'admin' && ctx.userId !== params.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.ratePence !== undefined) patch.charge_out_rate_pence = parsed.data.ratePence;
  if (parsed.data.capacityHours !== undefined) patch.weekly_capacity_hours = parsed.data.capacityHours;
  if (parsed.data.department !== undefined) patch.department = parsed.data.department;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const service = createServiceClient();
  // Constrain to the caller's firm so an admin can't edit another firm's users.
  const { error } = await service
    .from('users')
    .update(patch)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
