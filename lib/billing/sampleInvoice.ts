// Billing module — the specimen invoice used by the branding preview.
//
// Deliberately a realistic practice bill (accounts + payroll + VAT work) rather
// than "Item 1 / £100", so what an admin previews reads like what their clients
// will actually receive. Nothing here is persisted — it never leaves the browser.

import type { Invoice, InvoiceLine } from './types';
import { fmtPence } from './totals';
import type { InvoiceMergeContext } from './invoiceMergeTags';

interface SampleOpts {
  /** The firm's real next invoice number, e.g. "INV-0042". */
  number?: string;
  /** 0 when the firm isn't VAT registered, so the preview matches their invoices. */
  vatRate?: number;
}

const SAMPLE_LINES: { description: string; quantity: number; unitPricePence: number }[] = [
  { description: 'Annual accounts and corporation tax return — year ended 31 March 2026', quantity: 1, unitPricePence: 95_000 },
  { description: 'Payroll — monthly RTI submissions (April–June)', quantity: 3, unitPricePence: 4_500 },
  { description: 'VAT return — quarter ended 30 June 2026', quantity: 1, unitPricePence: 22_500 },
];

export function buildSampleInvoice(opts: SampleOpts = {}): Invoice {
  const vatRate = opts.vatRate ?? 20;

  const lines: InvoiceLine[] = SAMPLE_LINES.map((l, i) => {
    const netPence = l.quantity * l.unitPricePence;
    const vatPence = Math.round(netPence * (vatRate / 100));
    return { ...l, vatRate, netPence, vatPence, grossPence: netPence + vatPence, position: i };
  });

  const subtotalPence = lines.reduce((s, l) => s + l.netPence, 0);
  const vatPence = lines.reduce((s, l) => s + l.vatPence, 0);
  const totalPence = subtotalPence + vatPence;

  return {
    id: 'sample',
    clientId: null,
    clientName: 'Northgate Joinery Ltd',
    number: opts.number?.trim() || 'INV-0042',
    status: 'sent',
    issueDate: '2026-07-01',
    dueDate: '2026-07-31',
    currency: 'GBP',
    subtotalPence,
    vatPence,
    totalPence,
    amountPaidPence: 0,
    creditPence: 0,
    balancePence: totalPence,
    notes: 'Fees as agreed in our engagement letter dated 12 April 2026.',
    terms: null,
    source: 'manual',
    autoChase: false,
    createdAt: '2026-07-01T09:00:00.000Z',
    lines,
  };
}

/** Merge tags for the sample invoice — so the previewed/test email quotes the
 *  same client, number and figures as the specimen PDF attached to it. */
export function sampleMergeContext(opts: SampleOpts & { firmName?: string; portalLink?: string } = {}): InvoiceMergeContext {
  const inv = buildSampleInvoice(opts);
  return {
    client_name: inv.clientName,
    client_code: 'K278',
    invoice_number: inv.number,
    invoice_total: fmtPence(inv.totalPence),
    amount_due: fmtPence(inv.balancePence),
    issue_date: '01-07-2026',
    due_date: '31-07-2026',
    firm_name: opts.firmName || 'Your firm',
    portal_link: opts.portalLink ?? '',
  };
}
