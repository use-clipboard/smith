// Unit tests for the residential finance-cost restriction wiring.
// Run:  npx tsx lib/mtdIt/__tests__/residentialFinance.test.ts
//
// Covers the two correctness-critical pieces:
//   1. category → residential/non-residential detection (financeCosts.ts)
//   2. HMRC body emission — residential finance reported in its own field and
//      kept OUT of deductible expenses, for both UK and foreign (hmrcBody.ts)

import assert from 'node:assert/strict';
import { isResidentialFinanceCost, isNonResidentialFinanceCost, financeCategoryImpliedUse } from '../financeCosts';
import { buildUkPropertyCumulativeBody, buildForeignPropertyCumulativeBody, buildForeignPropertyByIdCumulativeBody, foreignCumulativeUsesPropertyId } from '../hmrcBody';
import { landlordCategoryToMtd, LANDLORD_FINANCE_COST_CATEGORY, LANDLORD_NON_RESIDENTIAL_FINANCE_COST_CATEGORY } from '../landlordCategoryMap';
import type { CumulativeResult } from '../computeUpdate';

let passed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n`, e); process.exitCode = 1; }
}

// ── 1. Detection ────────────────────────────────────────────────────────────
check('Residential Finance Costs → residential', () => {
  assert.equal(isResidentialFinanceCost('Residential Finance Costs'), true);
  assert.equal(isNonResidentialFinanceCost('Residential Finance Costs'), false);
  assert.equal(financeCategoryImpliedUse('Residential Finance Costs'), 'residential');
});

check('Non-Residential Finance Costs → commercial (NOT residential)', () => {
  // "non-residential" contains "residential" as a substring — the exclusion
  // must win, or every commercial finance cost would be wrongly restricted.
  assert.equal(isResidentialFinanceCost('Non-Residential Finance Costs'), false);
  assert.equal(isNonResidentialFinanceCost('Non-Residential Finance Costs'), true);
  assert.equal(financeCategoryImpliedUse('Non-Residential Finance Costs'), 'commercial');
});

check('legacy "Non Residential Financial Costs" → NOT residential', () => {
  assert.equal(isResidentialFinanceCost('Non Residential Financial Costs'), false);
});

check('non-finance categories → neither', () => {
  for (const c of ['Repairs and Maintenance', 'Premises Running Costs', 'Other Expenses', '', null, undefined]) {
    assert.equal(isResidentialFinanceCost(c), false, `resi ${c}`);
    assert.equal(isNonResidentialFinanceCost(c), false, `nonresi ${c}`);
    assert.equal(financeCategoryImpliedUse(c), null, `implied ${c}`);
  }
});

// ── 2. UK body ──────────────────────────────────────────────────────────────
const baseUk: CumulativeResult = {
  typeOfBusiness: 'uk-property', businessId: 'X', name: 'UK property',
  periodStartDate: '2026-04-06', periodEndDate: '2026-07-05',
  income: 1000, expensesByField: { premisesRunningCosts: 200 }, consolidatedExpenses: 200,
  residentialFinanceCost: 500, residentialFinanceCostBroughtFwd: 120,
  rowCount: 3, warnings: [],
};

check('UK itemised: residential finance in its own field, not in expenses total', () => {
  const body = buildUkPropertyCumulativeBody(baseUk, false);
  assert.equal(body.ukProperty.expenses.residentialFinancialCost, 500);
  assert.equal(body.ukProperty.expenses.residentialFinancialCostsCarriedForward, 120);
  assert.equal(body.ukProperty.expenses.premisesRunningCosts, 200);
  // residential finance must NOT be summed into any deductible field
  assert.equal(body.ukProperty.expenses.consolidatedExpenses, undefined);
});

check('UK consolidated: residential finance emitted ALONGSIDE consolidatedExpenses', () => {
  const body = buildUkPropertyCumulativeBody(baseUk, true);
  assert.equal(body.ukProperty.expenses.consolidatedExpenses, 200);
  assert.equal(body.ukProperty.expenses.residentialFinancialCost, 500);
  assert.equal(body.ukProperty.expenses.residentialFinancialCostsCarriedForward, 120);
});

check('UK: uses the "Financial" spelling, never "residentialFinanceCost"', () => {
  const body = buildUkPropertyCumulativeBody(baseUk, false);
  assert.equal('residentialFinanceCost' in body.ukProperty.expenses, false);
});

check('UK: zero residential finance emits no field', () => {
  const body = buildUkPropertyCumulativeBody({ ...baseUk, residentialFinanceCost: 0, residentialFinanceCostBroughtFwd: 0 }, false);
  assert.equal('residentialFinancialCost' in body.ukProperty.expenses, false);
  assert.equal('residentialFinancialCostsCarriedForward' in body.ukProperty.expenses, false);
});

// ── 3. Foreign body ─────────────────────────────────────────────────────────
check('Foreign: residential finance + broughtFwd (different field name)', () => {
  const body = buildForeignPropertyCumulativeBody('2026-04-06', '2026-07-05', [{
    countryCode: 'FRA', income: 800, expensesByField: { premisesRunningCosts: 100 },
    consolidatedExpenses: 100, residentialFinanceCost: 300, residentialFinanceCostBroughtFwd: 50,
  }], false);
  const exp = body.foreignProperty[0].expenses;
  assert.equal(exp.residentialFinancialCost, 300);
  assert.equal(exp.broughtFwdResidentialFinancialCost, 50);       // foreign spelling
  assert.equal('residentialFinancialCostsCarriedForward' in exp, false); // NOT the UK spelling
  assert.equal(exp.premisesRunningCosts, 100);
});

// ── 3b. Foreign body — TY 2026-27+ def2 (keyed by propertyId) ────────────────
check('foreignCumulativeUsesPropertyId gates on tax year 2026-27+', () => {
  assert.equal(foreignCumulativeUsesPropertyId(2025), false); // 2025-26 → def1 (countryCode)
  assert.equal(foreignCumulativeUsesPropertyId(2026), true);  // 2026-27 → def2 (propertyId)
  assert.equal(foreignCumulativeUsesPropertyId(2027), true);
});

check('def2 body: keyed by propertyId, NOT countryCode; same income/expense shape', () => {
  const body = buildForeignPropertyByIdCumulativeBody('2026-04-06', '2026-07-05', [{
    propertyId: '8e8b8450-dc1b-4360-8109-7067337b42cb', income: 800,
    expensesByField: { premisesRunningCosts: 100 }, consolidatedExpenses: 100,
    residentialFinanceCost: 300, residentialFinanceCostBroughtFwd: 50,
  }], false);
  const item = body.foreignProperty[0];
  assert.equal(item.propertyId, '8e8b8450-dc1b-4360-8109-7067337b42cb');
  assert.equal('countryCode' in item, false);                     // def2 has NO countryCode
  assert.equal(item.income.rentIncome.rentAmount, 800);           // same income nesting as def1
  assert.equal(item.expenses.residentialFinancialCost, 300);
  assert.equal(item.expenses.broughtFwdResidentialFinancialCost, 50);
  assert.equal(item.expenses.premisesRunningCosts, 100);
  assert.equal(body.fromDate, '2026-04-06');
  assert.equal(body.toDate, '2026-07-05');
});

check('def2 body: consolidated expenses mode', () => {
  const body = buildForeignPropertyByIdCumulativeBody('2026-04-06', '2026-07-05', [{
    propertyId: 'p1', income: 500, expensesByField: { premisesRunningCosts: 100 },
    consolidatedExpenses: 250, residentialFinanceCost: 0, residentialFinanceCostBroughtFwd: 0,
  }], true);
  const exp = body.foreignProperty[0].expenses;
  assert.equal(exp.consolidatedExpenses, 250);
  assert.equal('premisesRunningCosts' in exp, false); // itemised fields omitted when consolidated
});

// ── 4. Landlord → MTD category mapping (the feed) ─────────────────────────────
check('Landlord finance cost → Residential by default, is detected as residential', () => {
  const mapped = landlordCategoryToMtd(LANDLORD_FINANCE_COST_CATEGORY);
  assert.equal(mapped, 'Residential Finance Costs');
  assert.equal(isResidentialFinanceCost(mapped), true); // the whole point of the feed fix
});

check('Landlord finance cost on a COMMERCIAL property → Non-Residential', () => {
  const mapped = landlordCategoryToMtd(LANDLORD_FINANCE_COST_CATEGORY, { propertyUseType: 'commercial' });
  assert.equal(mapped, 'Non-Residential Finance Costs');
  assert.equal(isResidentialFinanceCost(mapped), false);
});

check('Raw landlord finance string would NOT be detected as residential (regression guard)', () => {
  // Proves why the mapping is necessary: the SA105 string has no "residential".
  assert.equal(isResidentialFinanceCost(LANDLORD_FINANCE_COST_CATEGORY), false);
});

check('Landlord SA105 expense/income categories map onto the MTD list', () => {
  assert.equal(landlordCategoryToMtd('Total rents and other income from property'), 'Rent Income');
  assert.equal(landlordCategoryToMtd('Property repairs and maintenance'), 'Repairs and Maintenance');
  assert.equal(landlordCategoryToMtd('Rent, rates, insurance, ground rents'), 'Premises Running Costs');
  assert.equal(landlordCategoryToMtd('Legal, management and other professional fees'), 'Professional Fees');
  assert.equal(landlordCategoryToMtd('Car, van and other travel expenses'), 'Travel Costs');
  assert.equal(landlordCategoryToMtd('Costs of services provided, including wages'), 'Cost of Service');
  assert.equal(landlordCategoryToMtd('Other allowable property expenses'), 'Other Expenses');
});

check('Landlord explicit commercial finance category → Non-Residential (always)', () => {
  // Explicit category wins regardless of the property marker.
  assert.equal(landlordCategoryToMtd(LANDLORD_NON_RESIDENTIAL_FINANCE_COST_CATEGORY), 'Non-Residential Finance Costs');
  assert.equal(landlordCategoryToMtd(LANDLORD_NON_RESIDENTIAL_FINANCE_COST_CATEGORY, { propertyUseType: 'residential' }), 'Non-Residential Finance Costs');
});

check('Unknown category falls through unchanged', () => {
  assert.equal(landlordCategoryToMtd('Something bespoke'), 'Something bespoke');
});

console.log(`\n${passed} checks passed.`);
