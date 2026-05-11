import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { resolveProposalSubject } from '@/lib/email';

// GET /api/proposals/settings/email-preview?kind=proposal|reminder|onboarding
// Optional overrides (used by the live preview while the user types):
//   &subject=...   override the subject template
//   &body=...      override the body template
//   &color=#RRGGBB override the header/CTA colour
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const kind = (params.get('kind') ?? 'proposal') as 'proposal' | 'reminder' | 'onboarding';
  const subjectOverride = params.get('subject');
  const bodyOverride = params.get('body');
  const colorOverride = params.get('color');
  const supabase = createClient();

  const [{ data: firm }, { data: settings }] = await Promise.all([
    supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle(),
    supabase
      .from('firm_proposal_settings')
      .select('intro_template, body_reminder, body_onboarding, subject_proposal, subject_reminder, subject_onboarding, brand_primary_color')
      .eq('firm_id', ctx.firmId)
      .maybeSingle(),
  ]);

  const vars = {
    firm_name: firm?.name ?? 'Your firm',
    prospect_name: 'Sample Prospect',
    proposal_title: 'Sample Proposal — Q2 Bookkeeping',
  };
  const previewUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/p/preview-link`;

  // Pick colour: explicit override > firm brand > per-kind default
  const headerColor = isValidHex(colorOverride)
    ? colorOverride!
    : isValidHex(settings?.brand_primary_color ?? null)
      ? (settings!.brand_primary_color as string)
      : (kind === 'onboarding' ? '#10b981' : '#0ea5e9');

  let subject = '';
  let html = '';
  if (kind === 'proposal') {
    subject = resolveProposalSubject(
      subjectOverride ?? settings?.subject_proposal ?? null,
      `Proposal from {firm} — {proposal}`,
      vars,
    );
    const intro = bodyOverride
      ?? settings?.intro_template
      ?? "Thanks for taking the time to talk to us. We've put together a proposal based on what we discussed — pop your details in the signature box on the proposal page when you're ready to proceed.";
    html = renderProposalHtml({ firmName: vars.firm_name, prospectName: vars.prospect_name, proposalTitle: vars.proposal_title, intro, acceptUrl: previewUrl, color: headerColor });
  } else if (kind === 'reminder') {
    subject = resolveProposalSubject(
      subjectOverride ?? settings?.subject_reminder ?? null,
      `Reminder: {proposal}`,
      vars,
    );
    const body = bodyOverride
      ?? settings?.body_reminder
      ?? "Just a quick nudge in case our earlier email got buried — the proposal is still open and we'd love your decision when you've had a chance to review it.";
    html = renderReminderHtml({ firmName: vars.firm_name, prospectName: vars.prospect_name, proposalTitle: vars.proposal_title, acceptUrl: previewUrl, body, color: headerColor });
  } else {
    subject = resolveProposalSubject(
      subjectOverride ?? settings?.subject_onboarding ?? null,
      `Welcome to {firm} — onboarding form`,
      vars,
    );
    const body = bodyOverride
      ?? settings?.body_onboarding
      ?? 'Thanks for accepting our proposal. To get you set up properly, please fill in our short onboarding form using the link below.';
    html = renderOnboardingHtml({ firmName: vars.firm_name, prospectName: vars.prospect_name, onboardingUrl: previewUrl, body, color: headerColor });
  }

  return NextResponse.json({ subject, html, previewUrl });
}

function isValidHex(v: string | null | undefined): boolean {
  return !!v && /^#[0-9a-fA-F]{6}$/.test(v);
}

// ── Inline body renderers ────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function renderProposalHtml(opts: { firmName: string; prospectName: string; proposalTitle: string; intro: string; acceptUrl: string; color: string }): string {
  const introBlock = opts.intro
    ? `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(opts.intro)}</p>`
    : '';
  return `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:${opts.color};color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">A proposal from ${escapeHtml(opts.firmName)}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">Hi ${escapeHtml(opts.prospectName.split(' ')[0])},</p>
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">${escapeHtml(opts.firmName)} has prepared a proposal for you: <strong>${escapeHtml(opts.proposalTitle)}</strong>.</p>
        ${introBlock}
        <a href="${opts.acceptUrl}" style="display:inline-block;background:${opts.color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View proposal</a>
      </div>
    </div>
  `;
}

function renderReminderHtml(opts: { firmName: string; prospectName: string; proposalTitle: string; acceptUrl: string; body: string; color: string }): string {
  return `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:${opts.color};color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">A quick reminder from ${escapeHtml(opts.firmName)}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">Hi ${escapeHtml(opts.prospectName.split(' ')[0])},</p>
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(opts.body)}</p>
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">Your proposal — <strong>${escapeHtml(opts.proposalTitle)}</strong> — is still available below.</p>
        <a href="${opts.acceptUrl}" style="display:inline-block;background:${opts.color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View proposal</a>
      </div>
    </div>
  `;
}

function renderOnboardingHtml(opts: { firmName: string; prospectName: string; onboardingUrl: string; body: string; color: string }): string {
  return `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:${opts.color};color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">Welcome aboard — one last form</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">Hi ${escapeHtml(opts.prospectName.split(' ')[0])},</p>
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(opts.body)}</p>
        <a href="${opts.onboardingUrl}" style="display:inline-block;background:${opts.color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Open onboarding form</a>
      </div>
    </div>
  `;
}
