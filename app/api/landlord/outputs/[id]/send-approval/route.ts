import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { renderTemplate, buildEmailHtml, formatDateUkForTemplate } from '@/lib/mtdIt/emailTemplates';
import { ensureLandlordFirmSettings } from '@/lib/landlord/firmSettings';

// POST /api/landlord/outputs/[id]/send-approval
//   Body: { recipient_email, cover_note, pdf_base64, person_key?, person_name?, summary_lines?, prepare_only? }
//
// Mirrors the MTD IT approval send:
//   1. Verifies firm scope + the preparer has Gmail connected.
//   2. Voids any pending approval for the SAME recipient scope (per person, so
//      sending to one owner doesn't void another's).
//   3. Creates a landlord_approvals row with a fresh token.
//   4. Renders subject + body from the firm's templates.
//   5. Sends via the preparer's Gmail with the PDF attached — OR, in
//      prepare_only mode, returns the rendered email so the caller can hand it
//      to the in-app compose window (Email Triage flow).
//
// person_key null → the combined computation for the whole portfolio.
// person_key set  → a per-individual report; one row (and token) per person.

const BodySchema = z.object({
  recipient_email: z.string().email(),
  cover_note:      z.string().nullable().optional(),
  pdf_base64:      z.string().nullable().optional(),
  person_key:      z.string().nullable().optional(),
  person_name:     z.string().nullable().optional(),
  summary_lines:   z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  prepare_only:    z.boolean().optional(),
});

function genToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { recipient_email, cover_note, pdf_base64, person_key, person_name, summary_lines, prepare_only } = parsed.data;

  const supabase = createClient();
  const service  = createServiceClient();

  // ── Load the analysis + firm scope ──────────────────────────────────
  const { data: out } = await supabase
    .from('outputs')
    .select('id, firm_id, client_id, client_name, result_data, clients(name, client_ref)')
    .eq('id', params.id)
    .eq('feature', 'landlord_analysis')
    .maybeSingle();
  if (!out || out.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }
  const clientRow = (out as unknown as { clients?: { name?: string; client_ref?: string | null } }).clients;
  const rd = (out.result_data ?? {}) as { dateFrom?: string; dateTo?: string };

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

  const { data: me } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const preparerName = (me?.full_name?.trim() || me?.email?.split('@')[0] || 'Your accountant');

  const { data: firm } = await supabase.from('firms').select('name, logo_url').eq('id', ctx.firmId).maybeSingle();
  const settings = await ensureLandlordFirmSettings(ctx.firmId);

  // ── Void any pending approval for the same scope ────────────────────
  // Scoped by person so a per-individual send doesn't void a co-owner's.
  {
    let q = service
      .from('landlord_approvals')
      .update({ voided_at: new Date().toISOString() })
      .eq('output_id', params.id)
      .is('approved_at', null)
      .is('changes_requested_at', null)
      .is('voided_at', null);
    q = person_key ? q.eq('person_key', person_key) : q.is('person_key', null);
    await q;
  }

  // ── Token + templates ───────────────────────────────────────────────
  const token = genToken();
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const approvalLink = `${siteBase || ''}/landlord/approve/${token}`;

  const clientName = clientRow?.name ?? out.client_name ?? '';
  const vars = {
    client_name:   clientName,
    client_code:   clientRow?.client_ref ?? '',
    person_name:   person_name || clientName,
    period_from:   rd.dateFrom ? formatDateUkForTemplate(rd.dateFrom) : '',
    period_to:     rd.dateTo ? formatDateUkForTemplate(rd.dateTo) : '',
    firm_name:     firm?.name ?? '',
    preparer_name: preparerName,
    approval_link: approvalLink,
  };

  const subject = renderTemplate(settings.approval_email_subject, vars);
  let bodyText  = renderTemplate(settings.approval_email_body, vars);
  if (cover_note && cover_note.trim()) bodyText = `${cover_note.trim()}\n\n${bodyText}`;

  const html = buildEmailHtml({
    firmName: firm?.name ?? '',
    subject,
    bodyText,
    summary: summary_lines ?? [],
    cta: { label: 'Review and approve', url: approvalLink },
    footer: `If you didn't expect this email, please contact ${preparerName} at ${firm?.name ?? 'your accountant'}.`,
    brandHex: settings.brand_primary_color,
    logoDataUrl: firm?.logo_url ?? null,
  });

  const { data: approval, error: insErr } = await service
    .from('landlord_approvals')
    .insert({
      output_id:       params.id,
      token,
      person_key:      person_key ?? null,
      person_name:     person_name ?? null,
      sent_by:         ctx.userId,
      recipient_email,
      cover_note:      cover_note ?? null,
    })
    .select('id, token, sent_at, expires_at')
    .single();
  if (insErr || !approval) {
    console.error('POST /api/landlord/outputs/[id]/send-approval insert', insErr);
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 });
  }

  const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').slice(0, 60);
  const attachmentFilename = person_name
    ? `Property-income-${safe(vars.client_code || clientName || 'client')}-${safe(person_name)}.pdf`
    : `Property-income-${safe(vars.client_code || clientName || 'client')}.pdf`;

  // ── Send via Gmail (skipped in prepare_only / compose mode) ──────────
  if (!prepare_only) {
    try {
      const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
      const attachments = pdf_base64
        ? [{ filename: attachmentFilename, mimeType: 'application/pdf', data: Buffer.from(pdf_base64, 'base64') }]
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
      console.error('POST /api/landlord/outputs/[id]/send-approval gmail', e);
      // Roll the row back so we don't show "sent" for a failed send.
      await service.from('landlord_approvals').delete().eq('id', approval.id);
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send via Gmail' }, { status: 502 });
    }
  }

  return NextResponse.json({
    ok: true,
    approval_id: approval.id,
    approval_url: approvalLink,
    expires_at: approval.expires_at,
    sender_email: connection.google_email,
    subject,
    html_body: html,
    attachment_filename: attachmentFilename,
  });
}
