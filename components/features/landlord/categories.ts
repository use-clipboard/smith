// Canonical UK property-income (SA105) categories, shared across the Landlord
// tool so the AI prompt, the results tables, the adjustment form and the edit
// modal all offer exactly the same options. Do not fork this list.

export const LANDLORD_EXPENSE_CATEGORIES: string[] = [
  'Allowable loan interest and other financial costs',
  'Car, van and other travel expenses',
  'Costs of services provided, including wages',
  'Legal, management and other professional fees',
  'Other allowable property expenses',
  'Property repairs and maintenance',
  'Rent, rates, insurance, ground rents',
];

export const LANDLORD_INCOME_CATEGORIES: string[] = [
  'Total rents and other income from property',
];

// The SA105 category that holds residential finance costs (mortgage interest
// etc.). For individual landlords these are NOT deducted from profit — they
// give a basic-rate (20%) tax reducer instead. Must match the string above.
export const LANDLORD_FINANCE_COST_CATEGORY = 'Allowable loan interest and other financial costs';
