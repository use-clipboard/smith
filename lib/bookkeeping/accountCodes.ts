// Bookkeeping — account codes, system roles and ledger keys.
//
// Three stability concepts live here, kept separate on purpose:
//
//   • SystemRole  — the immutable, machine-facing identity the server resolves
//                   special accounts by (FA movement accounts, VAT control,
//                   retained earnings, disposal P&L). NEVER shown to users,
//                   NEVER editable. Renaming an account's display name can't
//                   break anything that resolves by role.
//
//   • LedgerKey   — a stable key for a ledger, independent of its display
//                   string. Defence-in-depth for the report-grouping / FA /
//                   VAT conventions (ledgers are already locked from rename).
//
//   • code        — the USER-FACING ranged-by-type account number. Cosmetic
//                   only: display + reporting + import matching. Never used for
//                   resolution — that's SystemRole's job.

// ── System roles ─────────────────────────────────────────────────────────────
// FA movement roles repeat across FA ledgers (each FA ledger has its own
// cost/depn accounts) — they're resolved within a (book, ledger). The rest are
// per-book singletons.
export const SYSTEM_ROLES = [
  // Fixed-asset movement accounts (per FA ledger). The same roles cover the
  // intangible ledger's "Amortisation -" accounts — the role abstracts over the
  // Depn/Amortisation naming.
  'fa_cost_bfwd',
  'fa_cost_additions',
  'fa_cost_disposals',
  'fa_depn_bfwd',
  'fa_depn_charge',
  'fa_depn_disposals',
  // P&L accounts the FA engine posts to.
  'depreciation_expense',
  'amortisation_expense',
  'disposal_pl',
  // VAT control accounts (in Creditors).
  'vat_output',
  'vat_input',
  'vat_deferred_input',
  'vat_deferred_output',
  'vat_ec_acquisitions',
  'net_vat_due',
  // Year-end close target (also the charity unrestricted-funds balance).
  'retained_earnings',
  // Charity fund-balance accounts — per-fund-type close targets so a charity
  // year-end carries each fund's surplus into the right fund balance.
  'restricted_funds',
  'endowment_funds',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** The six FA movement roles, in the order faAccountNames returns them. */
export const FA_MOVEMENT_ROLES = {
  costBfwd: 'fa_cost_bfwd',
  costAdditions: 'fa_cost_additions',
  costDisposals: 'fa_cost_disposals',
  depnBfwd: 'fa_depn_bfwd',
  depnCharge: 'fa_depn_charge',
  depnDisposals: 'fa_depn_disposals',
} as const;

// ── Account codes (ranged by type, Sage-style) ───────────────────────────────
//   1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income
//   5xxx cost of sales · 6xxx+ expenses
// Codes step by 10 within a range so a user can slot a new account between two
// seeded ones without renumbering.
export const CODE_STEP = 10;

const RANGE_BASE = {
  asset: 1000,
  liability: 2000,
  equity: 3000,
  income: 4000,
  cost_of_sales: 5000,
  expense: 6000,
} as const;

export type CodeAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Ledger keys (or display names) that mean "cost of sales" → the 5xxx band. */
function isCostOfSalesLedger(ledgerKey: string | null, ledgerName: string | null): boolean {
  if (ledgerKey) return ledgerKey === 'cost_of_sales' || ledgerKey === 'disallowable_cost_of_sales';
  return /cost of sales|c\. of sales/i.test(ledgerName ?? '');
}

/** The thousand-band an account's code belongs to. */
export function rangeBaseFor(
  accountType: CodeAccountType,
  ledgerKey: string | null,
  ledgerName: string | null,
): number {
  switch (accountType) {
    case 'asset': return RANGE_BASE.asset;
    case 'liability': return RANGE_BASE.liability;
    case 'equity': return RANGE_BASE.equity;
    case 'income': return RANGE_BASE.income;
    case 'expense':
      return isCostOfSalesLedger(ledgerKey, ledgerName) ? RANGE_BASE.cost_of_sales : RANGE_BASE.expense;
    default: return RANGE_BASE.expense;
  }
}

/** Which range a numeric code falls in (its thousand-band base). */
export function bandOfCode(code: string | number | null): number | null {
  if (code == null) return null;
  const n = typeof code === 'number' ? code : parseInt(code, 10);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n / 1000) * 1000;
}

export function formatCode(n: number): string {
  return String(n);
}

/**
 * Next free code in a range given the codes already used anywhere in the book.
 * Picks (highest code in the same band) + CODE_STEP, or the band base if none.
 * Falls back to +1 stepping once a band is dense enough that +10 would overflow
 * into the next band.
 */
export function nextCodeInRange(allCodes: Array<string | number | null>, base: number): string {
  const ceiling = base + 999;
  const inBand = allCodes
    .map(c => (typeof c === 'number' ? c : c == null ? NaN : parseInt(c, 10)))
    .filter(n => Number.isFinite(n) && n >= base && n <= ceiling) as number[];
  if (inBand.length === 0) return formatCode(base);
  const max = Math.max(...inBand);
  let next = max + CODE_STEP;
  if (next > ceiling) next = max + 1; // band is dense — fall back to unit steps
  if (next > ceiling) next = ceiling; // truly full — park on the ceiling
  return formatCode(next);
}
