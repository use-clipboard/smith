import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/mtd-it/quarters/[id]/approvals/latest
//   Returns the most recent non-voided approval row for the quarter, plus the
//   sender's display name. Drives the small "Sent by … on …" status line on
//   the review screen so the preparer can see at a glance who pushed the
//   approval email out and when.
//
// Returns { approval: null } when no live approval exists — the consumer
// just hides the banner in that case.

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Firm-scope: load the quarter via the clients join so RLS + an explicit
  // firm_id check both apply.
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, clients!inner(firm_id)')
    .eq('id', params.id)
    .maybeSingle();
  const firmId = (q as { clients: { firm_id: string } } | null)?.clients.firm_id ?? null;
  if (!q || firmId !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const { data: approval, error } = await supabase
    .from('mtd_it_quarter_approvals')
    .select('id, sent_at, sent_by, recipient_email, approved_at, changes_requested_at, changes_note, expires_at, edited_since_approved_at, reminders_paused, reminder_count, sender:users!sent_by(full_name, email)')
    .eq('quarter_id', params.id)
    .is('voided_at', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('GET /api/mtd-it/quarters/[id]/approvals/latest', error);
    return NextResponse.json({ error: 'Failed to load approval' }, { status: 500 });
  }

  return NextResponse.json({ approval: approval ?? null });
}
