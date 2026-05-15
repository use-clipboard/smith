import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Properties = per-client list of UK or foreign rental properties.
// Each property carries ownership_pct so a shared-portfolio landlord can pre-
// apply their share to all rows tagged to that property. Currency lets the
// foreign-rental analyser flag amounts for FX conversion.

async function clientBelongsToFirm(clientId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from('clients').select('firm_id').eq('id', clientId).maybeSingle();
  return (data as { firm_id?: string } | null)?.firm_id === firmId;
}

// GET /api/mtd-it/properties?client_id=...
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const clientId = new URL(req.url).searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  if (!(await clientBelongsToFirm(clientId, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_properties')
    .select('id, client_id, address, country, currency, ownership_pct, property_type, active, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load properties' }, { status: 500 });
  return NextResponse.json({ properties: data ?? [] });
}

const CreateSchema = z.object({
  client_id:     z.string().uuid(),
  address:       z.string().min(1),
  country:       z.string().nullable().optional(),
  currency:      z.string().length(3).default('GBP'),
  ownership_pct: z.number().min(0).max(100).default(100),
  property_type: z.enum(['uk', 'foreign']),
});

// POST /api/mtd-it/properties
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  if (!(await clientBelongsToFirm(parsed.data.client_id, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_properties')
    .insert({ ...parsed.data, country: parsed.data.country ?? null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
  return NextResponse.json({ property: data }, { status: 201 });
}

const PatchSchema = z.object({
  address:       z.string().min(1).optional(),
  country:       z.string().nullable().optional(),
  currency:      z.string().length(3).optional(),
  ownership_pct: z.number().min(0).max(100).optional(),
  property_type: z.enum(['uk', 'foreign']).optional(),
  active:        z.boolean().optional(),
}).strict();

// PATCH /api/mtd-it/properties?id=...
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('mtd_it_properties')
    .select('id, clients!inner(firm_id)')
    .eq('id', id)
    .maybeSingle();
  const firm = (existing as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!existing || firm !== ctx.firmId) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const { error } = await supabase.from('mtd_it_properties').update(parsed.data).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to update property' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/mtd-it/properties?id=...
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('mtd_it_properties')
    .select('id, clients!inner(firm_id)')
    .eq('id', id)
    .maybeSingle();
  const firm = (existing as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!existing || firm !== ctx.firmId) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  const { error } = await supabase.from('mtd_it_properties').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete property' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
