/**
 * Module-level singleton that carries a "pending analysis" handoff from the
 * bookkeeping tool to the Accounts Review / Performance tools when the user
 * launches one from the book's Reports menu.
 *
 * Deliberately SEPARATE from pendingClient (which carries only a SelectedClient)
 * so we can ship the generated text statements + period without touching the
 * shared SelectedClient shape. The launching code sets BOTH: pendingClient (so
 * the tool prefills its client selector and lands on the input screen, exactly
 * like Quick Launch) and pendingAnalysis (so the tool can attach the statements
 * and period). The tool reads pendingAnalysis on mount / via the dispatched
 * event, same pattern as pendingClient.
 */

import type { SelectedClient } from '@/components/ui/ClientSelector';

/** One period's three statements as plain text (from /books/[id]/statements). */
export interface AnalysisStatements {
  periodLabel: string;
  asAtLabel: string;
  tbText: string;
  pnlText: string;
  bsText: string;
  /** P&L + BS + TB concatenated under a heading — convenient single document. */
  combined: string;
}

export interface PendingAnalysisData {
  source: 'bookkeeping';
  bookId: string;
  businessName: string;
  /** Client built from the book's linked client (null for unallocated books). */
  client: SelectedClient | null;
  period: { fromIso: string; toIso: string };
  priorPeriod: { fromIso: string; toIso: string } | null;
  current: AnalysisStatements;
  prior: AnalysisStatements | null;
}

interface PendingEntry {
  route: string;
  data: PendingAnalysisData;
}

let _pending: PendingEntry | null = null;

export function setPendingAnalysis(route: string, data: PendingAnalysisData): void {
  _pending = { route, data };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('smith:pending-analysis', { detail: { route } }));
  }
}

/** Consume (read + clear) the pending analysis for a route. */
export function consumePendingAnalysis(route: string): PendingAnalysisData | null {
  if (_pending?.route === route) {
    const data = _pending.data;
    _pending = null;
    return data;
  }
  return null;
}

/** Non-mutating check — lets a tool wrapper decide whether to land on the
 *  input form rather than its history dashboard. */
export function peekPendingAnalysis(route: string): boolean {
  return _pending?.route === route;
}
