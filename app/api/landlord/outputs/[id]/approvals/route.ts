import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/landlord/outputs/[id]/approvals
//   The live (non-voided) approval rows for an analysis, newest first. One row
//   for the combined computation (person_key null) or one per individual.
//   Drives the step-5 status panel and the "n of m approved" count.

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Firm scope — RLS also covers this, but fail cleanly with a 404.
  const { data: out } = await supabase
    .from('outputs')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('feature', 'landlord_analysis')
    .maybeSingle();
  if (!out || out.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('landlord_approvals')
    .select('id, person_key, person_name, recipient_email, sent_at, expires_at, approved_at, changes_requested_at, changes_note')
    .eq('output_id', params.id)
    .is('voided_at', null)
    .order('sent_at', { ascending: false });
  if (error) {
    console.error('GET /api/landlord/outputs/[id]/approvals', error);
    return NextResponse.json({ error: 'Failed to load approvals' }, { status: 500 });
  }

  const approvals = (data ?? []).map(a => ({
    ...a,
    status: a.approved_at ? 'approved' : a.changes_requested_at ? 'changes_requested' : 'pending',
  }));
  const approvedCount = approvals.filter(a => a.status === 'approved').length;

  return NextResponse.json({ approvals, approved_count: approvedCount, total: approvals.length });
}
