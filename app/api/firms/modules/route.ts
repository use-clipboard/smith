import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { OPTIONAL_MODULE_IDS } from '@/config/modules.config';

const UpdateSchema = z.object({
  activeModules: z.array(z.string()),
  seatCount: z.number().int().min(1).optional(),
});

/** GET /api/firms/modules — return current module config for the firm */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient();
  const { data: firm, error } = await supabase
    .from('firms')
    .select('active_modules, seat_count')
    .eq('id', ctx.firmId)
    .single();

  if (error) return NextResponse.json({ error: 'Failed to load firm settings' }, { status: 500 });

  return NextResponse.json({
    activeModules: firm?.active_modules ?? [],
    seatCount: firm?.seat_count ?? 1,
  });
}

/** PATCH /api/firms/modules — update active modules (admin only) */
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (ctx.userRole !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Only firm admins can manage modules.' },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  // Validate that all provided module IDs are known optional modules
  const unknownModules = parsed.data.activeModules.filter(id => !OPTIONAL_MODULE_IDS.includes(id));
  if (unknownModules.length > 0) {
    return NextResponse.json(
      { error: 'Unknown module IDs', unknownModules },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { active_modules: parsed.data.activeModules };
  if (parsed.data.seatCount !== undefined) {
    updates.seat_count = parsed.data.seatCount;
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('firms')
    .update(updates)
    .eq('id', ctx.firmId);

  if (error) {
    console.error('[/api/firms/modules PATCH]', error);
    return NextResponse.json({ error: 'Failed to update module settings' }, { status: 500 });
  }

  return NextResponse.json({ success: true, activeModules: parsed.data.activeModules });
}
