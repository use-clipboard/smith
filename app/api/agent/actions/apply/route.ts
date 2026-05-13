import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { applyProposal } from '@/lib/agent/tools';

const BodySchema = z.object({
  proposalId: z.string(),
  plainDescription: z.string().optional(),
});

// POST /api/agent/actions/apply — apply a previously-proposed change after the
// admin clicks Confirm. Snapshots before-state into agent_actions, performs the
// write, and fans out an in-app notification to every admin in the firm.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const result = await applyProposal(parsed.data.proposalId, {
    supabase, firmId: ctx.firmId, userId: ctx.userId, userRole: ctx.userRole,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (parsed.data.plainDescription) {
    await supabase.from('agent_actions').update({ plain_description: parsed.data.plainDescription }).eq('id', result.actionId);
  }

  // Notify every admin in the firm (except the actor themselves)
  const { data: admins } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('firm_id', ctx.firmId)
    .eq('role', 'admin');
  const { data: actor } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .single();
  const actorName = actor?.full_name || actor?.email || 'An admin';

  const notifications = (admins ?? [])
    .filter(a => a.id !== ctx.userId)
    .map(a => ({
      user_id: a.id,
      type: 'agent_action',
      title: 'Agent Smith change',
      body: `${actorName} ran: ${result.summary}`,
      data: { action_id: result.actionId, performed_by: ctx.userId, affected_count: result.affectedCount },
      read: false,
    }));
  if (notifications.length) await supabase.from('notifications').insert(notifications);

  return NextResponse.json({
    actionId: result.actionId,
    affectedCount: result.affectedCount,
    summary: result.summary,
  });
}
