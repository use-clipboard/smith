import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

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
