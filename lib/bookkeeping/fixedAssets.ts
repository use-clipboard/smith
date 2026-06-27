/**
 * Fixed-asset ledger helpers — shared between the depreciation engine, API
 * routes and UI so the "which account does this post to" logic lives in one
 * place.
 *
 * FA ledgers are the COA ledgers whose name starts with "FA -". The intangible
 * ledger (`FA - intangible`) uses "Amortisation"-named movement accounts; every
 * tangible FA ledger uses "Depn"-named ones.
 */

export const FA_LEDGERS = [
  'FA - intangible',
  'FA - land and buildings',
  'FA - plant and machinery',
  'FA - equipment, fixtures & fittings',
  'FA - vehicles',
] as const;

export type FaLedger = (typeof FA_LEDGERS)[number];

export function isFixedAssetLedger(ledger: string | null | undefined): boolean {
  return !!ledger && ledger.startsWith('FA -');
}

export function isIntangibleLedger(ledger: string | null | undefined): boolean {
  // Case-insensitive: Ltd seeds "FA - intangible", VT's LLP export "FA - Intangible".
  return (ledger ?? '').toLowerCase() === 'fa - intangible';
}

/** "Depreciation" for tangibles, "Amortisation" for intangibles. */
export function depreciationNoun(ledger: string | null | undefined): 'Depreciation' | 'Amortisation' {
  return isIntangibleLedger(ledger) ? 'Amortisation' : 'Depreciation';
}

/**
 * The movement-account names within an FA ledger. Intangibles prefix with
 * "Amortisation", tangibles with "Depn".
 */
export function faAccountNames(ledger: string) {
  const intangible = isIntangibleLedger(ledger);
  const depnPrefix = intangible ? 'Amortisation' : 'Depn';
  return {
    costAdditions: 'Cost - additions',
    costBfwd: 'Cost - b/fwd',
    costDisposals: 'Cost - disposals',
    depnBfwd: `${depnPrefix} - b/fwd`,
    depnCharge: `${depnPrefix} - charge`,
    depnDisposals: `${depnPrefix} - disposals`,
  };
}

/** The single P&L account the charge is debited to. */
export function chargeExpenseAccountName(ledger: string): 'Depreciation' | 'Amortisation' {
  return isIntangibleLedger(ledger) ? 'Amortisation' : 'Depreciation';
}

/** The single P&L account a disposal gain/loss is posted to. */
export const DISPOSAL_PL_ACCOUNT = 'P/L on disposal of fixed assets';

// ── Role-based resolution ─────────────────────────────────────────────────────
// Special accounts are resolved by their immutable system_role first, falling
// back to the (whitespace/case-normalised) display name for books seeded before
// roles existed, or accounts the user renamed AND never had a role. Resolving by
// role means a rename can't break depreciation / disposal posting.

import { FA_MOVEMENT_ROLES, type SystemRole } from './accountCodes';

export type ResolvableAccount = {
  id: string;
  name: string;
  ledger: string | null;
  account_type?: string | null;
  system_role?: string | null;
};

const nrmName = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Map a faAccountNames key to its system_role. */
export const FA_NAME_KEY_TO_ROLE: Record<keyof ReturnType<typeof faAccountNames>, SystemRole> = {
  costAdditions: FA_MOVEMENT_ROLES.costAdditions,
  costBfwd: FA_MOVEMENT_ROLES.costBfwd,
  costDisposals: FA_MOVEMENT_ROLES.costDisposals,
  depnBfwd: FA_MOVEMENT_ROLES.depnBfwd,
  depnCharge: FA_MOVEMENT_ROLES.depnCharge,
  depnDisposals: FA_MOVEMENT_ROLES.depnDisposals,
};

/** The system_role for the P&L charge account of a ledger. */
export function chargeExpenseRole(ledger: string | null | undefined): SystemRole {
  return isIntangibleLedger(ledger) ? 'amortisation_expense' : 'depreciation_expense';
}

/**
 * Resolve an FA movement account WITHIN a ledger: prefer system_role, fall back
 * to the normalised display name.
 */
export function resolveFaAccount<T extends ResolvableAccount>(
  accounts: T[],
  ledger: string,
  faKey: keyof ReturnType<typeof faAccountNames>,
): T | undefined {
  const role = FA_NAME_KEY_TO_ROLE[faKey];
  const fallbackName = faAccountNames(ledger)[faKey];
  const inLedger = accounts.filter(a => a.ledger === ledger);
  return inLedger.find(a => a.system_role === role)
      ?? inLedger.find(a => nrmName(a.name) === nrmName(fallbackName));
}

/**
 * Resolve a per-book singleton special account (disposal P&L, depreciation /
 * amortisation expense): prefer system_role across the whole book, fall back to
 * the normalised name (+ optional account_type guard).
 */
export function resolveBookAccount<T extends ResolvableAccount>(
  accounts: T[],
  role: SystemRole,
  fallbackName: string,
  accountType?: string,
): T | undefined {
  return accounts.find(a => a.system_role === role)
      ?? accounts.find(a => nrmName(a.name) === nrmName(fallbackName) && (!accountType || a.account_type === accountType));
}
