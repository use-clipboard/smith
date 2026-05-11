import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PackageItem = z.object({
  service_id: z.string().uuid(),
  tier_id: z.string().uuid().nullable().optional(),
  custom_price: z.number().nullable().optional(),
  display_order: z.number().int().optional(),
});
const Patch = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
  active: z.boolean().optional(),
  items: z.array(PackageItem).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let patch: z.infer<typeof Patch>;
  try { patch = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { items, ...row } = patch;
  if (Object.keys(row).length > 0) {
    const { error } = await supabase.from('proposal_packages').update(row).eq('id', params.id).eq('firm_id', ctx.firmId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (items) {
    await supabase.from('proposal_package_items').delete().eq('package_id', params.id);
    if (items.length > 0) {
      const rows = items.map((it, i) => ({
        package_id: params.id,
        service_id: it.service_id,
        tier_id: it.tier_id ?? null,
        custom_price: it.custom_price ?? null,
        display_order: it.display_order ?? i,
      }));
      await supabase.from('proposal_package_items').insert(rows);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('proposal_packages').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
