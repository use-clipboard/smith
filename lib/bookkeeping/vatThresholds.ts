// VAT threshold monitoring.
//
// Two thresholds matter for a UK book:
//   • Registration — a non-registered business must register once its taxable
//     turnover over any rolling 12 months exceeds £90,000 (2024/25).
//   • Flat Rate Scheme exit — an FRS business must leave the scheme once its
//     total VAT-inclusive turnover for the year exceeds £230,000.
//
// Thresholds are kept here as configurable constants so a future settings
// screen / per-firm override can point at one place.

import type { SupabaseClient } from '@supabase/supabase-js';

export const VAT_THRESHOLDS = {
  /** Compulsory registration — rolling 12-month taxable turnover (net). */
  registration: 90_000,
  /** Flat Rate Scheme exit — annual VAT-inclusive turnover. */
  frsExit: 230_000,
  /** Begin warning (yellow) once turnover reaches this fraction of a threshold. */
  warnAtRatio: 0.9,
} as const;

export type ThresholdLevel = 'ok' | 'approaching' | 'exceeded';

export interface ThresholdCheck {
  threshold: number;
  value: number;
  level: ThresholdLevel;
}

export interface VatThresholdStatus {
  registered: boolean;
  scheme: string;
  /** Trailing-12-month taxable turnover, net of VAT. */
  rolling12Net: number;
  /** Trailing-12-month turnover, VAT-inclusive (gross). */
  rolling12Gross: number;
  /** Registration check — only meaningful when NOT registered. */
  registration: ThresholdCheck | null;
  /** FRS-exit check — only meaningful when on the flat rate scheme. */
  frsExit: ThresholdCheck | null;
}

function levelFor(value: number, threshold: number): ThresholdLevel {
  if (value > threshold) return 'exceeded';
  if (value >= threshold * VAT_THRESHOLDS.warnAtRatio) return 'approaching';
  return 'ok';
}

/** Output (sales) transaction types that count toward taxable turnover. */
const SALES_PLUS = ['SIN', 'REC'];
const SALES_MINUS = ['SCR'];

/**
 * Compute trailing-12-month sales turnover and the threshold checks for a book.
 * Cheap aggregation: pulls sales-type transactions in the trailing window and
 * sums net + gross in JS.
 */
export async function computeVatThresholdStatus(
  supabase: SupabaseClient,
  bookId: string,
  asOfIso: string, // 'YYYY-MM-DD' — usually today
): Promise<VatThresholdStatus> {
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('vat_registered, vat_scheme')
    .eq('id', bookId)
    .single();
  const registered = Boolean(book?.vat_registered);
  const scheme = (book?.vat_scheme as string | null) ?? 'standard';

  // Trailing 12 months: same day-of-month a year earlier (inclusive).
  const end = new Date(`${asOfIso}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  const fromIso = start.toISOString().slice(0, 10);

  const PAGE = 1000;
  let net = 0, gross = 0;
  const types = [...SALES_PLUS, ...SALES_MINUS];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('bookkeeping_transactions')
      .select('type, total, vat_total')
      .eq('book_id', bookId)
      .gte('date', fromIso)
      .lte('date', asOfIso)
      .in('type', types)
      .range(offset, offset + PAGE - 1);
    if (error) break; // be tolerant — a banner should never break the book
    if (!data || data.length === 0) break;
    for (const t of data) {
      const total = Number(t.total) || 0;
      const vat = Number(t.vat_total) || 0;
      const sign = SALES_MINUS.includes(t.type as string) ? -1 : 1;
      gross += sign * total;
      net += sign * (total - vat);
    }
    if (data.length < PAGE) break;
  }
  net = Math.round(net * 100) / 100;
  gross = Math.round(gross * 100) / 100;

  return {
    registered,
    scheme,
    rolling12Net: net,
    rolling12Gross: gross,
    registration: registered ? null : {
      threshold: VAT_THRESHOLDS.registration,
      value: net,
      level: levelFor(net, VAT_THRESHOLDS.registration),
    },
    frsExit: scheme === 'flat_rate' ? {
      threshold: VAT_THRESHOLDS.frsExit,
      value: gross,
      level: levelFor(gross, VAT_THRESHOLDS.frsExit),
    } : null,
  };
}
