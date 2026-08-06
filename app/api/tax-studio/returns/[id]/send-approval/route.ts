import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { buildApprovalEmailHtml } from '@/lib/accounts-studio/approvalEmail';
import { logTaxAudit } from '@/lib/tax-studio/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/tax-studio/returns/[id]/send-approval
// Emails the SA100 approval pack to the client (via the preparer's Gmail),
// records a tokened tax_studio_return_approvals row, and sets the return's
// approvalStatus -> 'sent'. `prepare_only` (Email Triage) returns the rendered
// email for the in-app compose window instead of sending.
const BodySchema = z.object({
  recipient_email: z.string().email(),
  cover_note: z.string().nullable().optional(),
  pdf_base64: z.string().nullable().optional(),
  summary_lines: z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  prepare_only: z.boolean().optional(),
});

const genToken = () => randomBytes(24).toString('base64url');

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { recipient_email, cover_note, pdf_base64, summary_lines, prepare_only } = parsed.data;

  const supabase = createClient();
  const service = createServiceClient();

  const { data: row } = await supabase
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
  const d = (row.data ?? {}) as Record<string, unknown>;
  const clientName = (d.clientName as string) ?? 'Client';
  const taxYear = (d.taxYear as string) ?? '';

  const { data: connection } = await supabase
    .from('email_connections').select('refresh_token, google_email').eq('user_id', ctx.userId).maybeSingle();
  if (!prepare_only && (!connection?.refresh_token || !connection.google_email)) {
    return NextResponse.json({ error: 'Gmail not connected. Connect your Gmail in the Email Triage tool, then try again.' }, { status: 400 });
  }

  const { data: firm } = await supabase.from('firms').select('name, logo_url').eq('id', ctx.firmId).maybeSingle();
  const { data: me } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const firmName = firm?.name ?? 'Your accountant';
  const preparerName = me?.full_name?.trim() || me?.email?.split('@')[0] || 'Your accountant';

  // Void any pending prior approval for this return.
  await service.from('tax_studio_return_approvals')
    .update({ voided_at: new Date().toISOString() })
    .eq('return_id', params.id).is('approved_at', null).is('changes_requested_at', null).is('voided_at', null);

  const token = genToken();
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const approvalUrl = `${siteBase}/tax-studio/approve/${token}`;

  const subject = `Your ${taxYear} tax return — please review and approve`;
  let bodyText = `Hello,\n\n${preparerName} at ${firmName} has prepared your ${taxYear} Self Assessment tax return. Please review the figures — the tax computation, your return, and what to pay and when are in the attached pack.\n\nWhen you're happy, click the button below to approve it for submission to HMRC. If anything needs changing, choose "Request changes" and let us know.`;
  if (cover_note && cover_note.trim()) bodyText = `${cover_note.trim()}\n\n${bodyText}`;

  const baseEmailArgs = { firmName, bodyText, approvalUrl, summary: summary_lines ?? [], brandHex: null, logoUrl: firm?.logo_url ?? null };
  const html = buildApprovalEmailHtml(baseEmailArgs);

  const { data: approval, error: insErr } = await service
    .from('tax_studio_return_approvals')
    .insert({ return_id: params.id, firm_id: ctx.firmId, token, sent_by: ctx.userId, recipient_email, cover_note: cover_note ?? null })
    .select('id').single();
  if (insErr || !approval) {
    console.error('[tax-studio send-approval] insert', insErr);
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 });
  }

  const attachmentFilename = `Tax_Return_${clientName.replace(/\s+/g, '_')}_${taxYear.replace('/', '-')}.pdf`;

  if (!prepare_only && connection) {
    try {
      const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
      let signatureHtml: string | null = null;
      try {
        const sendAs = await gmail.users.settings.sendAs.list({ userId: 'me' });
        const list = sendAs.data.sendAs ?? [];
        const chosen = list.find(a => a.isDefault) ?? list.find(a => a.sendAsEmail === connection.google_email) ?? list[0];
        signatureHtml = chosen?.signature || null;
      } catch { /* best-effort */ }
      const sendHtml = signatureHtml ? buildApprovalEmailHtml({ ...baseEmailArgs, signatureHtml }) : html;
      const attachments = pdf_base64 ? [{ filename: attachmentFilename, mimeType: 'application/pdf', data: Buffer.from(pdf_base64, 'base64') }] : [];
      const raw = buildRawMessage({ from: connection.google_email, to: [recipient_email], subject, htmlBody: sendHtml, attachments });
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch (err) {
      console.error('[tax-studio send-approval] gmail', err);
      await service.from('tax_studio_return_approvals').delete().eq('id', approval.id);
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send via Gmail' }, { status: 502 });
    }
  }

  if (!prepare_only) {
    await logTaxAudit({ firmId: ctx.firmId, returnId: params.id, clientId: (d.clientId as string | null) ?? null, clientName, actorId: ctx.userId, action: 'sent', summary: `Sent to ${recipient_email} for approval` });
    const status = d.approvalStatus as string | undefined;
    if (status !== 'approved' && status !== 'submitted') {
      await supabase.from('tax_studio_returns')
        .update({ data: { ...d, approvalStatus: 'sent', sentAt: new Date().toISOString() }, updated_at: new Date().toISOString() })
        .eq('id', params.id).eq('firm_id', ctx.firmId);
    }
  }

  return NextResponse.json({ ok: true, approvalUrl, senderEmail: connection?.google_email, subject, htmlBody: html, attachmentFilename });
}
