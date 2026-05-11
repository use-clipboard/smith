import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Frequency = z.enum(['one_off','monthly','quarterly','annual']);
const LineItem = z.object({
  id: z.string().uuid().optional(),
  offered_package_id: z.string().uuid().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  service_name: z.string().min(1),
  description: z.string().nullable().optional(),
  tier_label: z.string().nullable().optional(),
  frequency: Frequency,
  unit_price: z.number(),
  quantity: z.number().optional(),
  vat_treatment: z.enum(['inclusive','exclusive','exempt']).optional(),
  display_order: z.number().int().optional(),
});
const OfferedPackage = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
});

const Patch = z.object({
  title: z.string().min(1).optional(),
  intro: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  notes_internal: z.string().nullable().optional(),
  vat_mode: z.enum(['inclusive','exclusive']).optional(),
  vat_rate: z.number().optional(),
  discount_amount: z.number().optional(),
  discount_label: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  status: z.enum(['draft','sent','viewed','accepted','declined','expired','withdrawn']).optional(),
  packages: z.array(OfferedPackage).optional(),
  line_items: z.array(LineItem).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data, error } = await supabase
    .from('proposals')
    .select(`
      *,
      prospect:proposal_prospects(*),
      offered_packages:proposal_offered_packages(*),
      line_items:proposal_line_items(*),
      signature:proposal_signatures(*)
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ proposal: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let patch: z.infer<typeof Patch>;
  try { patch = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { packages, line_items, ...row } = patch;

  if (Object.keys(row).length > 0) {
    const update: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('proposals').update(update).eq('id', params.id).eq('firm_id', ctx.firmId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Replace packages if provided. We map old client-side ids → new server ids so line items can be reattached.
  let packageIdMap: Record<string, string> = {};
  if (packages) {
    await supabase.from('proposal_offered_packages').delete().eq('proposal_id', params.id);
    if (packages.length > 0) {
      const rows = packages.map((p, i) => ({
        proposal_id: params.id,
        name: p.name,
        description: p.description ?? null,
        display_order: p.display_order ?? i,
      }));
      const { data: inserted } = await supabase.from('proposal_offered_packages').insert(rows).select('id');
      if (inserted) {
        packageIdMap = packages.reduce<Record<string, string>>((acc, p, i) => {
          if (p.id) acc[p.id] = inserted[i].id;
          return acc;
        }, {});
      }
    }
  }

  if (line_items) {
    await supabase.from('proposal_line_items').delete().eq('proposal_id', params.id);
    if (line_items.length > 0) {
      const rows = line_items.map((li, i) => ({
        proposal_id: params.id,
        offered_package_id: li.offered_package_id ? (packageIdMap[li.offered_package_id] ?? li.offered_package_id) : null,
        service_id: li.service_id ?? null,
        service_name: li.service_name,
        description: li.description ?? null,
        tier_label: li.tier_label ?? null,
        frequency: li.frequency,
        unit_price: li.unit_price,
        quantity: li.quantity ?? 1,
        vat_treatment: li.vat_treatment ?? 'exclusive',
        display_order: li.display_order ?? i,
      }));
      await supabase.from('proposal_line_items').insert(rows);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { error } = await supabase.from('proposals').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
