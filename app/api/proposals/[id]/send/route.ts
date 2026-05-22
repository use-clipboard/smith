import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { sendProposalEmail, renderProposalEmail } from '@/lib/email';
import { getBaseUrl } from '@/lib/getBaseUrl';

// POST /api/proposals/[id]/send
// Generates a public token (if missing), updates status to 'sent', recomputes
// totals from line items, and fires the email.
//
// When the request body has `prepare_only: true`, the route still commits the
// status change + token + totals (same audit trail as a real send) but returns
// the rendered email subject/HTML/recipient instead of dispatching it. The
// caller then hands those to the in-app Compose window so the user can review
// and send from their own Gmail. Mirrors the MTD IT approval flow.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const prepareOnly = body?.prepare_only === true;

  const { data: proposal } = await supabase
    .from('proposals')
    .select('*, prospect:proposal_prospects(*), line_items:proposal_line_items(*), offered_packages:proposal_offered_packages(*)')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status !== 'draft' && proposal.status !== 'sent') {
    return NextResponse.json({ error: `Cannot resend a ${proposal.status} proposal.` }, { status: 400 });
  }
  if (!proposal.line_items || proposal.line_items.length === 0) {
    return NextResponse.json({ error: 'Add at least one service before sending.' }, { status: 400 });
  }

  // Compute totals
  const totals = computeProposalTotals(proposal.line_items as Array<{ frequency: string; unit_price: number; quantity: number }>);

  // Update per-package totals
  for (const pkg of (proposal.offered_packages ?? []) as Array<{ id: string }>) {
    const pkgItems = (proposal.line_items as Array<{ offered_package_id: string | null; frequency: string; unit_price: number; quantity: number }>).filter(li => li.offered_package_id === pkg.id);
    const pkgTotals = computeProposalTotals(pkgItems);
    await supabase.from('proposal_offered_packages').update({
      total_one_off: pkgTotals.one_off,
      total_monthly: pkgTotals.monthly,
      total_annual: pkgTotals.annual,
    }).eq('id', pkg.id);
  }

  const token = (proposal.public_token as string | null) ?? crypto.randomBytes(24).toString('hex');
  // The token + totals always commit so the email body's "View proposal"
  // link is live. Status / sent_at only flip when we're actually sending
  // the email from the server. The prepare_only path leaves status alone —
  // the caller is responsible for flipping it via /mark-sent after the
  // Compose window successfully dispatches.
  const updatePayload: Record<string, unknown> = {
    public_token: token,
    total_one_off: totals.one_off,
    total_monthly: totals.monthly,
    total_annual: totals.annual,
    updated_at: new Date().toISOString(),
  };
  if (!prepareOnly) {
    updatePayload.status  = 'sent';
    updatePayload.sent_at = new Date().toISOString();
  }
  const { error: updErr } = await supabase
    .from('proposals')
    .update(updatePayload)
    .eq('id', params.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Fetch firm name + sender for the email
  const { data: firm } = await supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle();
  const { data: sender } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();

  // Build the public link
  const baseUrl = getBaseUrl();
  const link = `${baseUrl}/p/${token}`;

  // prepare_only path — render the email body + subject and hand the bytes
  // back to the caller. No Resend / Gmail call; the Compose window in the
  // browser does the actual send via the user's own Gmail.
  if (prepareOnly) {
    const rendered = await renderProposalEmail({
      firmId: ctx.firmId,
      to: proposal.prospect.email,
      proposalTitle: proposal.title,
      prospectName: proposal.prospect.contact_name,
      firmName: firm?.name ?? 'your accountancy firm',
      senderName: sender?.full_name ?? sender?.email ?? null,
      intro: proposal.intro,
      acceptUrl: link,
    });
    return NextResponse.json({
      ok: true,
      link,
      prepared: {
        to_email:  proposal.prospect.email,
        to_name:   proposal.prospect.contact_name,
        subject:   rendered.subject,
        html_body: rendered.html,
      },
    });
  }

  try {
    await sendProposalEmail({
      firmId: ctx.firmId,
      to: proposal.prospect.email,
      proposalTitle: proposal.title,
      prospectName: proposal.prospect.contact_name,
      firmName: firm?.name ?? 'your accountancy firm',
      senderName: sender?.full_name ?? sender?.email ?? null,
      intro: proposal.intro,
      acceptUrl: link,
    });
  } catch (e) {
    console.error('[proposals/send] email failed', e);
    // Don't fail the whole request — the proposal is sent in our DB; user can resend.
    return NextResponse.json({ ok: true, warning: 'Proposal saved but email could not be sent. Check Resend configuration.', link });
  }

  return NextResponse.json({ ok: true, link });
}

function computeProposalTotals(items: Array<{ frequency: string; unit_price: number; quantity: number }>): { one_off: number; monthly: number; annual: number } {
  let one_off = 0, monthly = 0, annual = 0;
  for (const li of items) {
    const sub = Number(li.unit_price) * Number(li.quantity ?? 1);
    if (li.frequency === 'one_off') one_off += sub;
    else if (li.frequency === 'monthly') monthly += sub;
    else if (li.frequency === 'quarterly') monthly += sub / 3;
    else if (li.frequency === 'annual') annual += sub;
  }
  return { one_off, monthly, annual };
}
