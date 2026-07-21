// MTD IT income/expense categories, per stream.
//
// The Claude prompts (later stages) constrain auto-categorisation to these
// exact strings; the results editor shows them in the same order via dropdowns.
// Foreign rental reuses the UK rental category list per the spec.

export const SOLE_TRADER_INCOME = [
  'Turnover',
  'Other Income',
] as const;

export const SOLE_TRADER_EXPENSES = [
  'Cost of Goods Bought',
  'CIS Payments',
  'Staff Cost',
  'Travelling Cost',
  'Premises Cost',
  'Maintenance Cost',
  'Admin Cost',
  'Advertising Cost',
  'Entertainment Cost',
  'Interest Cost',
  'Finance Charges',
  'Bad Debts',
  'Professional Fee',
  'Depreciation',
  'Other Expense',
] as const;

export const UK_RENTAL_INCOME = [
  'Rent Income',
  'Premiums of Lease Grant',
  'Reverse Premiums',
  'Other Income',
  'Income from Property',
] as const;

// Finance costs are split into two categories because they are taxed
// completely differently (see lib/mtdIt/financeCosts.ts):
//   • Residential Finance Costs — restricted under ITTOIA s.272A ("Section 24").
//     NOT deductible from rental profit; relieved instead as a 20% basic-rate
//     tax reducer. Reported to HMRC in the separate `residentialFinancialCost`
//     field, never summed into deductible expenses.
//   • Non-Residential Finance Costs — commercial-property interest, still fully
//     deductible; reported in the ordinary `financialCosts` field.
// The category the user (or AI) picks decides the treatment — see RESIDENTIAL_
// FINANCE_COST / NON_RESIDENTIAL_FINANCE_COST below.
export const UK_RENTAL_EXPENSES = [
  'Premises Running Costs',
  'Repairs and Maintenance',
  'Residential Finance Costs',
  'Non-Residential Finance Costs',
  'Professional Fees',
  'Travel Costs',
  'Cost of Service',
  'Other Expenses',
] as const;

/** The two finance-cost category labels, exported so routing/UI never re-spell
 *  them. Treatment is driven off these exact strings via lib/mtdIt/financeCosts. */
export const RESIDENTIAL_FINANCE_COST     = 'Residential Finance Costs';
export const NON_RESIDENTIAL_FINANCE_COST = 'Non-Residential Finance Costs';

// Foreign rental uses the same categories as UK rental
export const FOREIGN_RENTAL_INCOME = UK_RENTAL_INCOME;
export const FOREIGN_RENTAL_EXPENSES = UK_RENTAL_EXPENSES;

export type SoleTraderIncomeCategory  = typeof SOLE_TRADER_INCOME[number];
export type SoleTraderExpenseCategory = typeof SOLE_TRADER_EXPENSES[number];
export type RentalIncomeCategory      = typeof UK_RENTAL_INCOME[number];
export type RentalExpenseCategory     = typeof UK_RENTAL_EXPENSES[number];

/** £90k combined-income limit above which consolidated reporting is not permitted */
export const CONSOLIDATED_REPORTING_LIMIT = 90_000;
