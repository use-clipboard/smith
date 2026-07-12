import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { balancePence, fmtPence } from '@/lib/billing/totals';
import { resolveInvoiceMergeTags, type InvoiceMergeContext } from '@/lib/billing/invoiceMergeTags';
import { DEFAULT_INVOICE_EMAIL_SUBJECT, DEFAULT_INVOICE_EMAIL_BODY } from '@/lib/billing/types';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';

function ukDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

interface Ctx { firmId: string; userId: string }

// Load everything needed to compose the email + resolve merge tags.
async function build(supabase: ReturnType<typeof createClient>, ctx: Ctx, invoiceId: string) {
  const [{ data: inv }, { data: settings }, { data: firm }] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', invoiceId).eq('firm_id', ctx.firmId).maybeSingle(),
    supabase.from('billing_settings').select('invoice_email_subject, invoice_email_body, email_sender_mailbox_id, business_name').eq('firm_id', ctx.firmId).maybeSingle(),
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
  let portalLink = '';
  if (inv.client_id) {
    const nowIso = new Date().toISOString();
    const { data: tok } = await supabase.from('billing_portal_tokens').select('token').eq('firm_id', ctx.firmId).eq('client_id', inv.client_id).gt('expires_at', nowIso).order('created_at', { ascending: false }).limit(1).maybeSingle();
    let token = tok?.token as string | undefined;
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      await supabase.from('billing_portal_tokens').insert({ firm_id: ctx.firmId, client_id: inv.client_id, token, created_by: ctx.userId });
    }
    portalLink = `${getBaseUrl()}/statement/${token}`;
  }

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
    subject: resolveInvoiceMergeTags(subjectTpl, mergeCtx),
    body: resolveInvoiceMergeTags(bodyTpl, mergeCtx),
  };
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
    ? 'No firm email is connected for invoices. Connect one in Billing → Settings → Invoice emails.'
    : !b.clientEmail ? 'This client has no email address on file.' : null;

  return NextResponse.json({
    to: b.clientEmail, senderEmail: b.senderEmail, subject: b.subject, body: b.body,
    portalLink: b.portalLink, ready: !!b.senderEmail && !!b.clientEmail, warning,
  });
}

const SendSchema = z.object({ subject: z.string().max(300).optional(), body: z.string().max(6000).optional() });

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
  if (!b.mailboxId) return NextResponse.json({ error: 'Connect a firm email for invoices in Billing → Settings first.' }, { status: 400 });

  const sender = await resolveTaskEmailSender({ firmId: ctx.firmId, mode: 'specific', mailboxId: b.mailboxId, ownerUserId: null });
  if (!sender.ok) return NextResponse.json({ error: sender.reason }, { status: 400 });

  const subject = overrides.success && overrides.data.subject ? overrides.data.subject : b.subject;
  const bodyText = overrides.success && overrides.data.body ? overrides.data.body : b.body;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f0f1a;line-height:1.6">
    <p style="white-space:pre-wrap;margin:0 0 16px">${esc(bodyText)}</p>
    ${b.portalLink ? `<p style="margin:0 0 16px"><a href="${esc(b.portalLink)}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">View &amp; pay invoice</a></p>` : ''}
    <p style="font-size:12px;color:#9ca3af;margin:24px 0 0">${esc(b.firmName)}</p>
  </div>`;

  try {
    const raw = buildRawMessage({ from: sender.fromEmail, to: [b.clientEmail], subject, htmlBody: html });
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

  return NextResponse.json({ ok: true, sentTo: b.clientEmail });
}
