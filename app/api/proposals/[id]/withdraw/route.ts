import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/proposals/[id]/withdraw — flip a sent/viewed proposal to withdrawn so the
// public link returns 410 and the prospect can no longer accept.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data: row } = await supabase
    .from('proposals')
    .select('status')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status === 'accepted') return NextResponse.json({ error: 'Cannot withdraw an accepted proposal.' }, { status: 400 });
  if (row.status === 'withdrawn') return NextResponse.json({ ok: true });
  const { error } = await supabase
    .from('proposals')
    .update({ status: 'withdrawn', decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
