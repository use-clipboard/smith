// Billing module — "send test to yourself".
//
// Sends the invoice email exactly as a client would receive it (same template,
// same builder, same firm mailbox, sample invoice PDF attached) to the signed-in
// user's own address. Nothing is recorded: no invoice, no audit row, no portal
// token — it never touches a client.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { resolveInvoiceMergeTags } from '@/lib/billing/invoiceMergeTags';
import { sampleMergeContext } from '@/lib/billing/sampleInvoice';
import { buildInvoiceEmailHtml } from '@/lib/billing/invoiceEmailHtml';
import { DEFAULT_INVOICE_EMAIL_SUBJECT, DEFAULT_INVOICE_EMAIL_BODY } from '@/lib/billing/types';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';

const Schema = z.object({
  // Test what's on screen, not what was last saved.
  subject: z.string().max(300).optional(),
  body: z.string().max(6000).optional(),
  pdf_base64: z.string().max(14_000_000).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can send a test invoice email.' }, { status: 403 });
  if (!ctx.email) return NextResponse.json({ error: 'Your account has no email address to send a test to.' }, { status: 400 });

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const supabase = createClient();
  const [{ data: settings }, { data: firm }] = await Promise.all([
    supabase.from('billing_settings')
      .select('invoice_email_subject, invoice_email_body, email_sender_mailbox_id, business_name, invoice_accent, invoice_prefix, next_invoice_number')
      .eq('firm_id', ctx.firmId).maybeSingle(),
    supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle(),
  ]);

  const mailboxId = (settings?.email_sender_mailbox_id as string | null) ?? null;
  if (!mailboxId) {
    return NextResponse.json({ error: 'Connect a firm email above first — the test sends from the same mailbox your invoices do.' }, { status: 400 });
  }

  const sender = await resolveTaskEmailSender({ firmId: ctx.firmId, mode: 'specific', mailboxId, ownerUserId: null });
  if (!sender.ok) return NextResponse.json({ error: sender.reason }, { status: 400 });

  const firmName = (settings?.business_name as string) || firm?.name || 'Our practice';
  const prefix = (settings?.invoice_prefix as string | null) ?? 'INV-';
  const next = (settings?.next_invoice_number as number | null) ?? 1;

  // The pay button has no real client behind it, so it points at the app rather
  // than a statement portal. Everything else is exactly the client's email.
  const mergeCtx = sampleMergeContext({
    number: `${prefix}${String(next).padStart(4, '0')}`,
    firmName,
    portalLink: getBaseUrl(),
  });

  const subjectTpl = parsed.data.subject || (settings?.invoice_email_subject as string) || DEFAULT_INVOICE_EMAIL_SUBJECT;
  const bodyTpl = parsed.data.body || (settings?.invoice_email_body as string) || DEFAULT_INVOICE_EMAIL_BODY;

  const attachmentName = `${mergeCtx.invoice_number}.pdf`;
  const attachments = parsed.data.pdf_base64
    ? [{ filename: attachmentName, mimeType: 'application/pdf', data: Buffer.from(parsed.data.pdf_base64, 'base64') }]
    : [];

  const html = buildInvoiceEmailHtml({
    bodyText: resolveInvoiceMergeTags(bodyTpl, mergeCtx),
    portalLink: mergeCtx.portal_link,
    firmName,
    accent: (settings?.invoice_accent as string | null) ?? null,
    hasAttachment: attachments.length > 0,
    attachmentName,
  });

  try {
    const raw = buildRawMessage({
      from: sender.fromEmail,
      to: [ctx.email],
      subject: resolveInvoiceMergeTags(subjectTpl, mergeCtx),
      htmlBody: html,
      attachments,
    });
    await sender.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  } catch (err) {
    console.error('billing test email', err);
    return NextResponse.json({ error: 'The test could not be sent — the firm mailbox may need reconnecting.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sentTo: ctx.email });
}
