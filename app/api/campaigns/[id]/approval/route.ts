import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getCampaignFirmSettings } from '@/lib/campaigns/settings';

// Campaign approval workflow + audit trail.
//   submit          draft | changes_requested → awaiting_review
//   approve         awaiting_review → approved   (admin, or author if self-approve allowed)
//   request_changes awaiting_review → changes_requested
//   withdraw        awaiting_review → draft      (author or admin)

async function trailFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, firmId: string, campaignId: string,
) {
  const { data: rows } = await supabase
    .from('campaign_approvals')
    .select('id, campaign_id, user_id, action, comment, created_at')
    .eq('firm_id', firmId).eq('campaign_id', campaignId)
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
  const { data: campaign } = await supabase
    .from('campaigns').select('id, status, created_by, approved_at').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const settings = await getCampaignFirmSettings(supabase, ctx.firmId);
  const canApprove = ctx.userRole === 'admin'
    || (settings.allow_self_approve && campaign.created_by === ctx.userId);

  return NextResponse.json({
    trail: await trailFor(supabase, ctx.firmId, params.id),
    canApprove,
    isAuthor: campaign.created_by === ctx.userId,
    approvalRequired: settings.require_approval,
    approvalMinRecipients: settings.approval_min_recipients,
    status: campaign.status,
    approvedAt: campaign.approved_at,
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
  const { data: campaign } = await supabase
    .from('campaigns').select('id, status, created_by').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const settings = await getCampaignFirmSettings(supabase, ctx.firmId);
  const isAuthor = campaign.created_by === ctx.userId;
  const canApprove = ctx.userRole === 'admin' || (settings.allow_self_approve && isAuthor);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let logged: string;

  switch (action) {
    case 'submit':
      if (!['draft', 'changes_requested'].includes(campaign.status)) {
        return NextResponse.json({ error: 'Only a draft can be submitted for review.' }, { status: 409 });
      }
      patch.status = 'awaiting_review';
      logged = 'submitted';
      break;

    case 'approve':
      if (!canApprove) return NextResponse.json({ error: 'Only an admin can approve this campaign.' }, { status: 403 });
      if (campaign.status !== 'awaiting_review') {
        return NextResponse.json({ error: 'This campaign isn’t awaiting review.' }, { status: 409 });
      }
      patch.status = 'approved';
      patch.approved_at = new Date().toISOString();
      patch.approved_by = ctx.userId;
      logged = 'approved';
      break;

    case 'request_changes':
      if (!canApprove) return NextResponse.json({ error: 'Only an admin can review this campaign.' }, { status: 403 });
      if (campaign.status !== 'awaiting_review') {
        return NextResponse.json({ error: 'This campaign isn’t awaiting review.' }, { status: 409 });
      }
      patch.status = 'changes_requested';
      patch.approved_at = null;
      patch.approved_by = null;
      logged = 'changes_requested';
      break;

    case 'withdraw':
    default:
      if (!isAuthor && ctx.userRole !== 'admin') {
        return NextResponse.json({ error: 'Only the author can withdraw this campaign.' }, { status: 403 });
      }
      if (campaign.status !== 'awaiting_review') {
        return NextResponse.json({ error: 'This campaign isn’t awaiting review.' }, { status: 409 });
      }
      patch.status = 'draft';
      logged = 'withdrawn';
      break;
  }

  const { error: updErr } = await supabase.from('campaigns').update(patch).eq('id', params.id).eq('firm_id', ctx.firmId);
  if (updErr) return NextResponse.json({ error: 'Failed to update the campaign.' }, { status: 500 });

  await supabase.from('campaign_approvals').insert({
    firm_id: ctx.firmId, campaign_id: params.id, user_id: ctx.userId, action: logged, comment,
  });

  return NextResponse.json({ ok: true, status: patch.status, trail: await trailFor(supabase, ctx.firmId, params.id) });
}
