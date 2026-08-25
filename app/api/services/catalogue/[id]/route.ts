import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { mapCatalogue } from '../route';

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  default_frequency: z.string().max(30).nullable().optional(),
  default_price_pence: z.number().int().min(0).nullable().optional(),
  default_task_type: z.string().max(120).nullable().optional(),
  archived: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// PATCH /api/services/catalogue/[id] — edit a catalogue item (admin only).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('firm_service_catalogue')
    .update(parsed.data)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ item: mapCatalogue(data) });
}

// DELETE /api/services/catalogue/[id] — archive (soft) a catalogue item so
// existing client services that reference it are unaffected (admin only).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const service = createServiceClient();
  const { error } = await service
    .from('firm_service_catalogue')
    .update({ archived: true })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
