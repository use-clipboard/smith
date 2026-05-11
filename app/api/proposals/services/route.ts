import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Frequency = z.enum(['one_off','monthly','quarterly','annual']);
const Tier = z.object({
  label: z.string().min(1),
  price: z.number(),
  frequency: Frequency,
  display_order: z.number().int().optional(),
});
const Body = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  fee_type: z.enum(['fixed','tiered']),
  base_price: z.number().optional(),
  frequency: Frequency.optional(),
  vat_treatment: z.enum(['firm_default','inclusive','exclusive','exempt']).optional(),
  display_order: z.number().int().optional(),
  active: z.boolean().optional(),
  tiers: z.array(Tier).optional(),  // for fee_type='tiered'
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data, error } = await supabase
    .from('proposal_services')
    .select('*, tiers:proposal_service_tiers(*)')
    .eq('firm_id', ctx.firmId)
    .order('display_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ services: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data: svc, error } = await supabase
    .from('proposal_services')
    .insert({
      firm_id: ctx.firmId,
      name: body.name,
      description: body.description ?? null,
      category: body.category ?? null,
      fee_type: body.fee_type,
      base_price: body.base_price ?? 0,
      frequency: body.frequency ?? 'monthly',
      vat_treatment: body.vat_treatment ?? 'firm_default',
      display_order: body.display_order ?? 0,
      active: body.active ?? true,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Insert tiers if any
  if (body.fee_type === 'tiered' && body.tiers && body.tiers.length > 0) {
    const tierRows = body.tiers.map((t, i) => ({
      service_id: svc.id,
      label: t.label,
      price: t.price,
      frequency: t.frequency,
      display_order: t.display_order ?? i,
    }));
    await supabase.from('proposal_service_tiers').insert(tierRows);
  }
  return NextResponse.json({ service: svc });
}
