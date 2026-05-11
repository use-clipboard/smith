import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';

// GET /api/p/[token] — public, no auth. Returns proposal + prospect + items.
// Also stamps `first_viewed_at` / `last_viewed_at` on the proposal row.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const service = createServiceClient();
  const { data: proposal, error } = await service
    .from('proposals')
    .select(`
      id, firm_id, title, intro, terms, vat_mode, vat_rate, discount_amount, discount_label,
      status, sent_at, first_viewed_at, last_viewed_at, decided_at, decline_reason, expires_at,
      total_one_off, total_monthly, total_annual, chosen_package_id,
      prospect:proposal_prospects(contact_name, company_name, email),
      offered_packages:proposal_offered_packages(*),
      line_items:proposal_line_items(*),
      required_signers:proposal_required_signers(id, signer_name, signer_email, signer_role, display_order),
      signatures:proposal_signatures(id, required_signer_id, signer_name, signer_email, signed_at)
    `)
    .eq('public_token', params.token)
    .maybeSingle();
  if (error || !proposal) {
    return NextResponse.json({ error: 'Not found or expired' }, { status: 404 });
  }
  if (proposal.status === 'withdrawn' || proposal.status === 'expired') {
    return NextResponse.json({ error: 'This proposal is no longer available.' }, { status: 410 });
  }
  // Compute expiry on read — flip to 'expired' if past the date and not yet decided
  if (
    proposal.expires_at &&
    new Date(proposal.expires_at as string).getTime() < Date.now() &&
    (proposal.status === 'sent' || proposal.status === 'viewed')
  ) {
    void service.from('proposals').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', proposal.id);
    return NextResponse.json({ error: 'This proposal has expired.' }, { status: 410 });
  }
  // Fetch firm display name + logo, plus the proposal-branding overrides
  const [{ data: firm }, { data: branding }] = await Promise.all([
    service.from('firms').select('name, logo_url').eq('id', proposal.firm_id).maybeSingle(),
    service.from('firm_proposal_settings')
      .select('brand_use_firm_logo, brand_logo_url, brand_header_image_url, brand_primary_color, brand_accent_color, brand_font_family, brand_footer_text, brand_show_firm_name')
      .eq('firm_id', proposal.firm_id)
      .maybeSingle(),
  ]);
  const resolvedLogo = branding?.brand_use_firm_logo === false
    ? (branding?.brand_logo_url ?? null)
    : ((firm as { logo_url?: string } | null)?.logo_url ?? branding?.brand_logo_url ?? null);
  const brandPayload = {
    logo_url: resolvedLogo,
    header_image_url: branding?.brand_header_image_url ?? null,
    primary_color: branding?.brand_primary_color ?? '#0EA5E9',
    accent_color: branding?.brand_accent_color ?? '#0284C7',
    font_family: branding?.brand_font_family ?? 'system',
    footer_text: branding?.brand_footer_text ?? null,
    show_firm_name: branding?.brand_show_firm_name ?? true,
  };

  // Stamp viewed timestamps (best-effort)
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { last_viewed_at: now };
  const isFirstView = !proposal.first_viewed_at;
  if (isFirstView) {
    update.first_viewed_at = now;
    // Promote to 'viewed' if still in 'sent' state
    if (proposal.status === 'sent') update.status = 'viewed';
  }
  void service.from('proposals').update(update).eq('id', proposal.id);

  // Re-view notification: fire when a sent proposal is re-viewed and the last
  // view was > 6 hours ago (so we don't spam during a single browsing session).
  // First views are not announced — the "viewed" status badge change handles that.
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  if (!isFirstView && proposal.last_viewed_at && (Date.now() - new Date(proposal.last_viewed_at as string).getTime()) > SIX_HOURS_MS) {
    // Fetch the creator's id from the underlying proposals row (the select above doesn't include it)
    void (async () => {
      const { data: full } = await service
        .from('proposals')
        .select('id, title, created_by')
        .eq('id', proposal.id)
        .maybeSingle();
      if (full?.created_by) {
        await createNotification({
          userId: full.created_by,
          firmId: proposal.firm_id,
          type: 'proposal_reviewed',
          title: 'Proposal re-viewed',
          body: `${(proposal.prospect as { contact_name?: string } | null)?.contact_name ?? 'The prospect'} opened "${full.title}" again.`,
          data: { proposal_id: full.id, link: '/proposals' },
        });
      }
    })();
  }

  return NextResponse.json({ proposal: { ...proposal, firm_name: firm?.name ?? null, brand: brandPayload } });
}
