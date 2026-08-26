import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Frequency = z.enum(['one_off','monthly','quarterly','annual']);
const Tier = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1),
  price: z.number(),
  frequency: Frequency,
  display_order: z.number().int().optional(),
});
const Patch = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  fee_type: z.enum(['fixed','tiered']).optional(),
  base_price: z.number().optional(),
  frequency: Frequency.optional(),
  vat_treatment: z.enum(['firm_default','inclusive','exclusive','exempt']).optional(),
  display_order: z.number().int().optional(),
  active: z.boolean().optional(),
  tiers: z.array(Tier).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let patch: z.infer<typeof Patch>;
  try { patch = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { tiers, ...row } = patch;
  if (Object.keys(row).length > 0) {
    const { error } = await supabase.from('proposal_services').update(row).eq('id', params.id).eq('firm_id', ctx.firmId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Replace tiers if provided (simplest: delete existing + reinsert)
  if (tiers) {
    await supabase.from('proposal_service_tiers').delete().eq('service_id', params.id);
    if (tiers.length > 0) {
      const tierRows = tiers.map((t, i) => ({
        service_id: params.id,
        label: t.label,
        price: t.price,
        frequency: t.frequency,
        display_order: t.display_order ?? i,
      }));
      await supabase.from('proposal_service_tiers').insert(tierRows);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('proposal_services').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
