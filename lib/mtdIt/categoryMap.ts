// Maps our (AI-extracted / user-entered) expense categories onto the exact
// field names HMRC expects in an MTD-IT period summary.
//
// Self-employment fields are VERIFIED against the Self-Employment Business API
// v5.0 OAS. Property field codelists (Property Business API v6.0) are not yet
// verified at field-level, so property currently uses the consolidated-expenses
// single total (allowed below the VAT-registration threshold) — see
// PROPERTY note below. Itemised property mapping is a follow-up.

/** HMRC self-employment expense field keys (periodExpenses). */
export type SeExpenseField =
  | 'costOfGoods' | 'paymentsToSubcontractors' | 'wagesAndStaffCosts'
  | 'carVanTravelExpenses' | 'premisesRunningCosts' | 'maintenanceCosts'
  | 'adminCosts' | 'businessEntertainmentCosts' | 'advertisingCosts'
  | 'interestOnBankOtherLoans' | 'financeCharges' | 'irrecoverableDebts'
  | 'professionalFees' | 'depreciation' | 'otherExpenses';

/** Ordered keyword → field rules. First substring hit wins (case-insensitive). */
const SE_RULES: { field: SeExpenseField; keywords: string[] }[] = [
  { field: 'costOfGoods',              keywords: ['cost of goods', 'stock', 'materials', 'goods for resale', 'purchases', 'raw material'] },
  { field: 'paymentsToSubcontractors', keywords: ['subcontractor', 'sub-contractor', 'cis'] },
  { field: 'wagesAndStaffCosts',       keywords: ['wage', 'salar', 'staff', 'payroll', 'employee', 'pension contrib'] },
  { field: 'carVanTravelExpenses',     keywords: ['travel', 'motor', 'car ', 'van', 'fuel', 'mileage', 'parking', 'train', 'taxi'] },
  { field: 'premisesRunningCosts',     keywords: ['rent', 'rate', 'premises', 'utilit', 'electric', 'gas', 'water', 'heat', 'light', 'insurance'] },
  { field: 'maintenanceCosts',         keywords: ['repair', 'maintenance', 'renewal'] },
  { field: 'businessEntertainmentCosts', keywords: ['entertain', 'hospitality'] },
  { field: 'advertisingCosts',         keywords: ['advertis', 'marketing', 'promotion', 'website'] },
  { field: 'irrecoverableDebts',       keywords: ['bad debt', 'irrecoverable'] },
  { field: 'professionalFees',         keywords: ['accountan', 'legal', 'solicitor', 'consultant', 'professional fee', 'professional'] },
  { field: 'financeCharges',           keywords: ['bank charge', 'finance charge', 'card fee', 'merchant fee'] },
  { field: 'interestOnBankOtherLoans', keywords: ['interest', 'loan'] },
  { field: 'depreciation',             keywords: ['depreciation', 'capital allowance'] },
  { field: 'adminCosts',               keywords: ['admin', 'office', 'stationery', 'phone', 'telephone', 'mobile', 'postage', 'software', 'subscription', 'it ', 'computer', 'bank '] },
];

/** Classify a self-employment expense category to its HMRC field. */
export function classifySeExpense(category: string | null | undefined): SeExpenseField {
  const c = (category ?? '').toLowerCase();
  for (const rule of SE_RULES) {
    if (rule.keywords.some(k => c.includes(k))) return rule.field;
  }
  return 'otherExpenses';
}

/** All SE expense fields (for zero-initialising / display). */
export const SE_EXPENSE_FIELDS: SeExpenseField[] = [
  'costOfGoods', 'paymentsToSubcontractors', 'wagesAndStaffCosts', 'carVanTravelExpenses',
  'premisesRunningCosts', 'maintenanceCosts', 'adminCosts', 'businessEntertainmentCosts',
  'advertisingCosts', 'interestOnBankOtherLoans', 'financeCharges', 'irrecoverableDebts',
  'professionalFees', 'depreciation', 'otherExpenses',
];

export const SE_EXPENSE_LABEL: Record<SeExpenseField, string> = {
  costOfGoods: 'Cost of goods', paymentsToSubcontractors: 'Subcontractors',
  wagesAndStaffCosts: 'Wages & staff', carVanTravelExpenses: 'Car/van & travel',
  premisesRunningCosts: 'Premises running costs', maintenanceCosts: 'Repairs & maintenance',
  adminCosts: 'Admin & office', businessEntertainmentCosts: 'Entertainment',
  advertisingCosts: 'Advertising & marketing', interestOnBankOtherLoans: 'Loan interest',
  financeCharges: 'Finance charges', irrecoverableDebts: 'Bad debts',
  professionalFees: 'Professional fees', depreciation: 'Depreciation', otherExpenses: 'Other expenses',
};

// PROPERTY (Property Business API v6.0) — field codelists not yet verified at
// build time. Until confirmed against the OAS, property submissions use a single
// `consolidatedExpenses` total. The income side is a single rents/period amount.
// TODO(phase-c): add verified UK non-FHL + foreign property field maps.
