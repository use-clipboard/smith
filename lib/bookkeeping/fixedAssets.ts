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
  return ledger === 'FA - intangible';
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
