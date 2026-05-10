import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/hr/disclosures/[id]/audit
// Returns the activity log for a disclosure, scrubbed for anonymous reporters.
// Visible only to the parties (RLS-enforced).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Verify caller is a party. RLS already enforces this on the audit table,
  // but we want a clean 404 if not.
  const { data: parent } = await supabase
    .from('hr_disclosures')
    .select('id, reporter_id, recipient_id, is_anonymous')
    .eq('id', params.id)
    .maybeSingle();
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parent.reporter_id !== ctx.userId && parent.recipient_id !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('hr_disclosure_audit')
    .select('id, action, details, created_at, actor_id')
    .eq('disclosure_id', params.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/hr/disclosures/:id/audit]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  // Scrub actor_id when the actor is the anonymous reporter and the caller is
  // not the reporter themselves.
  const masked = (data ?? []).map(row => {
    if (parent.is_anonymous && row.actor_id === parent.reporter_id && parent.reporter_id !== ctx.userId) {
      return { ...row, actor_id: '__anonymous__' };
    }
    return row;
  });

  return NextResponse.json({ audit: masked });
}
