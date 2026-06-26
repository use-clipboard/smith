// Partnership / LLP profit allocation.
//
// After the year-end close, net profit sits on the "Profit to be allocated"
// equity account (tagged system_role 'retained_earnings' in the partnership /
// LLP seed). This splits that balance across the partner participants by their
// profit_share_pct into each partner's mapped capital account, posted as one
// balancing journal. See docs/people-and-entities.md (Phase 2).

export interface AllocationPartner {
  id: string;
  name: string;
  /** profit_share_pct, 0–100. */
  pct: number;
  /** capital_account_id the share is credited to. */
  accountId: string | null;
}

export interface AllocationLine {
  participantId: string;
  name: string;
  pct: number;
  accountId: string;
  share: number;
}

export interface AllocationResult {
  /** Balance on "Profit to be allocated" (positive = profit). */
  profitToAllocate: number;
  lines: AllocationLine[];
  totalPct: number;
  /** Partner names with no capital account mapped. */
  unmapped: string[];
  /** Partner who absorbed the penny rounding remainder (if any). */
  residualAssignedTo: string | null;
  /** True when it's safe to post (all partners mapped, shares total 100%,
   *  there's a non-trivial amount to allocate). */
  ok: boolean;
  warnings: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeAllocation(profitToAllocate: number, partners: AllocationPartner[]): AllocationResult {
  const profit = round2(profitToAllocate);
  const unmapped = partners.filter(p => !p.accountId).map(p => p.name);
  const totalPct = round2(partners.reduce((s, p) => s + (p.pct || 0), 0));

  const lines: AllocationLine[] = partners
    .filter(p => p.accountId)
    .map(p => ({
      participantId: p.id,
      name: p.name,
      pct: p.pct || 0,
      accountId: p.accountId as string,
      share: round2(profit * (p.pct || 0) / 100),
    }));

  // Penny-rounding remainder → assign to the largest-share partner so the
  // journal balances exactly and "Profit to be allocated" clears to zero.
  let residualAssignedTo: string | null = null;
  if (lines.length > 0) {
    const allocated = round2(lines.reduce((s, l) => s + l.share, 0));
    const residual = round2(profit - allocated);
    if (Math.abs(residual) >= 0.005) {
      const largest = lines.reduce((a, b) => (Math.abs(b.share) >= Math.abs(a.share) ? b : a));
      largest.share = round2(largest.share + residual);
      residualAssignedTo = largest.name;
    }
  }

  const warnings: string[] = [];
  if (unmapped.length > 0) warnings.push(`No capital account mapped for: ${unmapped.join(', ')}.`);
  if (partners.length > 0 && Math.abs(totalPct - 100) >= 0.01) {
    warnings.push(`Profit shares total ${totalPct}% — they should total 100%.`);
  }
  if (Math.abs(profit) < 0.005) {
    warnings.push('Nothing to allocate — the "Profit to be allocated" account is empty. Run the year-end close first.');
  }

  const ok =
    unmapped.length === 0 &&
    Math.abs(totalPct - 100) < 0.01 &&
    Math.abs(profit) >= 0.005 &&
    lines.length > 0;

  return { profitToAllocate: profit, lines, totalPct, unmapped, residualAssignedTo, ok, warnings };
}
