import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { getQuarterDates, taxYearLabel } from '@/lib/mtdIt/quarters';
import { renderTemplate, buildEmailHtml, formatDateUkForTemplate } from '@/lib/mtdIt/emailTemplates';
import { ensureMtdItFirmSettings } from '@/lib/mtdIt/firmSettings';

// POST /api/mtd-it/quarters/[id]/send-approval
//   Body: { recipient_email, cover_note, pdf_base64, summary_lines }
//
// 1. Verifies firm scope + the preparer has Gmail connected.
// 2. Voids any pending (un-actioned) approval row on this quarter.
// 3. Creates a fresh mtd_it_quarter_approvals row with a 32-char token.
// 4. Renders the email subject + body from the firm's templates.
// 5. Sends via the preparer's Gmail with the PDF attached.
// 6. Flips the quarter status to 'sent'.

const BodySchema = z.object({
  recipient_email: z.string().email(),
  cover_note:      z.string().nullable().optional(),
  /** Approval-pack PDF generated client-side (base64). Optional — if absent,
   *  no attachment is sent. */
  pdf_base64:      z.string().nullable().optional(),
  /** Optional summary lines rendered as a small table in the email body. */
  summary_lines:   z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  /** Optional flag to flip from 'resend' so we don't void the prior row. */
  resend:          z.boolean().optional(),
  /** When true: build the approval row + render the email template + flip the
   *  quarter status to 'sent', but do NOT actually send via Gmail. Returns
   *  the rendered subject + HTML body so the caller can hand them off to the
   *  in-app compose window (Email Triage flow). */
  prepare_only:    z.boolean().optional(),
});

function genToken(): string {
  // 32 url-safe characters
  return randomBytes(24).toString('base64url');
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { recipient_email, cover_note, pdf_base64, summary_lines, resend, prepare_only } = parsed.data;

  const supabase = createClient();
  const service  = createServiceClient();

  // ── Load the quarter + client + firm name (firm-scope check) ─────────
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, client_id, tax_year, quarter, status, clients!inner(name, client_ref, contact_email, mtd_it_quarter_type, firm_id, firms!inner(name))')
    .eq('id', params.id)
    .maybeSingle();
  const c = (q as unknown as { clients?: { name?: string; client_ref?: string | null; firm_id?: string; contact_email?: string | null; mtd_it_quarter_type?: 'calendar' | 'standard'; firms?: { name?: string } } } | null)?.clients;
  if (!q || c?.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  // ── Preparer's Gmail connection ─────────────────────────────────────
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (!connection?.refresh_token || !connection.google_email) {
    return NextResponse.json({
      error: 'Gmail not connected. Connect your Gmail in the Email Triage tool, then try again.',
    }, { status: 400 });
  }

  // ── Preparer's display name (for {{preparer_name}}) ─────────────────
  const { data: me } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const preparerName = (me?.full_name?.trim() || me?.email?.split('@')[0] || 'Your accountant');

  // ── Firm settings (templates) — auto-create defaults if missing ─────
  const settings = await ensureMtdItFirmSettings(ctx.firmId);

  // ── Void any pending prior approval for this quarter ─────────────────
  if (!resend) {
    await service
      .from('mtd_it_quarter_approvals')
      .update({ voided_at: new Date().toISOString() })
      .eq('quarter_id', params.id)
      .is('approved_at', null)
      .is('changes_requested_at', null)
      .is('voided_at', null);
  }

  // ── Build approval URL + render templates ────────────────────────────
  const token = genToken();
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const approvalLink = `${siteBase || ''}/mtd-it/approve/${token}`;

  const taxYear = (q as { tax_year: number }).tax_year;
  const quarter = (q as { quarter: 1 | 2 | 3 | 4 }).quarter;
  const range = getQuarterDates(taxYear, quarter, c.mtd_it_quarter_type ?? 'calendar');
  const vars = {
    client_name:      c.name ?? '',
    client_code:      c.client_ref ?? '',
    quarter_label:    `Q${quarter}`,
    tax_year_label:   taxYearLabel(taxYear),
    period_from:      formatDateUkForTemplate(range.from),
    period_to:        formatDateUkForTemplate(range.to),
    firm_name:        c.firms?.name ?? '',
    preparer_name:    preparerName,
    approval_link:    approvalLink,
  };

  const subject = renderTemplate(settings.approval_email_subject, vars);
  let bodyText  = renderTemplate(settings.approval_email_body,    vars);
  if (cover_note && cover_note.trim()) {
    // The preparer's cover note appears at the top of the email body so it
    // feels like a personal note, with the firm-wide template below.
    bodyText = `${cover_note.trim()}\n\n${bodyText}`;
  }

  // Resolve the logo (if any) into a data URL so it can be embedded in the
  // email header. The PDF was already built client-side with the same logo,
  // so the in-email and in-PDF branding stay visually consistent.
  let logoDataUrl: string | null = null;
  if (settings.brand_logo_path) {
    try {
      const { data: logoBlob } = await service.storage.from('mtd-it-branding').download(settings.brand_logo_path);
      if (logoBlob) {
        const buf  = Buffer.from(await logoBlob.arrayBuffer());
        const mime = logoBlob.type || 'image/png';
        logoDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      }
    } catch (e) {
      console.warn('send-approval logo fetch', e);
    }
  }

  const html = buildEmailHtml({
    firmName: c.firms?.name ?? '',
    subject,
    bodyText,
    summary: summary_lines ?? [],
    cta: { label: 'Review and approve', url: approvalLink },
    footer: `If you didn't expect this email, please contact ${preparerName} at ${c.firms?.name ?? 'your accountant'}.`,
    brandHex: settings.brand_primary_color,
    logoDataUrl,
  });

  // ── Insert the approval row (so even if Gmail send fails we know we tried) ──
  const { data: approval, error: insErr } = await service
    .from('mtd_it_quarter_approvals')
    .insert({
      quarter_id:      params.id,
      token,
      sent_by:         ctx.userId,
      recipient_email,
      cover_note:      cover_note ?? null,
    })
    .select('id, token, sent_at, expires_at')
    .single();
  if (insErr || !approval) {
    console.error('POST /api/mtd-it/quarters/[id]/send-approval insert', insErr);
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 });
  }

  const attachmentFilename = `MTD-IT-${vars.client_code || 'client'}-${vars.quarter_label}-${vars.tax_year_label.replace('/', '-')}.pdf`;

  // ── Send the email via Gmail (skipped in prepare_only mode) ─────────
  if (!prepare_only) {
    try {
      const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
      const attachments = pdf_base64
        ? [{
            filename: attachmentFilename,
            mimeType: 'application/pdf',
            data: Buffer.from(pdf_base64, 'base64'),
          }]
        : [];
      const raw = buildRawMessage({
        from: connection.google_email,
        to: [recipient_email],
        subject,
        htmlBody: html,
        attachments,
      });
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch (e) {
      console.error('POST /api/mtd-it/quarters/[id]/send-approval gmail', e);
      // Roll the approval row back so the dashboard doesn't show a "sent" state for a failed send.
      await service.from('mtd_it_quarter_approvals').delete().eq('id', approval.id);
      return NextResponse.json({
        error: e instanceof Error ? e.message : 'Failed to send via Gmail',
      }, { status: 502 });
    }
  }

  // ── Flip quarter status → 'sent' (only if currently 'draft' / 'complete') ──
  // We don't downgrade 'approved' → 'sent' on resend; that's a separate
  // explicit action and would clobber audit history.
  const currentStatus = (q as { status: string }).status;
  if (currentStatus !== 'approved' && currentStatus !== 'submitted') {
    await service.from('mtd_it_quarters').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', params.id);
  }

  return NextResponse.json({
    ok: true,
    approval_id: approval.id,
    approval_url: approvalLink,
    expires_at: approval.expires_at,
    sender_email: connection.google_email,
    // Only the prepare flow uses these — surfaced unconditionally so the
    // client doesn't need a branch to type-narrow.
    subject,
    html_body: html,
    attachment_filename: attachmentFilename,
  });
}
