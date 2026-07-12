// Billing module — shared types. All money is integer pence.

export type InvoiceStatus =
  | 'draft' | 'sent' | 'viewed' | 'part_paid' | 'paid' | 'overdue' | 'cancelled' | 'bad_debt';

export type InvoiceSource = 'manual' | 'recurring' | 'proposal' | 'timesheet' | 'advisory';

export type PaymentMethod = 'manual' | 'stripe_card' | 'stripe_bacs_dd' | 'csv_import';

export interface InvoiceLine {
  id?: string;
  description: string;
  quantity: number;
  unitPricePence: number;
  vatRate: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  position?: number;
}

export interface Invoice {
  id: string;
  clientId: string | null;
  clientName: string | null;
  number: string | null;
  status: InvoiceStatus;
  issueDate: string | null;   // ISO yyyy-mm-dd
  dueDate: string | null;
  currency: string;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  amountPaidPence: number;
  creditPence: number;
  balancePence: number;       // derived: total - paid - credit
  notes: string | null;
  terms: string | null;
  source: InvoiceSource;
  autoChase: boolean;
  createdAt: string;
  lines?: InvoiceLine[];
}

export type RecurrenceFrequency = 'monthly' | 'quarterly' | 'annual' | 'custom';
export type RecurringStatus = 'active' | 'paused';

export interface RecurringTemplateLine {
  description: string;
  quantity: number;
  unitPricePence: number;
  vatRate: number;
}

export interface RecurringInvoice {
  id: string;
  clientId: string | null;
  clientName: string | null;
  frequency: RecurrenceFrequency;
  intervalDays: number | null;
  dayOfMonth: number | null;
  startDate: string;
  nextRunDate: string;
  endDate: string | null;
  status: RecurringStatus;
  template: RecurringTemplateLine[];
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  notes: string | null;
  terms: string | null;
  autoSend: boolean;
  sourceNote: string | null;
  lastRunDate: string | null;
  createdAt: string;
}

// ─── Credit control ─────────────────────────────────────────────────────────
export type ChaserTone = 'friendly' | 'reminder' | 'firm' | 'final' | 'legal';
export type CreditControlEventType =
  | 'reminder_sent' | 'call_logged' | 'promise_to_pay' | 'escalated' | 'note' | 'paused' | 'resumed';

export interface CreditControlStage {
  id: string;
  position: number;
  stageKey: string;
  name: string;
  tone: ChaserTone;
  offsetDays: number;   // relative to due date; negative = before due
  subject: string;
  body: string;
  enabled: boolean;
}

export interface CreditControlEvent {
  id: string;
  invoiceId: string | null;
  type: CreditControlEventType;
  stageKey: string | null;
  stageName: string | null;
  channel: string | null;
  subject: string | null;
  body: string | null;
  promisedDate: string | null;
  promisedAmountPence: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreditNote {
  id: string;
  number: string | null;
  invoiceId: string | null;
  amountPence: number;
  reason: string | null;
  status: string;
  createdAt: string;
}

export interface BillingSettings {
  invoicePrefix: string;
  nextInvoiceNumber: number;
  creditNotePrefix: string;
  nextCreditNoteNumber: number;
  defaultPaymentTermsDays: number;
  defaultVatRate: number;
  postToBookkeeping: boolean;
  bookkeepingSalesAccount: string | null;
  paymentProvider: string;
  firstInvoiceMode: 'card_now' | 'wait_for_dd';
  // Invoice letterhead / remittance (shown on the PDF).
  businessName: string;
  businessAddress: string;
  vatNumber: string;
  bankDetails: string;
  invoiceFooter: string;
  // Auto-chaser.
  autoChaseEnabled: boolean;
  chaseWeekdaysOnly: boolean;
  chaseMinBalancePence: number;
  chaseReplyTo: string;
  // VAT + invoice email (Tier 1).
  vatRegistered: boolean;
  emailSenderMailboxId: string | null;
  invoiceEmailSubject: string;
  invoiceEmailBody: string;
  // Invoice design + terms + bookkeeping (Tier 2).
  invoiceAccent: string;                 // hex
  invoiceTemplate: 'modern' | 'classic' | 'minimal';
  defaultTerms: string;                  // printed on every invoice
  bookkeepingBookId: string | null;      // target book for posting sales
  hasLogo: boolean;                      // whether a logo is uploaded
}

/** Sensible default invoice-email template (used when the firm hasn't set one). */
export const DEFAULT_INVOICE_EMAIL_SUBJECT = 'Invoice {{invoice_number}} from {{firm_name}}';
export const DEFAULT_INVOICE_EMAIL_BODY =
  'Dear {{client_name}},\n\n' +
  'Please find your invoice {{invoice_number}} for {{invoice_total}}, due {{due_date}}.\n\n' +
  'You can view and pay it securely online using the button below.\n\n' +
  'Kind regards,\n{{firm_name}}';

/** Aged-debtor bucket totals (pence) for the Overview donut. */
export interface AgedDebtors {
  current: number;   // 0–30 days
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export interface BillingOverview {
  salesThisMonthPence: number;
  salesDeltaRatio: number;          // vs last month, e.g. 0.12
  outstandingPence: number;
  outstandingCount: number;
  overduePence: number;
  overdueCount: number;
  cashThisMonthPence: number;
  averageDaysToPay: number;
  averageDaysDelta: number;         // vs prior, negative = improving
  aged: AgedDebtors;
  cashFlow: { label: string; invoicedPence: number; paidPence: number }[];
  statusCounts: { status: InvoiceStatus; count: number; totalPence: number }[];
  recent: Invoice[];
  topDebtors: { clientId: string | null; clientName: string; balancePence: number; oldestDays: number }[];
  hasData: boolean;
}
