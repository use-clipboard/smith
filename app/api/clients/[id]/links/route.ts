import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const LINK_TYPES = [
  'director', 'shareholder', 'spouse_partner', 'trustee',
  'beneficiary', 'associated_company', 'parent_company',
  'subsidiary', 'guarantor', 'other',
] as const;

const CreateLinkSchema = z.object({
  linked_client_id: z.string().uuid(),
  link_type: z.enum(LINK_TYPES).default('other'),
  notes: z.string().max(500).optional(),
});

// GET /api/clients/[id]/links — return all links for this client (both directions)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Verify client belongs to this firm
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  // Fetch outgoing links (this client → other)
  const { data: outgoing } = await supabase
    .from('client_links')
    .select('id, link_type, notes, linked_client_id')
    .eq('client_id', params.id)
    .eq('firm_id', ctx.firmId);

  // Fetch incoming links (other → this client)
  const { data: incoming } = await supabase
    .from('client_links')
    .select('id, link_type, notes, client_id')
    .eq('linked_client_id', params.id)
    .eq('firm_id', ctx.firmId);

  // Collect all referenced client IDs
  const referencedIds = [
    ...new Set([
      ...(outgoing ?? []).map(l => l.linked_client_id),
      ...(incoming ?? []).map(l => l.client_id),
    ]),
  ];

  // Fetch those clients in one query
  const clientMap: Record<string, { id: string; name: string; client_ref: string | null; business_type: string | null; is_active: boolean }> = {};
  if (referencedIds.length > 0) {
    const { data: linkedClients } = await supabase
      .from('clients')
      .select('id, name, client_ref, business_type, is_active')
      .in('id', referencedIds)
      .eq('firm_id', ctx.firmId);
    for (const c of linkedClients ?? []) {
      clientMap[c.id] = c;
    }
  }

  const links = [
    ...(outgoing ?? []).map(l => ({
      id: l.id,
      link_type: l.link_type,
      notes: l.notes,
      direction: 'outgoing' as const,
      other_client: clientMap[l.linked_client_id] ?? null,
    })),
    ...(incoming ?? []).map(l => ({
      id: l.id,
      link_type: l.link_type,
      notes: l.notes,
      direction: 'incoming' as const,
      other_client: clientMap[l.client_id] ?? null,
    })),
  ];

  return NextResponse.json({ links });
}

// POST /api/clients/[id]/links — create a new link
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const { linked_client_id, link_type, notes } = parsed.data;

  if (linked_client_id === params.id) {
    return NextResponse.json({ error: 'Cannot link a client to itself' }, { status: 400 });
  }

  const supabase = createClient();

  // Verify both clients belong to this firm
  const { data: clients } = await supabase
    .from('clients')
    .select('id')
    .in('id', [params.id, linked_client_id])
    .eq('firm_id', ctx.firmId);

  if ((clients ?? []).length < 2) {
    return NextResponse.json({ error: 'One or both clients not found' }, { status: 404 });
  }

  // Check for existing link in either direction
  const { data: existing } = await supabase
    .from('client_links')
    .select('id')
    .or(
      `and(client_id.eq.${params.id},linked_client_id.eq.${linked_client_id}),and(client_id.eq.${linked_client_id},linked_client_id.eq.${params.id})`
    )
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'These clients are already linked' }, { status: 409 });
  }

  const { data: link, error } = await supabase
    .from('client_links')
    .insert({
      firm_id: ctx.firmId,
      client_id: params.id,
      linked_client_id,
      link_type,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/clients/[id]/links', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'These clients are already linked' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }

  return NextResponse.json({ link }, { status: 201 });
}
