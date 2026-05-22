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

  // Pull #1 — normal: dated in period, no override.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('bookkeeping_transactions')
      .select('id, ref_no, date, type, payee_text, details, total, vat_total, vat_rate, vat_period_override')
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
      .select('id, ref_no, date, type, payee_text, details, total, vat_total, vat_rate, vat_period_override')
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
  let lateEntryVat = 0;
  const outputs: VatReturnBreakdownRow[] = [];
  const inputs:  VatReturnBreakdownRow[] = [];

  for (const t of txns) {
    const net = +(Number(t.total) - Number(t.vat_total)).toFixed(2);
    const vat = Number(t.vat_total) || 0;
    const isLate = t.vat_period_override !== null;
    const row: VatReturnBreakdownRow = { ...t, net, sign: 1, is_late_entry: isLate };

    if (OUTPUT_PLUS.has(t.type))  { outputVat += vat; outputNet += net; outputs.push({ ...row, sign: 1 });  }
    if (OUTPUT_MINUS.has(t.type)) { outputVat -= vat; outputNet -= net; outputs.push({ ...row, sign: -1 }); }
    if (INPUT_PLUS.has(t.type))   { inputVat  += vat; inputNet  += net; inputs.push({ ...row, sign: 1 });   }
    if (INPUT_MINUS.has(t.type))  { inputVat  -= vat; inputNet  -= net; inputs.push({ ...row, sign: -1 });  }

    if (isLate) lateEntryVat += vat * ((OUTPUT_MINUS.has(t.type) || INPUT_MINUS.has(t.type)) ? -1 : 1);
  }

  const box1 = round2(outputVat);
  const box2 = 0;
  const box3 = round2(box1 + box2);
  const box4 = round2(inputVat);
  const box5 = round2(box3 - box4);
  const box6 = round2(outputNet);
  const box7 = round2(inputNet);
  const box8 = 0;
  const box9 = 0;

  return {
    box1, box2, box3, box4, box5, box6, box7, box8, box9,
    late_entry_vat: round2(lateEntryVat),
    outputs, inputs,
  };
}
