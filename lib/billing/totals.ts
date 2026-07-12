// Billing module — pure pence math for invoice totals. No rounding surprises:
// every intermediate is computed and rounded to whole pence.

import type { InvoiceLine } from './types';

export interface LineInput {
  description?: string;
  quantity: number;
  unitPricePence: number;
  vatRate: number; // percent, e.g. 20
  position?: number;
}

/** Compute net/vat/gross for a single line, rounded to whole pence. */
export function computeLine(input: LineInput): InvoiceLine {
  const qty = Number.isFinite(input.quantity) ? input.quantity : 0;
  const unit = Math.round(input.unitPricePence || 0);
  const net = Math.round(qty * unit);
  const rate = Number.isFinite(input.vatRate) ? input.vatRate : 0;
  const vat = Math.round((net * rate) / 100);
  return {
    description: input.description ?? '',
    quantity: qty,
    unitPricePence: unit,
    vatRate: rate,
    netPence: net,
    vatPence: vat,
    grossPence: net + vat,
    position: input.position ?? 0,
  };
}

export interface InvoiceTotals {
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  lines: InvoiceLine[];
}

/** Compute an invoice's subtotal / VAT / total from its raw lines. */
export function computeInvoiceTotals(rawLines: LineInput[]): InvoiceTotals {
  const lines = rawLines.map((l, i) => computeLine({ ...l, position: l.position ?? i }));
  const subtotalPence = lines.reduce((s, l) => s + l.netPence, 0);
  const vatPence = lines.reduce((s, l) => s + l.vatPence, 0);
  return { subtotalPence, vatPence, totalPence: subtotalPence + vatPence, lines };
}

/** Outstanding balance on an invoice = total − paid − credited. */
export function balancePence(totalPence: number, amountPaidPence: number, creditPence = 0): number {
  return Math.max(0, (totalPence || 0) - (amountPaidPence || 0) - (creditPence || 0));
}

/** Format integer pence as a GBP string, e.g. 2875000 → "£28,750.00". */
export function fmtPence(pence: number, opts: { showZeroDecimals?: boolean } = {}): string {
  const pounds = (pence || 0) / 100;
  return pounds.toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: opts.showZeroDecimals === false ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Compact GBP for axis labels / KPIs, e.g. 2875000 → "£28.8k". */
export function fmtPenceCompact(pence: number): string {
  const pounds = (pence || 0) / 100;
  if (Math.abs(pounds) >= 1000) {
    return `£${(pounds / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k`;
  }
  return `£${pounds.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}
