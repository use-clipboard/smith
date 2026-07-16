'use client';

// Billing module — load the firm's letterhead for the invoice document.
//
// Settings and logo live behind two endpoints and the field names differ from
// InvoiceLetterhead's, so every caller used to redo the same mapping by hand.
// One place now: the PDF export, the bulk email loop and the branding preview
// all brand invoices identically.

import type { InvoiceLetterhead } from './invoicePdf';

export const EMPTY_LETTERHEAD: InvoiceLetterhead = {
  businessName: '', businessAddress: '', vatNumber: '', bankDetails: '', invoiceFooter: '',
  accent: '#7C3AED', template: 'modern', logoDataUrl: null, defaultTerms: '',
};

export async function fetchLetterhead(): Promise<InvoiceLetterhead> {
  const [settings, logo] = await Promise.all([
    fetch('/api/billing/settings').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/billing/logo').then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  return {
    businessName: settings?.businessName ?? '',
    businessAddress: settings?.businessAddress ?? '',
    vatNumber: settings?.vatNumber ?? '',
    bankDetails: settings?.bankDetails ?? '',
    invoiceFooter: settings?.invoiceFooter ?? '',
    accent: settings?.invoiceAccent ?? '#7C3AED',
    template: settings?.invoiceTemplate ?? 'modern',
    defaultTerms: settings?.defaultTerms ?? '',
    logoDataUrl: logo?.dataUrl ?? null,
  };
}
