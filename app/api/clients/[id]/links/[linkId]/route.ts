import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const LINK_TYPES = [
  'director', 'shareholder', 'spouse_partner', 'trustee',
  'beneficiary', 'associated_company', 'parent_company',
  'subsidiary', 'guarantor', 'other',
] as const;

const UpdateLinkSchema = z.object({
  link_type: z.enum(LINK_TYPES).optional(),
  notes: z.string().max(500).nullable().optional(),
});

// PATCH /api/clients/[id]/links/[linkId] — update an existing link's type or notes
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; linkId: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = UpdateLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const supabase = createClient();

  // Verify the link belongs to this firm and references this client
  const { data: existing } = await supabase
    .from('client_links')
    .select('id, client_id, linked_client_id')
    .eq('id', params.linkId)
    .eq('firm_id', ctx.firmId)
    .or(`client_id.eq.${params.id},linked_client_id.eq.${params.id}`)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  const { data: link, error } = await supabase
    .from('client_links')
    .update(parsed.data)
    .eq('id', params.linkId)
    .select()
    .single();

  if (error) {
    console.error('PATCH /api/clients/[id]/links/[linkId]', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'These clients are already linked with this connection type' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update link' }, { status: 500 });
  }

  return NextResponse.json({ link });
}

// DELETE /api/clients/[id]/links/[linkId] — remove a link
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; linkId: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Verify the link belongs to this firm and is associated with this client
  const { data: link } = await supabase
    .from('client_links')
    .select('id')
    .eq('id', params.linkId)
    .eq('firm_id', ctx.firmId)
    .or(`client_id.eq.${params.id},linked_client_id.eq.${params.id}`)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('client_links')
    .delete()
    .eq('id', params.linkId);

  if (error) {
    console.error('DELETE /api/clients/[id]/links/[linkId]', error);
    return NextResponse.json({ error: 'Failed to remove link' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
