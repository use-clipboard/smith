import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { sendProposalEmail } from '@/lib/email';
import { getBaseUrl } from '@/lib/getBaseUrl';

const Body = z.object({
  to: z.string().email(),
});

// POST /api/proposals/settings/email-test
// Sends a real proposal-style email to the supplied address. Uses the firm's
// configured Gmail sender (if any) or Resend fallback. Includes a link to a
// sample preview proposal — created on first run and reused on subsequent
// tests — so the recipient sees the full branded proposal page.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const service = createServiceClient();

  // Resolve or create the firm's preview prospect + proposal
  const { data: settings } = await supabase
    .from('firm_proposal_settings')
    .select('preview_proposal_id')
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  let proposalId = (settings as { preview_proposal_id?: string | null } | null)?.preview_proposal_id ?? null;
  let proposal: { id: string; public_token: string; title: string } | null = null;

  if (proposalId) {
    const { data: existing } = await supabase
      .from('proposals')
      .select('id, public_token, title')
      .eq('id', proposalId)
      .eq('firm_id', ctx.firmId)
      .maybeSingle();
    proposal = existing as { id: string; public_token: string; title: string } | null;
    if (!proposal) proposalId = null;
  }

  if (!proposal) {
    // Create a sample prospect + proposal scoped to this firm with the firm's branding.
    const { data: prospect } = await service.from('proposal_prospects').insert({
      firm_id: ctx.firmId,
      contact_name: 'Sample Prospect',
      company_name: 'Sample Co Ltd',
      email: 'sample-prospect@example.com',
      client_type: 'limited_company',
      source: 'preview',
      status: 'archived',  // hidden from the active prospects list
      created_by: ctx.userId,
    }).select('id').single();
    if (!prospect) return NextResponse.json({ error: 'Could not create sample prospect' }, { status: 500 });

    const token = crypto.randomBytes(24).toString('hex');
    const { data: created, error } = await service.from('proposals').insert({
      firm_id: ctx.firmId,
      prospect_id: prospect.id,
      title: 'Sample Proposal — Q2 Bookkeeping & VAT',
      intro: "Thanks for the chat. Here's a sample proposal showing how your branding will look to a real prospect.",
      terms: 'These are our standard terms — they will appear in real proposals if set in Settings.',
      vat_mode: 'exclusive',
      vat_rate: 20,
      status: 'sent',           // shows the accept block
      public_token: token,
      sent_at: new Date().toISOString(),
      total_monthly: 295,
      total_one_off: 0,
      total_annual: 0,
      created_by: ctx.userId,
    }).select('id, public_token, title').single();
    if (error || !created) return NextResponse.json({ error: error?.message ?? 'Could not create preview proposal' }, { status: 500 });

    // Two sample line items so the proposal renders something tangible
    await service.from('proposal_line_items').insert([
      {
        proposal_id: created.id,
        service_name: 'Monthly bookkeeping',
        description: 'Up to 100 transactions / month',
        frequency: 'monthly',
        unit_price: 245,
        quantity: 1,
        vat_treatment: 'exclusive',
        display_order: 0,
      },
      {
        proposal_id: created.id,
        service_name: 'Quarterly VAT return',
        description: 'Submitted via MTD',
        frequency: 'monthly',
        unit_price: 50,
        quantity: 1,
        vat_treatment: 'exclusive',
        display_order: 1,
      },
    ]);

    await service.from('firm_proposal_settings').upsert({
      firm_id: ctx.firmId,
      preview_proposal_id: created.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id' });

    proposal = created;
  }

  const { data: firm } = await supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle();
  const { data: sender } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const baseUrl = getBaseUrl();
  const link = `${baseUrl}/p/${proposal.public_token}`;

  try {
    await sendProposalEmail({
      firmId: ctx.firmId,
      to: body.to,
      proposalTitle: proposal.title,
      prospectName: 'Sample Prospect',
      firmName: firm?.name ?? 'your accountancy firm',
      senderName: sender?.full_name ?? sender?.email ?? null,
      intro: "Thanks for the chat. Here's a sample proposal showing how your branding will look to a real prospect.",
      acceptUrl: link,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Test send failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, previewUrl: link });
}
