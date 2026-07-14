import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/landlord/property-owners/apply-to-all
//   Body: { property_id }
//   Copies one property's ownership split (its ownership_pct + every
//   property_owners row) onto ALL the client's other properties, replacing
//   their existing owners. For a portfolio owned in the same shares (e.g. a
//   couple at 50/50) this saves setting each property by hand.

const Body = z.object({ property_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }

  const supabase = createClient();

  // Source property + firm check.
  const { data: source } = await supabase
    .from('mtd_it_properties')
    .select('id, client_id, ownership_pct, clients!inner(firm_id)')
    .eq('id', body.property_id)
    .maybeSingle();
  const firm = (source as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!source || firm !== ctx.firmId) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

  // The split to copy.
  const { data: sourceOwners } = await supabase
    .from('property_owners')
    .select('owner_client_id, owner_name, share_pct')
    .eq('property_id', source.id);

  // Every other property of the same client.
  const { data: targets } = await supabase
    .from('mtd_it_properties')
    .select('id')
    .eq('client_id', source.client_id)
    .neq('id', source.id);

  const targetIds = (targets ?? []).map(t => t.id as string);
  if (targetIds.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  // Match the primary landlord's share.
  await supabase
    .from('mtd_it_properties')
    .update({ ownership_pct: source.ownership_pct })
    .in('id', targetIds);

  // Replace their owners with copies of the source's.
  await supabase.from('property_owners').delete().in('property_id', targetIds);

  const rows = targetIds.flatMap(pid =>
    (sourceOwners ?? []).map(o => ({
      property_id:     pid,
      owner_client_id: (o.owner_client_id as string | null) ?? null,
      owner_name:      o.owner_name as string,
      share_pct:       Number(o.share_pct),
      created_by:      ctx.userId,
    })),
  );
  if (rows.length > 0) {
    const { error } = await supabase.from('property_owners').insert(rows);
    if (error) return NextResponse.json({ error: 'Failed to apply split' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, applied: targetIds.length });
}
