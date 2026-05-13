import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { undoAction } from '@/lib/agent/tools';

// POST /api/agent/actions/[id]/undo — restore from snapshot if within 24h.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const supabase = createClient();
  const result = await undoAction(params.id, {
    supabase, firmId: ctx.firmId, userId: ctx.userId, userRole: ctx.userRole,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Notify other admins about the undo too
  const { data: admins } = await supabase
    .from('users').select('id').eq('firm_id', ctx.firmId).eq('role', 'admin');
  const { data: actor } = await supabase
    .from('users').select('full_name, email').eq('id', ctx.userId).single();
  const actorName = actor?.full_name || actor?.email || 'An admin';
  const notifs = (admins ?? [])
    .filter(a => a.id !== ctx.userId)
    .map(a => ({
      user_id: a.id, type: 'agent_action',
      title: 'Agent Smith change undone',
      body: `${actorName} undid: ${result.summary}`,
      data: { action_id: params.id, undone: true },
      read: false,
    }));
  if (notifs.length) await supabase.from('notifications').insert(notifs);

  return NextResponse.json({ summary: result.summary });
}
