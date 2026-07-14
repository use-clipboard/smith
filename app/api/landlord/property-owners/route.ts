import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// property_owners = the ADDITIONAL owners of a property in the shared register
// (public.mtd_it_properties). An owner may be a linked client (owner_client_id)
// or a plain named individual. The primary landlord's own share lives on the
// property row (ownership_pct). Used by the Landlord tool's per-person split.

async function clientBelongsToFirm(clientId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from('clients').select('firm_id').eq('id', clientId).maybeSingle();
  return (data as { firm_id?: string } | null)?.firm_id === firmId;
}

async function propertyBelongsToFirm(propertyId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_properties')
    .select('id, clients!inner(firm_id)')
    .eq('id', propertyId)
    .maybeSingle();
  return (data as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id === firmId;
}

async function ownerPropertyForId(ownerId: string): Promise<{ property_id: string; firm_id: string | undefined } | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('property_owners')
    .select('property_id, mtd_it_properties!inner(clients!inner(firm_id))')
    .eq('id', ownerId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { property_id: string; mtd_it_properties?: { clients?: { firm_id?: string } } };
  return { property_id: row.property_id, firm_id: row.mtd_it_properties?.clients?.firm_id };
}

// GET /api/landlord/property-owners?client_id=...  → owners across the client's properties
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const clientId = new URL(req.url).searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  if (!(await clientBelongsToFirm(clientId, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('property_owners')
    .select('id, property_id, owner_client_id, owner_name, share_pct, mtd_it_properties!inner(client_id)')
    .eq('mtd_it_properties.client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load owners' }, { status: 500 });

  const owners = (data ?? []).map(o => ({
    id: o.id as string,
    property_id: o.property_id as string,
    owner_client_id: (o.owner_client_id as string | null) ?? null,
    owner_name: o.owner_name as string,
    share_pct: Number(o.share_pct),
  }));
  return NextResponse.json({ owners });
}

const CreateSchema = z.object({
  property_id:     z.string().uuid(),
  owner_client_id: z.string().uuid().nullable().optional(),
  owner_name:      z.string().min(1),
  share_pct:       z.number().min(0).max(100).default(0),
});

// POST /api/landlord/property-owners
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  if (!(await propertyBelongsToFirm(parsed.data.property_id, ctx.firmId))) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('property_owners')
    .insert({
      property_id:     parsed.data.property_id,
      owner_client_id: parsed.data.owner_client_id ?? null,
      owner_name:      parsed.data.owner_name.trim(),
      share_pct:       parsed.data.share_pct,
      created_by:      ctx.userId,
    })
    .select('id, property_id, owner_client_id, owner_name, share_pct')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to add owner' }, { status: 500 });
  return NextResponse.json({ owner: { ...data, share_pct: Number((data as { share_pct: number }).share_pct) } }, { status: 201 });
}

const PatchSchema = z.object({
  owner_client_id: z.string().uuid().nullable().optional(),
  owner_name:      z.string().min(1).optional(),
  share_pct:       z.number().min(0).max(100).optional(),
}).strict();

// PATCH /api/landlord/property-owners?id=...
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const owner = await ownerPropertyForId(id);
  if (!owner || owner.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Owner not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const patch: Record<string, unknown> = { ...parsed.data };
  if (typeof patch.owner_name === 'string') patch.owner_name = (patch.owner_name as string).trim();

  const supabase = createClient();
  const { error } = await supabase.from('property_owners').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to update owner' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/landlord/property-owners?id=...
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const owner = await ownerPropertyForId(id);
  if (!owner || owner.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Owner not found' }, { status: 404 });

  const supabase = createClient();
  const { error } = await supabase.from('property_owners').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete owner' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
