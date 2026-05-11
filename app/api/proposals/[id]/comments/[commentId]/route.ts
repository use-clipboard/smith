import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  // Only the author or an admin can delete
  const { data: c } = await supabase.from('proposal_comments').select('user_id, proposal_id').eq('id', params.commentId).maybeSingle();
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (c.user_id !== ctx.userId && ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await supabase.from('proposal_comments').delete().eq('id', params.commentId);
  return NextResponse.json({ ok: true });
}
