import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';
import { sendProposalOnboardingEmail } from '@/lib/email';

const Body = z.object({
  signer_name: z.string().min(1),
  signer_email: z.string().email(),
  typed_signature: z.string().min(1),
  chosen_package_id: z.string().uuid().nullable().optional(),
  required_signer_id: z.string().uuid().nullable().optional(),
});

// POST /api/p/[token]/accept — public, no auth.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const service = createServiceClient();
  const { data: proposal } = await service
    .from('proposals')
    .select(`
      id, firm_id, status, prospect_id, created_by, title, expires_at,
      post_acceptance_action, post_acceptance_onboarding_form_id,
      offered_packages:proposal_offered_packages(id),
      required_signers:proposal_required_signers(id, signer_email),
      signatures:proposal_signatures(id, required_signer_id, signer_email)
    `)
    .eq('public_token', params.token)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status === 'accepted') return NextResponse.json({ error: 'Already accepted' }, { status: 400 });
  if (proposal.status === 'withdrawn' || proposal.status === 'expired' || proposal.status === 'declined') {
    return NextResponse.json({ error: 'This proposal is no longer available.' }, { status: 410 });
  }
  if (proposal.expires_at && new Date(proposal.expires_at as string).getTime() < Date.now()) {
    void service.from('proposals').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', proposal.id);
    return NextResponse.json({ error: 'This proposal has expired.' }, { status: 410 });
  }

  // Validate chosen package belongs to this proposal (if any offered)
  let chosen: string | null = null;
  const pkgs = (proposal.offered_packages ?? []) as Array<{ id: string }>;
  if (pkgs.length > 0) {
    if (!body.chosen_package_id) return NextResponse.json({ error: 'Please choose a package before accepting.' }, { status: 400 });
    if (!pkgs.some(p => p.id === body.chosen_package_id)) return NextResponse.json({ error: 'Unknown package' }, { status: 400 });
    chosen = body.chosen_package_id;
    await service.from('proposal_offered_packages').update({ is_chosen: true }).eq('id', chosen);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null;
  const ua = req.headers.get('user-agent') ?? null;

  // Multi-signatory handling: if required_signers exists, this signature counts
  // toward that signer's slot. We only flip the proposal to 'accepted' once every
  // required signer has signed.
  const requiredSigners = (proposal.required_signers ?? []) as Array<{ id: string; signer_email: string }>;
  const existingSignatures = (proposal.signatures ?? []) as Array<{ id: string; required_signer_id: string | null; signer_email: string }>;

  if (requiredSigners.length > 0) {
    // If a specific required_signer_id was passed, use it; otherwise match by email.
    const slot = body.required_signer_id
      ? requiredSigners.find(s => s.id === body.required_signer_id)
      : requiredSigners.find(s => s.signer_email.toLowerCase() === body.signer_email.toLowerCase());
    if (!slot) return NextResponse.json({ error: 'This email is not on the required signatories list for this proposal.' }, { status: 400 });
    if (existingSignatures.some(s => s.required_signer_id === slot.id)) {
      return NextResponse.json({ error: 'You have already signed.' }, { status: 400 });
    }
    await service.from('proposal_signatures').insert({
      proposal_id: proposal.id,
      required_signer_id: slot.id,
      signer_name: body.signer_name,
      signer_email: body.signer_email,
      typed_signature: body.typed_signature,
      ip_address: ip,
      user_agent: ua,
    });
    // Check if everyone has now signed
    const signedSlotIds = new Set(existingSignatures.map(s => s.required_signer_id).filter(Boolean));
    signedSlotIds.add(slot.id);
    const allSigned = requiredSigners.every(rs => signedSlotIds.has(rs.id));
    if (!allSigned) {
      const remaining = requiredSigners.filter(rs => !signedSlotIds.has(rs.id)).length;
      return NextResponse.json({ ok: true, pendingSigners: remaining });
    }
  } else {
    // Single-signature flow (existing behaviour)
    await service.from('proposal_signatures').insert({
      proposal_id: proposal.id,
      signer_name: body.signer_name,
      signer_email: body.signer_email,
      typed_signature: body.typed_signature,
      ip_address: ip,
      user_agent: ua,
    });
  }

  // Flip proposal status
  await service
    .from('proposals')
    .update({ status: 'accepted', decided_at: new Date().toISOString(), chosen_package_id: chosen })
    .eq('id', proposal.id);

  // ── Post-acceptance action ───────────────────────────────────────────────
  // Three modes (per migration 20260614 / proposals.post_acceptance_action):
  //   • 'none'                — skip all automation, just notify the firm
  //   • 'send_onboarding'     — email the prospect the onboarding-form link
  //                             (specific template if set; firm default otherwise)
  //   • 'auto_create_client'  — create a clients row immediately from prospect
  //                             details; skip the onboarding email
  // Legacy proposals (column null) fall back to 'send_onboarding' for back-compat.
  const action = (proposal.post_acceptance_action as string | null) ?? 'send_onboarding';
  let autoCreatedClientId: string | null = null;

  if (action === 'send_onboarding') {
    // Best-effort — onboarding email failure is logged but does not block acceptance.
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
      // If a specific template was selected on the proposal, check it's still
      // active; otherwise we fall back to "any active form on the firm" which
      // matches the pre-feature behaviour.
      const specificFormId = proposal.post_acceptance_onboarding_form_id as string | null;
      let hasForm = false;
      if (specificFormId) {
        const { count } = await service
          .from('proposal_onboarding_forms')
          .select('id', { count: 'exact', head: true })
          .eq('id', specificFormId)
          .eq('firm_id', proposal.firm_id)
          .eq('active', true);
        hasForm = (count ?? 0) > 0;
      } else {
        const { count } = await service
          .from('proposal_onboarding_forms')
          .select('id', { count: 'exact', head: true })
          .eq('firm_id', proposal.firm_id)
          .eq('active', true);
        hasForm = (count ?? 0) > 0;
      }
      if (hasForm) {
        const { data: prospect } = await service
          .from('proposal_prospects')
          .select('contact_name, email')
          .eq('id', proposal.prospect_id)
          .maybeSingle();
        const { data: firm } = await service.from('firms').select('name').eq('id', proposal.firm_id).maybeSingle();
        if (prospect) {
          await sendProposalOnboardingEmail({
            firmId: proposal.firm_id,
            to: prospect.email,
            prospectName: prospect.contact_name,
            firmName: firm?.name ?? 'your accountancy firm',
            onboardingUrl: `${baseUrl}/p/${params.token}/onboarding`,
          });
        }
      }
    } catch (e) {
      console.error('[proposals/accept] onboarding email failed', e);
    }
  } else if (action === 'auto_create_client') {
    // Create a clients row from the prospect's details. We deliberately keep
    // this minimal — the firm can fill in the rest from the Clients screen.
    try {
      const { data: prospect } = await service
        .from('proposal_prospects')
        .select('contact_name, company_name, email')
        .eq('id', proposal.prospect_id)
        .maybeSingle();
      if (prospect) {
        const clientName = prospect.company_name?.trim() || prospect.contact_name?.trim() || 'New client';
        const { data: client, error: clientErr } = await service
          .from('clients')
          .insert({
            firm_id: proposal.firm_id,
            name: clientName,
            contact_email: prospect.email ?? null,
          })
          .select('id')
          .single();
        if (clientErr) {
          console.error('[proposals/accept] auto-create client failed', clientErr);
        } else if (client) {
          autoCreatedClientId = client.id;
        }
      }
    } catch (e) {
      console.error('[proposals/accept] auto-create client errored', e);
    }
  }
  // action === 'none' → fall through; the notification block below handles the rest.

  // Notify the proposal creator + firm admins
  if (proposal.created_by) {
    void createNotification({
      userId: proposal.created_by,
      firmId: proposal.firm_id,
      type: 'proposal_accepted',
      title: 'Proposal accepted',
      body: `${body.signer_name} accepted "${proposal.title}".${
        action === 'none' ? ' No onboarding has been triggered — handle next steps manually.' :
        action === 'auto_create_client' ? (autoCreatedClientId ? ' A client record has been created automatically.' : ' Auto client creation was requested but failed — handle manually.') :
        ''
      }`,
      data: { proposal_id: proposal.id, link: '/proposals' },
    });
  }
  // Also notify all firm admins (so management sees acceptances)
  const { data: admins } = await service
    .from('users')
    .select('id')
    .eq('firm_id', proposal.firm_id)
    .eq('role', 'admin');
  for (const a of admins ?? []) {
    if (a.id === proposal.created_by) continue;
    void createNotification({
      userId: a.id,
      firmId: proposal.firm_id,
      type: 'proposal_accepted',
      title: 'Proposal accepted',
      body: `${body.signer_name} accepted "${proposal.title}".${
        action === 'none' ? ' No onboarding has been triggered — handle next steps manually.' :
        action === 'auto_create_client' ? (autoCreatedClientId ? ' A client record has been created automatically.' : ' Auto client creation was requested but failed — handle manually.') :
        ''
      }`,
      data: { proposal_id: proposal.id, link: '/proposals' },
    });
  }

  return NextResponse.json({ ok: true });
}
