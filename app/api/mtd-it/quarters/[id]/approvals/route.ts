import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/mtd-it/quarters/[id]/approvals
//   Full approval history for a quarter — EVERY send round, not just the latest
//   live one, and including superseded (voided) rows. Drives the approval
//   timeline on the Send step so any team member (not only whoever emailed the
//   client) can see what was sent, when it was approved, and — crucially — what
//   changes the client asked for and when.
//
//   Firm-scoped the same way as approvals/latest: RLS on the approvals table
//   already restricts to the firm, and we re-check the quarter's firm_id
//   explicitly so a foreign quarter id 404s rather than returning an empty list.
//
//   Returns { approvals: [...] } newest-send first.

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, clients!inner(firm_id)')
    .eq('id', params.id)
    .maybeSingle();
  const firmId = (q as { clients: { firm_id: string } } | null)?.clients.firm_id ?? null;
  if (!q || firmId !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const { data: approvals, error } = await supabase
    .from('mtd_it_quarter_approvals')
    .select(
      'id, sent_at, sent_by, recipient_email, cover_note, approved_at, ' +
      'changes_requested_at, changes_note, voided_at, edited_since_approved_at, ' +
      'reminders_paused, reminder_count, last_reminder_at, expires_at, ' +
      'sender:users!sent_by(full_name, email)',
    )
    .eq('quarter_id', params.id)
    .order('sent_at', { ascending: false });

  if (error) {
    console.error('GET /api/mtd-it/quarters/[id]/approvals', error);
    return NextResponse.json({ error: 'Failed to load approval history' }, { status: 500 });
  }

  return NextResponse.json({ approvals: approvals ?? [] });
}
