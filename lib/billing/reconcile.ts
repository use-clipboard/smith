// Billing module — bank-CSV ↔ invoice reconciliation (heuristic matcher).
//
// Deterministic, no LLM: matches an imported credit (money-in) line to an
// outstanding invoice by amount, then disambiguates on client name / invoice
// number appearing in the bank narrative. Reliable and free — the accountant
// confirms before anything is recorded.

export interface BankCredit {
  date: string;        // yyyy-mm-dd
  description: string;
  amountPence: number; // > 0 (money in)
}

export interface OutstandingInvoice {
  id: string;
  number: string | null;
  clientName: string | null;
  balancePence: number;
}

export type MatchConfidence = 'high' | 'medium' | 'none';

export interface ReconMatch {
  index: number;              // position in the input list
  credit: BankCredit;
  suggestedInvoiceId: string | null;
  confidence: MatchConfidence;
  candidates: { id: string; number: string | null; clientName: string | null; balancePence: number }[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Significant tokens (drop common company-suffix noise + short words). */
function tokens(name: string): string[] {
  const stop = new Set(['ltd', 'limited', 'llp', 'plc', 'the', 'and', 'co', 'uk', 'services', 'group']);
  return norm(name).split(' ').filter(t => t.length >= 3 && !stop.has(t));
}

function narrativeMentions(desc: string, inv: OutstandingInvoice): boolean {
  const d = norm(desc);
  if (inv.number && d.includes(norm(inv.number))) return true;
  if (inv.clientName) {
    const toks = tokens(inv.clientName);
    if (toks.length && toks.some(t => d.includes(t))) return true;
  }
  return false;
}

/** Match each credit line to the best outstanding invoice. */
export function reconcileCredits(credits: BankCredit[], invoices: OutstandingInvoice[]): ReconMatch[] {
  return credits.map((credit, index) => {
    // 1) Exact-amount candidates.
    const exact = invoices.filter(inv => inv.balancePence === credit.amountPence);
    const named = exact.filter(inv => narrativeMentions(credit.description, inv));

    let suggestedInvoiceId: string | null = null;
    let confidence: MatchConfidence = 'none';
    let candidates = exact;

    if (named.length === 1) {
      suggestedInvoiceId = named[0].id; confidence = 'high';
    } else if (named.length > 1) {
      candidates = named; confidence = 'medium';
    } else if (exact.length === 1) {
      suggestedInvoiceId = exact[0].id; confidence = 'high';
    } else if (exact.length > 1) {
      confidence = 'medium';
    } else {
      // 2) No exact amount — try narrative-only match (amount differs, e.g. part payment).
      const byName = invoices.filter(inv => narrativeMentions(credit.description, inv));
      if (byName.length === 1) { suggestedInvoiceId = byName[0].id; confidence = 'medium'; candidates = byName; }
      else if (byName.length > 1) { confidence = 'none'; candidates = byName; }
      else { candidates = []; }
    }

    return {
      index,
      credit,
      suggestedInvoiceId,
      confidence,
      candidates: candidates.slice(0, 6).map(c => ({ id: c.id, number: c.number, clientName: c.clientName, balancePence: c.balancePence })),
    };
  });
}
