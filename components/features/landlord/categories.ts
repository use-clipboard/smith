// Canonical UK property-income (SA105) categories, shared across the Landlord
// tool so the AI prompt, the results tables, the adjustment form and the edit
// modal all offer exactly the same options. Do not fork this list.

export const LANDLORD_EXPENSE_CATEGORIES: string[] = [
  'Allowable loan interest and other financial costs',
  'Non-residential loan interest and other financial costs',
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

// The category that holds RESIDENTIAL finance costs (mortgage interest etc.).
// For individual landlords these are NOT deducted from profit — they give a
// basic-rate (20%) tax reducer instead. Must match the string above. The
// computation restricts ONLY this category.
export const LANDLORD_FINANCE_COST_CATEGORY = 'Allowable loan interest and other financial costs';

// Finance costs on COMMERCIAL (non-residential) property are NOT restricted —
// they stay fully deductible like any other expense. Because it isn't the
// restricted category above, the computation already treats it as deductible.
export const LANDLORD_NON_RESIDENTIAL_FINANCE_COST_CATEGORY = 'Non-residential loan interest and other financial costs';
