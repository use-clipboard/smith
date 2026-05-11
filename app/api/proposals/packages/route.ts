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
const Body = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
  active: z.boolean().optional(),
  items: z.array(PackageItem).optional(),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data, error } = await supabase
    .from('proposal_packages')
    .select('*, items:proposal_package_items(*)')
    .eq('firm_id', ctx.firmId)
    .order('display_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ packages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data: pkg, error } = await supabase
    .from('proposal_packages')
    .insert({
      firm_id: ctx.firmId,
      name: body.name,
      description: body.description ?? null,
      display_order: body.display_order ?? 0,
      active: body.active ?? true,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (body.items && body.items.length > 0) {
    const rows = body.items.map((it, i) => ({
      package_id: pkg.id,
      service_id: it.service_id,
      tier_id: it.tier_id ?? null,
      custom_price: it.custom_price ?? null,
      display_order: it.display_order ?? i,
    }));
    await supabase.from('proposal_package_items').insert(rows);
  }
  return NextResponse.json({ package: pkg });
}
