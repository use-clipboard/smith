'use client';

// Billing module — render the invoice document to a real PDF file, for emailing.
// The rendering itself lives in renderPdf.ts (shared with statements).

import { buildInvoiceHtml, type InvoiceLetterhead } from './invoicePdf';
import type { Invoice } from './types';
import { renderHtmlPdfBlob, renderHtmlPdfBase64 } from './renderPdf';

export async function renderInvoicePdfBlob(invoice: Invoice, letterhead: InvoiceLetterhead): Promise<Blob> {
  return renderHtmlPdfBlob(buildInvoiceHtml(invoice, letterhead));
}

export async function renderInvoicePdfBase64(invoice: Invoice, letterhead: InvoiceLetterhead): Promise<string> {
  return renderHtmlPdfBase64(buildInvoiceHtml(invoice, letterhead));
}

/** "INV-0042.pdf" — what the client sees in their inbox. */
export function invoicePdfFilename(invoice: Invoice): string {
  const safe = (invoice.number ?? 'Invoice').replace(/[^\w\-. ]+/g, '').trim() || 'Invoice';
  return `${safe}.pdf`;
}
