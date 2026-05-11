import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/proposals/settings/email-senders — lists dedicated proposal Gmail
// connections for the firm. Each row is its own connection_id so an admin
// can pick a specific account (firm shared inbox, partner's mailbox, etc.).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data } = await supabase
    .from('proposal_email_connections')
    .select('id, google_email, display_name, connected_by_user_id, connected_at, user:users!connected_by_user_id(full_name, email)')
    .eq('firm_id', ctx.firmId)
    .order('connected_at', { ascending: false });
  const connections = (data ?? []).map(c => ({
    id: c.id,
    google_email: c.google_email,
    display_name: c.display_name ?? null,
    connected_by: (c.user as { full_name?: string; email?: string } | null)?.full_name
      ?? (c.user as { full_name?: string; email?: string } | null)?.email
      ?? null,
  }));
  return NextResponse.json({ connections });
}

// DELETE /api/proposals/settings/email-senders?id=... — admin only, disconnect a Gmail.
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const service = createServiceClient();
  // Confirm in our firm
  const { data: row } = await service.from('proposal_email_connections').select('id, firm_id').eq('id', id).maybeSingle();
  if (!row || row.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await service.from('proposal_email_connections').delete().eq('id', id);
  // If this was the configured sender, clear it
  await service.from('firm_proposal_settings').update({ proposal_email_sender_connection_id: null }).eq('firm_id', ctx.firmId).eq('proposal_email_sender_connection_id', id);
  return NextResponse.json({ ok: true });
}
