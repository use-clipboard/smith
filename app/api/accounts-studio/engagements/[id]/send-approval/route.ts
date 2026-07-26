import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { buildApprovalEmailHtml } from '@/lib/accounts-studio/approvalEmail';
import { renderTemplate } from '@/lib/mtdIt/emailTemplates';
import { getAccountsStudioFirmSettings } from '@/lib/accounts-studio/firmSettings';
import { logAuditEvent } from '@/lib/accounts-studio/audit';
import type { Engagement } from '@/components/features/accounts-studio/types';

// POST /api/accounts-studio/engagements/[id]/send-approval
// Emails the accounts to the client for approval (via the preparer's Gmail),
// records a tokened accounts_studio_approvals row, and sets the engagement's
// approvalStatus -> 'sent'. `prepare_only` (Email Triage) skips the Gmail send
// and returns the rendered email for the in-app compose window.

const BodySchema = z.object({
  recipient_email: z.string().email(),
  cover_note:      z.string().nullable().optional(),
  pdf_base64:      z.string().nullable().optional(),
  summary_lines:   z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  prepare_only:    z.boolean().optional(),
});

const genToken = () => randomBytes(24).toString('base64url');

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { recipient_email, cover_note, pdf_base64, summary_lines, prepare_only } = parsed.data;

  const supabase = createClient();
  const service  = createServiceClient();

  // ── Load the engagement (firm-scoped) ──────────────────────────────────────
  const { data: row } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Accounts not found' }, { status: 404 });
  const e = (row.data ?? {}) as Engagement;

  // ── Preparer's Gmail connection ────────────────────────────────────────────
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (!prepare_only && (!connection?.refresh_token || !connection.google_email)) {
    return NextResponse.json({ error: 'Gmail not connected. Connect your Gmail in the Email Triage tool, then try again.' }, { status: 400 });
  }

  // ── Firm + preparer names + branding/templates ─────────────────────────────
  const { data: firm } = await supabase.from('firms').select('name, logo_url').eq('id', ctx.firmId).maybeSingle();
  const { data: me }   = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const firmName = firm?.name ?? 'Your accountant';
  const preparerName = me?.full_name?.trim() || me?.email?.split('@')[0] || 'Your accountant';
  const settings = await getAccountsStudioFirmSettings(supabase, ctx.firmId);

  // ── Void any pending prior approval for this engagement ─────────────────────
  await service.from('accounts_studio_approvals')
    .update({ voided_at: new Date().toISOString() })
    .eq('engagement_id', params.id)
    .is('approved_at', null).is('changes_requested_at', null).is('voided_at', null);

  const token = genToken();
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const approvalUrl = `${siteBase}/accounts-studio/approve/${token}`;

  const vars = {
    client_name: e.companyName, company_name: e.companyName, client_code: e.clientRef ?? '',
    period_end: e.periodEnd, period_start: e.periodStart, framework: e.framework,
    firm_name: firmName, preparer_name: preparerName, approval_link: approvalUrl,
  };
  const subject = renderTemplate(settings.approvalEmailSubject, vars);
  let bodyText = renderTemplate(settings.approvalEmailBody, vars);
  if (cover_note && cover_note.trim()) bodyText = `${cover_note.trim()}\n\n${bodyText}`;
  // Prefer the Accounts Studio brand logo (bucket → data URL), else the firm logo.
  let logoUrl: string | null = firm?.logo_url ?? null;
  if (settings.brandLogoPath) {
    try {
      const { data: blob } = await service.storage.from('accounts-studio-branding').download(settings.brandLogoPath);
      if (blob) { const buf = Buffer.from(await blob.arrayBuffer()); logoUrl = `data:${blob.type || 'image/png'};base64,${buf.toString('base64')}`; }
    } catch { /* fall back to the firm logo */ }
  }
  const baseEmailArgs = {
    firmName, bodyText, approvalUrl, summary: summary_lines ?? [],
    brandHex: settings.brandPrimaryColor, logoUrl,
  };
  // For prepare_only (compose window) we return this signature-less body — the
  // compose window appends the user's Gmail signature itself.
  const html = buildApprovalEmailHtml(baseEmailArgs);

  // ── Insert the approval row ────────────────────────────────────────────────
  const { data: approval, error: insErr } = await service
    .from('accounts_studio_approvals')
    .insert({ engagement_id: params.id, firm_id: ctx.firmId, token, sent_by: ctx.userId, recipient_email, cover_note: cover_note ?? null })
    .select('id')
    .single();
  if (insErr || !approval) {
    console.error('[accounts-studio send-approval] insert', insErr);
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 });
  }

  const attachmentFilename = `Accounts_${(e.companyName || 'client').replace(/\s+/g, '_')}_${e.periodEnd}.pdf`;

  // ── Send via Gmail (unless prepare_only) ───────────────────────────────────
  if (!prepare_only && connection) {
    try {
      const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
      // Append the sender's Gmail signature (direct send only; the compose flow
      // adds it itself).
      let signatureHtml: string | null = null;
      try {
        const sendAs = await gmail.users.settings.sendAs.list({ userId: 'me' });
        const list = sendAs.data.sendAs ?? [];
        const chosen = list.find(a => a.isDefault) ?? list.find(a => a.sendAsEmail === connection.google_email) ?? list[0];
        signatureHtml = chosen?.signature || null;
      } catch { /* signature is best-effort */ }
      const sendHtml = signatureHtml ? buildApprovalEmailHtml({ ...baseEmailArgs, signatureHtml }) : html;
      const attachments = pdf_base64 ? [{ filename: attachmentFilename, mimeType: 'application/pdf', data: Buffer.from(pdf_base64, 'base64') }] : [];
      const raw = buildRawMessage({ from: connection.google_email, to: [recipient_email], subject, htmlBody: sendHtml, attachments });
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch (err) {
      console.error('[accounts-studio send-approval] gmail', err);
      await service.from('accounts_studio_approvals').delete().eq('id', approval.id);
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send via Gmail' }, { status: 502 });
    }
  }

  // Audit the direct send. The compose (prepare_only) flow logs from
  // mark-approval-sent once the email is really sent from the compose window.
  if (!prepare_only) {
    await logAuditEvent({
      firmId: ctx.firmId,
      engagementId: params.id,
      clientId: e.clientId ?? null,
      companyName: e.companyName ?? null,
      actorId: ctx.userId,
      action: 'sent_for_approval',
      summary: `Sent to ${recipient_email} for approval`,
    });
  }

  // ── Advance status → 'sent' — DIRECT send only. For the compose (prepare_only)
  //    flow the status is flipped by mark-approval-sent once the email is really
  //    sent from the compose window, so cancelling the draft never marks 'sent'.
  if (!prepare_only && e.approvalStatus !== 'approved' && e.approvalStatus !== 'submitted') {
    const nextData = { ...e, approvalStatus: 'sent', sentAt: new Date().toISOString() };
    await supabase.from('accounts_studio_engagements')
      .update({ data: nextData, updated_at: new Date().toISOString() })
      .eq('id', params.id).eq('firm_id', ctx.firmId);
  }

  return NextResponse.json({ ok: true, approvalUrl, senderEmail: connection?.google_email, subject, htmlBody: html, attachmentFilename });
}
