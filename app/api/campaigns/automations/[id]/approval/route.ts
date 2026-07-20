import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';

// Approval for an automation. The automation is approved once — not every
// firing — because an automation runs on its own schedule and can't wait for a
// human each time. Editing its content or steps clears the approval.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trailFor(supabase: any, firmId: string, automationId: string) {
  const { data: rows } = await supabase
    .from('campaign_approvals')
    .select('id, automation_id, user_id, action, comment, created_at')
    .eq('firm_id', firmId).eq('automation_id', automationId)
    .order('created_at', { ascending: false });
  const { data: users } = await supabase.from('users').select('id, full_name, email').eq('firm_id', firmId);
  const nameById = new Map<string, string>(
    (users ?? []).map((u: { id: string; full_name: string | null; email: string | null }) => [u.id, u.full_name || u.email || 'Someone']),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows ?? []).map((r: any) => ({ ...r, user_name: r.user_id ? (nameById.get(r.user_id) ?? 'Someone') : 'SMITH' }));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();
  const { data: automation } = await supabase
    .from('campaign_automations').select('id, status, created_by, approved_at').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const settings = await getCampaignFirmSettings(supabase, ctx.firmId);
  const canApprove = ctx.userRole === 'admin' || (settings.allow_self_approve && automation.created_by === ctx.userId);

  return NextResponse.json({
    trail: await trailFor(supabase, ctx.firmId, params.id),
    canApprove,
    isAuthor: automation.created_by === ctx.userId,
    approvalRequired: settings.require_approval,
    approvedAt: automation.approved_at,
  });
}

const PostSchema = z.object({
  action: z.enum(['submit', 'approve', 'request_changes', 'withdraw']),
  comment: z.string().max(2000).optional().default(''),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = PostSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, comment } = parsed.data;

  const supabase = createClient();
  const { data: automation } = await supabase
    .from('campaign_automations').select('id, created_by, approved_at').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const settings = await getCampaignFirmSettings(supabase, ctx.firmId);
  const isAuthor = automation.created_by === ctx.userId;
  const canApprove = ctx.userRole === 'admin' || (settings.allow_self_approve && isAuthor);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let logged: string;

  switch (action) {
    case 'approve':
      if (!canApprove) return NextResponse.json({ error: 'Only an admin can approve this automation.' }, { status: 403 });
      patch.approved_at = new Date().toISOString();
      patch.approved_by = ctx.userId;
      logged = 'approved';
      break;
    case 'request_changes':
      if (!canApprove) return NextResponse.json({ error: 'Only an admin can review this automation.' }, { status: 403 });
      patch.approved_at = null;
      patch.approved_by = null;
      // An automation that loses approval must not keep running.
      patch.status = 'paused';
      logged = 'changes_requested';
      break;
    case 'withdraw':
      if (!isAuthor && ctx.userRole !== 'admin') {
        return NextResponse.json({ error: 'Only the author can withdraw this.' }, { status: 403 });
      }
      patch.approved_at = null;
      patch.approved_by = null;
      patch.status = 'paused';
      logged = 'withdrawn';
      break;
    case 'submit':
    default:
      logged = 'submitted';
      break;
  }

  const { error: updErr } = await supabase.from('campaign_automations').update(patch).eq('id', params.id).eq('firm_id', ctx.firmId);
  if (updErr) return NextResponse.json({ error: 'Failed to update the automation.' }, { status: 500 });

  await supabase.from('campaign_approvals').insert({
    firm_id: ctx.firmId, automation_id: params.id, campaign_id: null, user_id: ctx.userId, action: logged, comment,
  });

  return NextResponse.json({ ok: true, approvedAt: patch.approved_at ?? null, trail: await trailFor(supabase, ctx.firmId, params.id) });
}
