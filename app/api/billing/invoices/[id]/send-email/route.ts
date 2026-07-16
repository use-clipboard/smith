import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getOrCreatePortalLink } from '@/lib/billing/portalLink';
import { balancePence, fmtPence } from '@/lib/billing/totals';
import { resolveInvoiceMergeTags, type InvoiceMergeContext } from '@/lib/billing/invoiceMergeTags';
import { DEFAULT_INVOICE_EMAIL_SUBJECT, DEFAULT_INVOICE_EMAIL_BODY } from '@/lib/billing/types';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';
import { buildInvoiceEmailHtml } from '@/lib/billing/invoiceEmailHtml';
import { mapInvoiceRow, type InvoiceRow, type InvoiceLineRow } from '@/lib/billing/map';

function ukDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

interface Ctx { firmId: string; userId: string }

// Load everything needed to compose the email + resolve merge tags.
async function build(supabase: ReturnType<typeof createClient>, ctx: Ctx, invoiceId: string) {
  const [{ data: inv }, { data: settings }, { data: firm }] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', invoiceId).eq('firm_id', ctx.firmId).maybeSingle(),
    supabase.from('billing_settings').select('invoice_email_subject, invoice_email_body, email_sender_mailbox_id, business_name, invoice_accent').eq('firm_id', ctx.firmId).maybeSingle(),
    supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle(),
  ]);
  if (!inv) return null;

  let clientEmail: string | null = null;
  if (inv.client_id) {
    const { data: c } = await supabase.from('clients').select('contact_email').eq('id', inv.client_id).maybeSingle();
    clientEmail = c?.contact_email || null;
  }

  // Sender: the firm mailbox chosen for billing.
  const mailboxId = (settings?.email_sender_mailbox_id as string | null) ?? null;
  let senderEmail: string | null = null;
  if (mailboxId) {
    const { data: mb } = await supabase.from('firm_sending_mailboxes').select('google_email').eq('id', mailboxId).eq('firm_id', ctx.firmId).maybeSingle();
    senderEmail = (mb?.google_email as string | null) ?? null;
  }

  // Reuse or mint a statement-portal link for this client.
  const portalLink = await getOrCreatePortalLink(supabase, { firmId: ctx.firmId, clientId: inv.client_id, userId: ctx.userId });

  const firmName = (settings?.business_name as string) || firm?.name || 'Our practice';
  const mergeCtx: InvoiceMergeContext = {
    client_name: inv.client_name,
    invoice_number: inv.number ?? 'DRAFT',
    invoice_total: fmtPence(inv.total_pence),
    amount_due: fmtPence(balancePence(inv.total_pence, inv.amount_paid_pence, inv.credit_pence ?? 0)),
    issue_date: ukDate(inv.issue_date),
    due_date: ukDate(inv.due_date),
    firm_name: firmName,
    portal_link: portalLink,
  };
  const subjectTpl = (settings?.invoice_email_subject as string) || DEFAULT_INVOICE_EMAIL_SUBJECT;
  const bodyTpl = (settings?.invoice_email_body as string) || DEFAULT_INVOICE_EMAIL_BODY;

  return {
    inv, mailboxId, senderEmail, clientEmail, portalLink, firmName,
    accent: (settings?.invoice_accent as string | null) ?? null,
    subject: resolveInvoiceMergeTags(subjectTpl, mergeCtx),
    body: resolveInvoiceMergeTags(bodyTpl, mergeCtx),
  };
}

/** Give a draft its invoice number before the client renders the PDF —
 *  otherwise the attachment the client receives is stamped "DRAFT".
 *  Only the number is allocated here; the invoice isn't marked sent until the
 *  email actually goes, and a retry reuses the number, so no gaps in the run. */
async function ensureNumber(supabase: ReturnType<typeof createClient>, firmId: string, inv: Record<string, unknown>): Promise<string | null> {
  if (inv.number) return inv.number as string;
  const { allocateInvoiceNumber } = await import('@/lib/billing/numbering');
  const number = await allocateInvoiceNumber(supabase, firmId);
  await supabase.from('invoices').update({ number, updated_at: new Date().toISOString() }).eq('id', inv.id as string).eq('firm_id', firmId);
  return number;
}

// GET — preview: resolved subject/body, recipient, sender, and any blockers.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const b = await build(supabase, { firmId: ctx.firmId, userId: ctx.userId }, params.id);
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const warning = !b.senderEmail
    ? 'No firm email is connected for invoices. Connect one in Settings → Billing → Emails.'
    : !b.clientEmail ? 'This client has no email address on file.' : null;

  return NextResponse.json({
    to: b.clientEmail, senderEmail: b.senderEmail, subject: b.subject, body: b.body,
    portalLink: b.portalLink, ready: !!b.senderEmail && !!b.clientEmail, warning,
  });
}

const SendSchema = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().max(6000).optional(),
  /** Allocate the number and hand the invoice back, so the caller can render the
   *  PDF it will post on the real send. No email, no status change. */
  prepare: z.boolean().optional(),
  /** The rendered invoice PDF, attached to the client's email. ~14MB of base64
   *  ≈ 10MB of PDF, comfortably inside Gmail's 25MB limit. */
  pdf_base64: z.string().max(14_000_000).optional(),
});

// POST — send the invoice email from the firm mailbox and mark it sent.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const overrides = SendSchema.safeParse(await req.json().catch(() => ({})));
  const supabase = createClient();
  const b = await build(supabase, { firmId: ctx.firmId, userId: ctx.userId }, params.id);
  if (!b) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!b.clientEmail) return NextResponse.json({ error: 'This client has no email address on file.' }, { status: 400 });
  if (!b.mailboxId) return NextResponse.json({ error: 'Connect a firm email for invoices in Settings → Billing first.' }, { status: 400 });

  // ── Stage 1: prepare ──────────────────────────────────────────────────────
  // Allocate the number, then hand back the invoice so the caller can render a
  // PDF that carries it. Nothing is sent and the status is untouched.
  if (overrides.success && overrides.data.prepare) {
    const number = await ensureNumber(supabase, ctx.firmId, b.inv);
    const { data: lines } = await supabase
      .from('invoice_lines').select('*').eq('invoice_id', b.inv.id).order('position', { ascending: true });
    const invoice = mapInvoiceRow({ ...b.inv, number } as InvoiceRow, (lines ?? []) as InvoiceLineRow[]);
    return NextResponse.json({ invoice });
  }

  const sender = await resolveTaskEmailSender({ firmId: ctx.firmId, mode: 'specific', mailboxId: b.mailboxId, ownerUserId: null });
  if (!sender.ok) return NextResponse.json({ error: sender.reason }, { status: 400 });

  const subject = overrides.success && overrides.data.subject ? overrides.data.subject : b.subject;
  const bodyText = overrides.success && overrides.data.body ? overrides.data.body : b.body;

  // The invoice PDF, rendered by the caller (no server-side renderer exists).
  // Absent — an older client, or a render that failed — the email still goes,
  // with the portal link alone, exactly as it did before.
  const pdfBase64 = overrides.success ? overrides.data.pdf_base64 : undefined;
  const attachmentName = `${(b.inv.number as string | null) ?? 'Invoice'}.pdf`;
  const attachments = pdfBase64
    ? [{ filename: attachmentName, mimeType: 'application/pdf', data: Buffer.from(pdfBase64, 'base64') }]
    : [];

  const html = buildInvoiceEmailHtml({
    bodyText,
    portalLink: b.portalLink,
    firmName: b.firmName,
    accent: b.accent,
    hasAttachment: attachments.length > 0,
    attachmentName,
  });

  try {
    const raw = buildRawMessage({ from: sender.fromEmail, to: [b.clientEmail], subject, htmlBody: html, attachments });
    await sender.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  } catch (err) {
    console.error('send invoice email', err);
    return NextResponse.json({ error: 'The email could not be sent — the firm mailbox may need reconnecting.' }, { status: 502 });
  }

  // Mark the invoice sent (allocate a number if it was still a draft).
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: nowIso };
  if (b.inv.status === 'draft') {
    updates.status = 'sent';
    updates.sent_at = nowIso;
    if (!b.inv.number) {
      const { allocateInvoiceNumber } = await import('@/lib/billing/numbering');
      updates.number = await allocateInvoiceNumber(supabase, ctx.firmId);
    }
  } else if (!b.inv.sent_at) {
    updates.sent_at = nowIso;
  }
  await supabase.from('invoices').update(updates).eq('id', b.inv.id).eq('firm_id', ctx.firmId);

  // Issuing a draft by email → optionally post the sale to Bookkeeping.
  if (b.inv.status === 'draft') {
    const { postInvoiceToBookkeeping } = await import('@/lib/billing/postInvoiceToBookkeeping');
    postInvoiceToBookkeeping(supabase, { firmId: ctx.firmId, userId: ctx.userId, invoiceId: b.inv.id })
      .catch(err => console.error('postInvoiceToBookkeeping', err));
  }

  const { logBillingAudit } = await import('@/lib/billing/audit');
  await logBillingAudit(supabase, { firmId: ctx.firmId, invoiceId: b.inv.id, userId: ctx.userId, action: 'emailed', detail: b.clientEmail });

  return NextResponse.json({ ok: true, sentTo: b.clientEmail });
}
