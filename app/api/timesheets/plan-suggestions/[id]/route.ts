import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';

// Clear a "from your plan" suggestion — called after it's confirmed (a real time
// entry was created) or dismissed. RLS scopes to the owner.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { error } = await supabase
    .from('timesheet_plan_suggestions')
    .delete()
    .eq('id', params.id).eq('user_id', ctx.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
