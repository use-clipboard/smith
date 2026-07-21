// SA105 (Landlord tool) category → MTD IT canonical category.
//
// The Landlord tool categorises property income/expenses with SA105 labels; the
// MTD IT tool uses its own shorter list (lib/mtdIt/categories.ts). Feeding a
// landlord analysis into MTD used to pass the SA105 string straight through, so
// every imported row showed as a "non-standard" category — and, critically,
// finance costs weren't recognised as RESIDENTIAL, so they were filed as a
// deductible expense (under-declaring profit).
//
// This maps them onto the MTD list. Finance costs resolve to residential
// (the default for lettings) or non-residential based on the matched property's
// use_type marker, so a commercial property's interest stays deductible.
//
// The SA105 strings mirror components/features/landlord/categories.ts (the
// canonical list). They're duplicated here as literals rather than imported
// because lib/ must not depend on components/.

import { RESIDENTIAL_FINANCE_COST, NON_RESIDENTIAL_FINANCE_COST } from './categories';

/** The category the Landlord tool uses for residential finance costs. */
export const LANDLORD_FINANCE_COST_CATEGORY = 'Allowable loan interest and other financial costs';
/** The Landlord tool's explicit commercial/non-residential finance category. */
export const LANDLORD_NON_RESIDENTIAL_FINANCE_COST_CATEGORY = 'Non-residential loan interest and other financial costs';

/** Straight SA105 → MTD label swaps (finance handled separately below). */
const CATEGORY_MAP: Record<string, string> = {
  // Income
  'Total rents and other income from property': 'Rent Income',
  // Expenses
  'Property repairs and maintenance':            'Repairs and Maintenance',
  'Rent, rates, insurance, ground rents':        'Premises Running Costs',
  'Legal, management and other professional fees': 'Professional Fees',
  'Car, van and other travel expenses':          'Travel Costs',
  'Costs of services provided, including wages':  'Cost of Service',
  'Other allowable property expenses':           'Other Expenses',
};

/**
 * Map a Landlord (SA105) category to its MTD IT category.
 * Finance costs become "Residential Finance Costs" by default, or
 * "Non-Residential Finance Costs" when the matched property is marked commercial.
 * Unknown categories fall through unchanged (surface as non-standard, as before).
 */
export function landlordCategoryToMtd(
  category: string | null | undefined,
  opts: { propertyUseType?: 'residential' | 'commercial' | null } = {},
): string {
  const c = (category ?? '').trim();
  // Explicit commercial finance category — always non-residential.
  if (c === LANDLORD_NON_RESIDENTIAL_FINANCE_COST_CATEGORY) return NON_RESIDENTIAL_FINANCE_COST;
  // Residential finance category — residential by default; a property explicitly
  // marked commercial overrides it (handles legacy single-category analyses).
  if (c === LANDLORD_FINANCE_COST_CATEGORY) {
    return opts.propertyUseType === 'commercial' ? NON_RESIDENTIAL_FINANCE_COST : RESIDENTIAL_FINANCE_COST;
  }
  return CATEGORY_MAP[c] ?? c;
}
