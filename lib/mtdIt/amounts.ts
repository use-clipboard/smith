// MTD IT — the single source of truth for "what is this row worth, in GBP?".
//
// This used to be six near-identical copies (pnl, pnlExport ×2, approvalPdf,
// computeUpdate, MtdItReviewPhase), which had quietly drifted apart:
//   - pnl.ts returned 0 for a row with a NULL currency (fxRates[null] → undefined)
//   - pnlExport's Excel path used `rate ? …` where `Number.isFinite` was meant
//   - none of them applied share_pct at all
// Every caller now goes through here so the totals strip, the P&L, the Excel
// export, the approval PDF and the figures filed with HMRC cannot disagree.
//
// Two levels are exposed deliberately:
//   grossGbp()         — the whole invoice, converted. What the document says.
//   shareAdjustedGbp() — the client's share of it. What gets reported.
// A row keeps the FULL amount so it still reconciles to its source document;
// the share is applied at compute time, mirroring how the Landlord tool splits
// rows before computing (see utils/landlordAllocation.ts).

/** The minimal row shape needed to value an entry. Both EditorEntry (client)
 *  and computeUpdate's EntryRow (server) are structurally assignable to this. */
export interface ValuableEntry {
  gross_amount: number | null;
  gbp_amount: number | null;
  currency: string | null;
  fx_rate: number | null;
  share_pct: number | null;
}

/** Ownership share as a 0..100 percentage.
 *
 *  NULL/undefined → 100, NOT 0. A row with no share recorded is wholly the
 *  client's; defaulting to 0 would silently zero their income. Values outside
 *  0..100 are clamped — the editor constrains its input, but
 *  import-landlord/route.ts writes ownership_pct straight through. */
export function clampSharePct(share: number | null | undefined): number {
  if (share == null || !Number.isFinite(share)) return 100;
  return Math.max(0, Math.min(100, share));
}

/**
 * The row's full value in GBP, before any ownership share.
 *
 * GBP rows pass through. Non-GBP rows prefer a stored gbp_amount (locked in at
 * analyse time), then the row's own fx_rate, then the quarter's fallback rate.
 * A non-GBP row with no usable rate is worth 0 — callers surface that as an
 * "unconverted" count rather than guessing.
 */
export function grossGbp(e: ValuableEntry, fxRates: Record<string, number>): number {
  const gross = e.gross_amount || 0;
  if (!e.currency || e.currency === 'GBP') return gross;
  if (typeof e.gbp_amount === 'number') return e.gbp_amount;
  const rate = e.fx_rate ?? fxRates[e.currency];
  if (!rate || !Number.isFinite(rate)) return 0;
  return gross * rate;
}

/**
 * The client's share of the row, in GBP — the value that belongs in every
 * total, report and HMRC submission.
 *
 * Returned unrounded: callers round once, at the point they accumulate, so a
 * share tail (e.g. 33.33%) never gets rounded twice.
 */
export function shareAdjustedGbp(e: ValuableEntry, fxRates: Record<string, number>): number {
  return grossGbp(e, fxRates) * clampSharePct(e.share_pct) / 100;
}

/** Round to 2dp. Exported so every accumulation site rounds identically. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
