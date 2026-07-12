import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import type { BillingSettings } from '@/lib/billing/types';
import { DEFAULT_INVOICE_EMAIL_SUBJECT, DEFAULT_INVOICE_EMAIL_BODY } from '@/lib/billing/types';

const DEFAULTS: BillingSettings = {
  invoicePrefix: 'INV-',
  nextInvoiceNumber: 1,
  creditNotePrefix: 'CN-',
  nextCreditNoteNumber: 1,
  defaultPaymentTermsDays: 14,
  defaultVatRate: 20,
  postToBookkeeping: false,
  bookkeepingSalesAccount: null,
  paymentProvider: 'stripe',
  firstInvoiceMode: 'card_now',
  businessName: '',
  businessAddress: '',
  vatNumber: '',
  bankDetails: '',
  invoiceFooter: '',
  autoChaseEnabled: false,
  chaseWeekdaysOnly: true,
  chaseMinBalancePence: 0,
  chaseReplyTo: '',
  vatRegistered: true,
  emailSenderMailboxId: null,
  invoiceEmailSubject: DEFAULT_INVOICE_EMAIL_SUBJECT,
  invoiceEmailBody: DEFAULT_INVOICE_EMAIL_BODY,
};

// GET /api/billing/settings → firm billing config (defaults if not yet created).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const [{ data }, { data: firm }] = await Promise.all([
    supabase.from('billing_settings').select('*').eq('firm_id', ctx.firmId).maybeSingle(),
    supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle(),
  ]);

  const canEdit = ctx.userRole === 'admin';
  const firmName = firm?.name ?? '';

  if (!data) return NextResponse.json({ ...DEFAULTS, canEdit, firmName });

  const settings: BillingSettings = {
    invoicePrefix: data.invoice_prefix ?? DEFAULTS.invoicePrefix,
    nextInvoiceNumber: data.next_invoice_number ?? DEFAULTS.nextInvoiceNumber,
    creditNotePrefix: data.credit_note_prefix ?? DEFAULTS.creditNotePrefix,
    nextCreditNoteNumber: data.next_credit_note_number ?? DEFAULTS.nextCreditNoteNumber,
    defaultPaymentTermsDays: data.default_payment_terms_days ?? DEFAULTS.defaultPaymentTermsDays,
    defaultVatRate: Number(data.default_vat_rate ?? DEFAULTS.defaultVatRate),
    postToBookkeeping: data.post_to_bookkeeping ?? false,
    bookkeepingSalesAccount: data.bookkeeping_sales_account ?? null,
    paymentProvider: data.payment_provider ?? DEFAULTS.paymentProvider,
    firstInvoiceMode: data.first_invoice_mode ?? DEFAULTS.firstInvoiceMode,
    businessName: data.business_name ?? '',
    businessAddress: data.business_address ?? '',
    vatNumber: data.vat_number ?? '',
    bankDetails: data.bank_details ?? '',
    invoiceFooter: data.invoice_footer ?? '',
    autoChaseEnabled: data.auto_chase_enabled ?? false,
    chaseWeekdaysOnly: data.chase_weekdays_only ?? true,
    chaseMinBalancePence: data.chase_min_balance_pence ?? 0,
    chaseReplyTo: data.chase_reply_to ?? '',
    vatRegistered: data.vat_registered ?? true,
    emailSenderMailboxId: data.email_sender_mailbox_id ?? null,
    invoiceEmailSubject: data.invoice_email_subject || DEFAULT_INVOICE_EMAIL_SUBJECT,
    invoiceEmailBody: data.invoice_email_body || DEFAULT_INVOICE_EMAIL_BODY,
  };

  return NextResponse.json({ ...settings, canEdit, firmName });
}

const UpdateSchema = z.object({
  invoicePrefix: z.string().max(12).optional(),
  creditNotePrefix: z.string().max(12).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultVatRate: z.number().min(0).max(100).optional(),
  postToBookkeeping: z.boolean().optional(),
  bookkeepingSalesAccount: z.string().max(120).nullable().optional(),
  firstInvoiceMode: z.enum(['card_now', 'wait_for_dd']).optional(),
  businessName: z.string().max(200).optional(),
  businessAddress: z.string().max(600).optional(),
  vatNumber: z.string().max(40).optional(),
  bankDetails: z.string().max(600).optional(),
  invoiceFooter: z.string().max(600).optional(),
  autoChaseEnabled: z.boolean().optional(),
  chaseWeekdaysOnly: z.boolean().optional(),
  chaseMinBalancePence: z.number().int().min(0).max(100_000_000).optional(),
  chaseReplyTo: z.string().max(200).optional(),
  vatRegistered: z.boolean().optional(),
  emailSenderMailboxId: z.string().uuid().nullable().optional(),
  invoiceEmailSubject: z.string().max(300).optional(),
  invoiceEmailBody: z.string().max(4000).optional(),
});

// PUT /api/billing/settings — save firm billing config (admin only).
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const patch: Record<string, unknown> = { firm_id: ctx.firmId, updated_at: new Date().toISOString() };
  const p = parsed.data;
  if (p.invoicePrefix !== undefined) patch.invoice_prefix = p.invoicePrefix;
  if (p.creditNotePrefix !== undefined) patch.credit_note_prefix = p.creditNotePrefix;
  if (p.defaultPaymentTermsDays !== undefined) patch.default_payment_terms_days = p.defaultPaymentTermsDays;
  if (p.defaultVatRate !== undefined) patch.default_vat_rate = p.defaultVatRate;
  if (p.postToBookkeeping !== undefined) patch.post_to_bookkeeping = p.postToBookkeeping;
  if (p.bookkeepingSalesAccount !== undefined) patch.bookkeeping_sales_account = p.bookkeepingSalesAccount;
  if (p.firstInvoiceMode !== undefined) patch.first_invoice_mode = p.firstInvoiceMode;
  if (p.businessName !== undefined) patch.business_name = p.businessName;
  if (p.businessAddress !== undefined) patch.business_address = p.businessAddress;
  if (p.vatNumber !== undefined) patch.vat_number = p.vatNumber;
  if (p.bankDetails !== undefined) patch.bank_details = p.bankDetails;
  if (p.invoiceFooter !== undefined) patch.invoice_footer = p.invoiceFooter;
  if (p.autoChaseEnabled !== undefined) patch.auto_chase_enabled = p.autoChaseEnabled;
  if (p.chaseWeekdaysOnly !== undefined) patch.chase_weekdays_only = p.chaseWeekdaysOnly;
  if (p.chaseMinBalancePence !== undefined) patch.chase_min_balance_pence = p.chaseMinBalancePence;
  if (p.chaseReplyTo !== undefined) patch.chase_reply_to = p.chaseReplyTo;
  if (p.vatRegistered !== undefined) patch.vat_registered = p.vatRegistered;
  if (p.emailSenderMailboxId !== undefined) patch.email_sender_mailbox_id = p.emailSenderMailboxId;
  if (p.invoiceEmailSubject !== undefined) patch.invoice_email_subject = p.invoiceEmailSubject;
  if (p.invoiceEmailBody !== undefined) patch.invoice_email_body = p.invoiceEmailBody;

  const supabase = createClient();
  const { error } = await supabase
    .from('billing_settings')
    .upsert(patch, { onConflict: 'firm_id' });
  if (error) return NextResponse.json({ error: 'Could not save settings' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
