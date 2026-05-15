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

export const UK_RENTAL_EXPENSES = [
  'Premises Running Costs',
  'Repairs and Maintenance',
  'Non Residential Financial Costs',
  'Professional Fees',
  'Travel Costs',
  'Cost of Service',
  'Other Expenses',
] as const;

// Foreign rental uses the same categories as UK rental
export const FOREIGN_RENTAL_INCOME = UK_RENTAL_INCOME;
export const FOREIGN_RENTAL_EXPENSES = UK_RENTAL_EXPENSES;

export type SoleTraderIncomeCategory  = typeof SOLE_TRADER_INCOME[number];
export type SoleTraderExpenseCategory = typeof SOLE_TRADER_EXPENSES[number];
export type RentalIncomeCategory      = typeof UK_RENTAL_INCOME[number];
export type RentalExpenseCategory     = typeof UK_RENTAL_EXPENSES[number];

/** £90k combined-income limit above which consolidated reporting is not permitted */
export const CONSOLIDATED_REPORTING_LIMIT = 90_000;
