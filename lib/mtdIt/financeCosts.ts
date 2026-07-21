// Residential finance-cost restriction ("Section 24" / ITTOIA s.272A) helpers.
//
// UK residential landlords (and overseas residential property of a UK resident)
// can no longer deduct mortgage/loan interest and incidental finance costs from
// rental profit. Instead HMRC gives a 20% basic-rate tax reducer, computed at
// the tax-calculation stage. In the MTD-IT Property Business API these costs go
// in a SEPARATE `residentialFinancialCost` field and are NEVER summed into the
// deductible expenses total.
//
// Which entries are restricted is driven off the category the user/AI picks —
// "Residential Finance Costs" vs "Non-Residential Finance Costs" — so a manual
// preparer stays in control of the treatment. This module is the ONE place that
// decides, so nothing re-implements the string matching.

import { RESIDENTIAL_FINANCE_COST, NON_RESIDENTIAL_FINANCE_COST } from './categories';

/** Basic-rate tax reducer applied to residential finance costs (20%). Used only
 *  to show an indicative reducer figure in the P&L / client pack — HMRC does the
 *  real calculation at Final Declaration. */
export const RESIDENTIAL_FINANCE_REDUCER_RATE = 0.20;

/**
 * Is this a RESTRICTED residential finance cost (reported in the separate HMRC
 * field, kept out of deductible expenses)?
 *
 * Matches the canonical "Residential Finance Costs" category, and is defensive
 * about legacy/near-miss strings: it must look like a finance cost, be
 * residential, and NOT be the non-residential (commercial) variant — note that
 * "non-residential" contains "residential" as a substring, so the exclusion has
 * to come first.
 */
export function isResidentialFinanceCost(category: string | null | undefined): boolean {
  const c = (category ?? '').trim().toLowerCase();
  if (!c) return false;
  if (c === RESIDENTIAL_FINANCE_COST.toLowerCase()) return true;
  if (!/financ/.test(c)) return false;              // not a finance cost at all
  if (/non[-\s]?residential/.test(c)) return false; // commercial finance — deductible
  return /residential/.test(c);
}

/** Is this the ordinary (deductible) non-residential/commercial finance cost? */
export function isNonResidentialFinanceCost(category: string | null | undefined): boolean {
  const c = (category ?? '').trim().toLowerCase();
  if (!c) return false;
  if (c === NON_RESIDENTIAL_FINANCE_COST.toLowerCase()) return true;
  return /financ/.test(c) && /non[-\s]?residential/.test(c);
}

/** The property use_type a finance-cost category implies, for the mismatch
 *  check ("residential finance cost on a property you marked commercial"). */
export function financeCategoryImpliedUse(category: string | null | undefined): 'residential' | 'commercial' | null {
  if (isResidentialFinanceCost(category)) return 'residential';
  if (isNonResidentialFinanceCost(category)) return 'commercial';
  return null;
}
