// MTD IT — mock-mode helper.
//
// While we iterate on the analyse pipeline UI we don't want to burn Anthropic
// credits on every click. When the env var MTD_IT_MOCK is "1" / "true" / "yes",
// the analyse route returns plausible synthetic entries instead of calling
// Claude. The flag is server-side only.

import type { MtdItStream } from '@/types';

export function isMtdItMockMode(): boolean {
  const v = (process.env.MTD_IT_MOCK ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

interface MockedEntry {
  entry_date: string;
  description: string;
  supplier: string | null;
  invoice_number?: string | null;
  category: string;
  entry_type: 'income' | 'expense';
  gross_amount: number;
  net_amount: number | null;
  vat_amount: number | null;
  currency: string;
  page_number: number | null;
  flagged_reason: string | null;
}

/**
 * Returns a few synthetic entries that look reasonable for the requested
 * stream. The dates fall inside the provided quarter range.
 */
export function buildMockEntries(stream: MtdItStream, fileName: string, fromIso: string, toIso: string): MockedEntry[] {
  // Pick a few dates evenly spaced inside the range
  const from = new Date(fromIso);
  const to = new Date(toIso);
  function dateAt(frac: number): string {
    const t = from.getTime() + (to.getTime() - from.getTime()) * frac;
    return new Date(t).toISOString().slice(0, 10);
  }

  if (stream === 'sole') {
    return [
      { entry_date: dateAt(0.1), description: `Sale of services — from ${fileName}`, supplier: null,             category: 'Turnover',           entry_type: 'income',  gross_amount: 1200, net_amount: 1000, vat_amount: 200, currency: 'GBP', page_number: 1, flagged_reason: null },
      { entry_date: dateAt(0.4), description: `Materials purchase`,                  supplier: 'Screwfix',       invoice_number: 'INV-20431', category: 'Cost of Goods Bought', entry_type: 'expense', gross_amount: 180,  net_amount: 150,  vat_amount: 30,  currency: 'GBP', page_number: 1, flagged_reason: null },
      { entry_date: dateAt(0.7), description: `Mileage`,                              supplier: 'Self',           category: 'Travelling Cost',     entry_type: 'expense', gross_amount: 60,   net_amount: null, vat_amount: null, currency: 'GBP', page_number: 1, flagged_reason: null },
    ];
  }
  if (stream === 'uk_rental') {
    return [
      { entry_date: dateAt(0.15), description: `Rent received`,            supplier: null,                 category: 'Rent Income',                  entry_type: 'income',  gross_amount: 950, net_amount: null, vat_amount: null, currency: 'GBP', page_number: 1, flagged_reason: null },
      { entry_date: dateAt(0.55), description: `Boiler service`,           supplier: 'BG Heating',         category: 'Repairs and Maintenance',      entry_type: 'expense', gross_amount: 120, net_amount: 100,  vat_amount: 20,   currency: 'GBP', page_number: 1, flagged_reason: null },
      { entry_date: dateAt(0.85), description: `Letting agent fee`,        supplier: 'High Street Lettings', category: 'Professional Fees',          entry_type: 'expense', gross_amount: 95,  net_amount: 79.17, vat_amount: 15.83, currency: 'GBP', page_number: 1, flagged_reason: null },
    ];
  }
  // foreign_rental
  return [
    { entry_date: dateAt(0.2), description: `Rent received (foreign)`,    supplier: null,                  category: 'Rent Income',             entry_type: 'income',  gross_amount: 1100, net_amount: null, vat_amount: null, currency: 'EUR', page_number: 1, flagged_reason: null },
    { entry_date: dateAt(0.6), description: `Property tax (IBI)`,          supplier: 'Ayuntamiento',        category: 'Premises Running Costs',  entry_type: 'expense', gross_amount: 320,  net_amount: null, vat_amount: null, currency: 'EUR', page_number: 1, flagged_reason: null },
  ];
}
