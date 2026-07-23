// Shared VAT-return calculation. Used by:
//   • GET  /api/bookkeeping/books/[id]/vat-return        — live preview
//   • POST /api/bookkeeping/books/[id]/vat-returns       — recompute on file
//
// Single source of truth so the live preview, the figures stored at filing,
// and the audit snapshot can never drift.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface VatReturnTxRow {
  id: string;
  ref_no: string;
  date: string;                  // real posting date
  type: string;
  payee_text: string | null;
  details: string | null;
  total: number;
  vat_total: number;
  vat_rate: number | null;
  vat_period_override: string | null;
  /** FRS only — purchase flagged as a reclaimable capital asset. */
  frs_capital_reclaim?: boolean;
}

export interface VatReturnBreakdownRow extends VatReturnTxRow {
  net: number;
  sign: 1 | -1;
  /** True when this transaction's date is outside the period but it's been
   *  pulled in via vat_period_override. Drives the "late entry" indicator. */
  is_late_entry: boolean;
}

export interface VatReturnFigures {
  box1: number; box2: number; box3: number;
  box4: number; box5: number;
  box6: number; box7: number; box8: number; box9: number;
  late_entry_vat: number;
  outputs: VatReturnBreakdownRow[];
  inputs:  VatReturnBreakdownRow[];
  /** VAT scheme this was computed under ('standard' | 'flat_rate' | …). */
  scheme: string | null;
  /** The VAT actually charged on sales (= Box 1 under standard; differs under
   *  FRS where Box 1 is rate × gross). The closing journal clears this from
   *  VAT-Output. */
  actual_output_vat: number;
  /** Flat rate % applied (FRS only), else null. */
  flat_rate: number | null;
  /** Resolved VAT-registration status that applied for this period (from the
   *  effective-dated history, resolved as-of the period end). */
  vat_registered: boolean;
  /** Human-readable advisories — e.g. a VAT status change landing mid-period,
   *  or the period being computed while not VAT registered. */
  warnings: string[];
}

interface ResolvedVatStatus {
  vat_registered: boolean;
  scheme: string;
  flat_rate: number | null;
  /** When the applied status took effect; null = book's starting status. */
  effective_from: string | null;
}

function ukDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Resolve the VAT status that applied across [periodFrom, asOf] from the
 * effective-dated history, and flag any change that lands mid-period.
 *
 * Returns null when there's no usable history (table absent, or no rows) so the
 * caller can fall back to the book's denormalised current fields.
 */
async function resolveVatStatus(
  supabase: SupabaseClient,
  bookId: string,
  periodFrom: string,
  asOf: string,
): Promise<{ status: ResolvedVatStatus; warnings: string[] } | null> {
  const { data, error } = await supabase
    .from('bookkeeping_vat_status_changes')
    .select('effective_from, vat_registered, vat_scheme, flat_rate_percentage')
    .eq('book_id', bookId)
    .order('effective_from', { ascending: true })
    // Same-day changes tie on effective_from — order by creation so the
    // latest-recorded change wins when we take the last applicable row.
    .order('created_at', { ascending: true });
  // Table missing (pre-migration) or any error → signal fallback.
  if (error || !data || data.length === 0) return null;

  // Status in effect at the period end = latest change with effective_from <= asOf.
  const applicable = data.filter(c => c.effective_from <= asOf);
  if (applicable.length === 0) return null; // first change is after the period → book default applies
  const current = applicable[applicable.length - 1];

  const status: ResolvedVatStatus = {
    vat_registered: current.vat_registered,
    scheme: (current.vat_scheme as string | null) ?? 'standard',
    flat_rate: current.vat_scheme === 'flat_rate' ? Number(current.flat_rate_percentage ?? 0) : null,
    effective_from: current.effective_from,
  };

  // Mid-period changes: effective_from strictly after the start, up to the end.
  const warnings: string[] = [];
  for (const c of data) {
    if (c.effective_from > periodFrom && c.effective_from <= asOf) {
      const desc = c.vat_registered
        ? `registered (${(c.vat_scheme as string | null) ?? 'standard'}${c.vat_scheme === 'flat_rate' && c.flat_rate_percentage != null ? ` ${c.flat_rate_percentage}%` : ''})`
        : 'de-registered';
      warnings.push(`VAT status changed mid-period on ${ukDate(c.effective_from)} — now ${desc}. This return uses the status in effect at the period end; split the period if the change should only apply from that date.`);
    }
  }
  if (!status.vat_registered) {
    warnings.push('The book is not VAT registered for this period — the figures are informational only.');
  }
  return { status, warnings };
}

const OUTPUT_PLUS  = new Set(['SIN', 'REC']);
const OUTPUT_MINUS = new Set(['SCR']);
const INPUT_PLUS   = new Set(['PIN', 'PAY', 'CHQ']);
const INPUT_MINUS  = new Set(['PCR']);

function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Compute the 9 VAT-return boxes for the given book and period. Pulls every
 * VAT-bearing transaction whose effective VAT date (COALESCE(override, date))
 * falls in [from, to], aggregates, returns the figures + the breakdown.
 */
export async function computeVatReturn(
  supabase: SupabaseClient,
  bookId: string,
  from: string,
  to: string,
): Promise<VatReturnFigures> {
  // We can't push COALESCE through PostgREST cleanly, so we pull a slightly
  // wider window then filter in JS:
  //   • transactions with date IN [from, to] AND override IS NULL
  //   • transactions with override IN [from, to]
  // The override window catches late entries dated earlier; the date window
  // catches normal txns. Two queries are simpler than fighting PostgREST.

  const PAGE = 1000;
  const txns: VatReturnTxRow[] = [];

  // Scheme drives whether we apply the flat-rate calculation. We resolve the
  // status that applied AS-OF THE PERIOD END from the effective-dated history;
  // if there's no usable history we fall back to the book's current fields.
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('vat_registered, vat_scheme, flat_rate_percentage')
    .eq('id', bookId)
    .single();

  const resolved = await resolveVatStatus(supabase, bookId, from, to);
  const scheme = resolved
    ? resolved.status.scheme
    : ((book?.vat_scheme as string | null) ?? 'standard');
  const flatRate = scheme === 'flat_rate'
    ? Number(resolved ? resolved.status.flat_rate ?? 0 : book?.flat_rate_percentage ?? 0)
    : null;
  const vatRegistered = resolved ? resolved.status.vat_registered : Boolean(book?.vat_registered);
  const warnings = resolved ? resolved.warnings : [];

  // Pull #1 — normal: dated in period, no override.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('bookkeeping_transactions')
      .select('id, ref_no, date, type, payee_text, details, total, vat_total, vat_rate, vat_period_override, frs_capital_reclaim')
      .eq('book_id', bookId)
      .gte('date', from)
      .lte('date', to)
      .is('vat_period_override', null)
      .in('type', ['SIN', 'SCR', 'PIN', 'PCR', 'PAY', 'CHQ', 'REC'])
      .order('date', { ascending: true })
      .order('ref_seq', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    txns.push(...(data as VatReturnTxRow[]));
    if (data.length < PAGE) break;
  }

  // Pull #2 — late entries: override falls in period.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('bookkeeping_transactions')
      .select('id, ref_no, date, type, payee_text, details, total, vat_total, vat_rate, vat_period_override, frs_capital_reclaim')
      .eq('book_id', bookId)
      .gte('vat_period_override', from)
      .lte('vat_period_override', to)
      .in('type', ['SIN', 'SCR', 'PIN', 'PCR', 'PAY', 'CHQ', 'REC'])
      .order('vat_period_override', { ascending: true })
      .order('ref_seq', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    txns.push(...(data as VatReturnTxRow[]));
    if (data.length < PAGE) break;
  }

  // Aggregate
  let outputVat = 0, inputVat = 0;
  let outputNet = 0, inputNet = 0;
  let capitalInputVat = 0, capitalInputNet = 0; // FRS: reclaimable capital only
  let lateEntryVat = 0;
  const outputs: VatReturnBreakdownRow[] = [];
  const inputs:  VatReturnBreakdownRow[] = [];

  for (const t of txns) {
    const net = +(Number(t.total) - Number(t.vat_total)).toFixed(2);
    const vat = Number(t.vat_total) || 0;
    const isLate = t.vat_period_override !== null;
    const isCapital = t.frs_capital_reclaim === true;
    const row: VatReturnBreakdownRow = { ...t, net, sign: 1, is_late_entry: isLate };

    if (OUTPUT_PLUS.has(t.type))  { outputVat += vat; outputNet += net; outputs.push({ ...row, sign: 1 });  }
    if (OUTPUT_MINUS.has(t.type)) { outputVat -= vat; outputNet -= net; outputs.push({ ...row, sign: -1 }); }
    if (INPUT_PLUS.has(t.type))   { inputVat  += vat; inputNet  += net; inputs.push({ ...row, sign: 1 });  if (isCapital) { capitalInputVat += vat; capitalInputNet += net; } }
    if (INPUT_MINUS.has(t.type))  { inputVat  -= vat; inputNet  -= net; inputs.push({ ...row, sign: -1 }); if (isCapital) { capitalInputVat -= vat; capitalInputNet -= net; } }

    if (isLate) lateEntryVat += vat * ((OUTPUT_MINUS.has(t.type) || INPUT_MINUS.has(t.type)) ? -1 : 1);
  }

  const actualOutputVat = round2(outputVat);

  let box1: number, box4: number, box6: number, box7: number;
  let inputsForReturn = inputs;
  if (scheme === 'flat_rate') {
    // Box 1 = flat rate % × GROSS (VAT-inclusive) turnover. Box 4/7 cover only
    // reclaimable capital purchases; all other input VAT is not recoverable.
    const gross = round2(outputNet + outputVat);
    box1 = round2(((flatRate ?? 0) / 100) * gross);
    box4 = round2(capitalInputVat);
    box6 = gross;
    box7 = round2(capitalInputNet);
    inputsForReturn = inputs.filter(r => r.frs_capital_reclaim === true);
  } else {
    box1 = round2(outputVat);
    box4 = round2(inputVat);
    box6 = round2(outputNet);
    box7 = round2(inputNet);
  }

  const box2 = 0;
  const box3 = round2(box1 + box2);
  const box5 = round2(box3 - box4);
  const box8 = 0;
  const box9 = 0;

  return {
    box1, box2, box3, box4, box5, box6, box7, box8, box9,
    late_entry_vat: round2(lateEntryVat),
    outputs, inputs: inputsForReturn,
    scheme, actual_output_vat: actualOutputVat, flat_rate: flatRate,
    vat_registered: vatRegistered, warnings,
  };
}
