import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { sendProposalEmail } from '@/lib/email';

// POST /api/proposals/[id]/send
// Generates a public token (if missing), updates status to 'sent', recomputes
// totals from line items, and fires the Resend email to the prospect.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();

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
  const { error: updErr } = await supabase
    .from('proposals')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      public_token: token,
      total_one_off: totals.one_off,
      total_monthly: totals.monthly,
      total_annual: totals.annual,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Fetch firm name + sender for the email
  const { data: firm } = await supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle();
  const { data: sender } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();

  // Build the public link
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/p/${token}`;

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
