import { LANDLORD_FINANCE_COST_CATEGORY } from '@/components/features/landlord/categories';

// ─── UK property income computation ──────────────────────────────────────────
// Shared by the on-screen Rent Computation and the Excel export so the two
// never diverge.
//
// Finance-cost restriction (individuals): since 2020/21 residential finance
// costs (mortgage interest etc.) are NOT deductible from a landlord's rental
// profit — they instead give a basic-rate (20%) tax reducer. Limited companies
// deduct finance costs normally, so the treatment depends on the entity type.
//
// Property income allowance: individuals may deduct a flat £1,000 instead of
// actual expenses (whichever is better); it can't create a loss.
//
// Losses: property losses carry forward and are set against future property
// profits automatically.

export type LandlordEntityType = 'individual' | 'company';
export const FINANCE_RELIEF_RATE = 0.20;
export const PROPERTY_INCOME_ALLOWANCE = 1000;

interface IncomeAmount { Amount: number }
interface ExpenseAmount { Category: string; Amount: number; CapitalExpense?: boolean }
interface CompAdjustment { type: 'income' | 'expense'; amount: number; category: string; description: string }

export interface RentComputationOpts {
  entityType: LandlordEntityType;
  /** Use the £1,000 property income allowance instead of actual expenses. */
  useAllowance?: boolean;
  /** Property losses brought forward from prior years. */
  broughtForwardLoss?: number;
}

export interface RentComputation {
  incomeTotal: number;
  incomeAdjustments: Array<{ description: string; amount: number }>;
  totalIncome: number;
  /** Deductible expense categories (finance costs excluded when restricted), with adjustments merged in. */
  expenseCategories: Array<{ category: string; amount: number }>;
  totalExpenses: number;
  /** Net rental profit/loss for the year, before brought-forward losses. */
  netProfit: number;

  // Property income allowance
  allowanceUsed: boolean;
  allowanceDeduction: number;
  /** True when the £1,000 allowance would give a bigger deduction than actual expenses. */
  allowanceWouldHelp: boolean;

  // Losses
  broughtForwardLoss: number;
  lossOffset: number;          // b/f loss used against this year's profit
  taxableProfit: number;       // netProfit − lossOffset (never below 0)
  lossCarriedForward: number;  // remaining b/f loss + this year's loss

  // Finance-cost restriction (individuals)
  restricted: boolean;
  financeCosts: number;
  financeReducer: number;
  unrelievedFinanceCosts: number;

  /** Capital items excluded from the deduction (kept for CGT base cost). */
  capitalExpenses: number;
}

// ─── Prior-year comparison rows ──────────────────────────────────────────────
// One ordered list of computation lines with current + prior amounts, shared by
// the on-screen comparison view, the Excel Comparison sheet and the PDF so all
// three agree. Expense categories are the union of both years (current order
// first). `prior` null → prior column stays blank.

export interface RentComparisonRow {
  label: string;
  current: number | null;
  prior: number | null;
  bold?: boolean;
  rule?: boolean;
  muted?: boolean;
  heading?: boolean;
}

export function buildComparisonRows(cur: RentComputation, prior: RentComputation | null): RentComparisonRow[] {
  const p = prior;
  const rows: RentComparisonRow[] = [];
  const pv = (n: number) => p ? n : null;

  rows.push({ label: 'Total rents and other income from property', current: cur.incomeTotal, prior: pv(p ? p.incomeTotal : 0) });
  rows.push({ label: 'Total income', current: cur.totalIncome, prior: pv(p ? p.totalIncome : 0), bold: true, rule: true });

  const curMap = new Map(cur.expenseCategories.map(e => [e.category, e.amount]));
  const priMap = new Map((p?.expenseCategories ?? []).map(e => [e.category, e.amount]));
  const order: string[] = [];
  for (const e of cur.expenseCategories) if (!order.includes(e.category)) order.push(e.category);
  for (const e of (p?.expenseCategories ?? [])) if (!order.includes(e.category)) order.push(e.category);
  for (const cat of order) rows.push({ label: cat, current: curMap.get(cat) ?? null, prior: p ? (priMap.get(cat) ?? null) : null });

  const totalLabel = cur.allowanceUsed ? 'Total deduction' : 'Total expenses';
  rows.push({ label: totalLabel, current: cur.totalExpenses, prior: pv(p ? p.totalExpenses : 0), bold: true, rule: true });
  rows.push({ label: cur.netProfit >= 0 ? 'Net rental profit' : 'Net rental loss', current: cur.netProfit, prior: pv(p ? p.netProfit : 0), bold: true, rule: true });

  const anyLoss = cur.broughtForwardLoss > 0 || cur.netProfit < 0 || !!(p && (p.broughtForwardLoss > 0 || p.netProfit < 0));
  if (anyLoss) {
    if (cur.broughtForwardLoss > 0 || !!(p && p.broughtForwardLoss > 0)) rows.push({ label: 'Losses brought forward', current: cur.broughtForwardLoss || null, prior: p ? (p.broughtForwardLoss || null) : null, muted: true });
    if (cur.lossOffset > 0 || !!(p && p.lossOffset > 0)) rows.push({ label: 'Loss set against profit', current: cur.lossOffset ? -cur.lossOffset : null, prior: p ? (p.lossOffset ? -p.lossOffset : null) : null, muted: true });
    if (cur.netProfit >= 0 || !!(p && p.netProfit >= 0)) rows.push({ label: 'Taxable profit after losses', current: cur.netProfit >= 0 ? cur.taxableProfit : null, prior: p ? (p.netProfit >= 0 ? p.taxableProfit : null) : null, bold: true });
    if (cur.lossCarriedForward > 0 || !!(p && p.lossCarriedForward > 0)) rows.push({ label: 'Losses carried forward', current: cur.lossCarriedForward || null, prior: p ? (p.lossCarriedForward || null) : null, muted: true });
  }

  const finVisible = (r: RentComputation) => r.restricted && !r.allowanceUsed && r.financeCosts > 0;
  if (finVisible(cur) || !!(p && finVisible(p))) {
    rows.push({ label: 'Finance costs (not deducted above)', current: null, prior: null, heading: true });
    rows.push({ label: 'Residential finance costs', current: cur.financeCosts || null, prior: p ? (p.financeCosts || null) : null });
    rows.push({ label: 'Basic-rate tax reduction (20%, estimate)', current: cur.financeReducer || null, prior: p ? (p.financeReducer || null) : null });
    if (cur.unrelievedFinanceCosts > 0.001 || !!(p && p.unrelievedFinanceCosts > 0.001)) rows.push({ label: 'Unrelieved finance costs carried forward', current: cur.unrelievedFinanceCosts || null, prior: p ? (p.unrelievedFinanceCosts || null) : null, muted: true });
  }

  if (cur.capitalExpenses > 0 || !!(p && p.capitalExpenses > 0)) {
    rows.push({ label: 'Capital items (not deducted)', current: null, prior: null, heading: true });
    rows.push({ label: 'Capital expenditure / improvements', current: cur.capitalExpenses || null, prior: p ? (p.capitalExpenses || null) : null });
  }

  return rows;
}

export function computeRentComputation(
  income: IncomeAmount[],
  expenses: ExpenseAmount[],
  adjustments: CompAdjustment[],
  opts: RentComputationOpts,
): RentComputation {
  const restricted = opts.entityType === 'individual';
  const broughtForwardLoss = Math.max(0, opts.broughtForwardLoss ?? 0);

  const incomeTotal = income.reduce((s, r) => s + (r.Amount || 0), 0);
  const incAdj = adjustments.filter(a => a.type === 'income');
  const incomeAdjustments = incAdj.map(a => ({ description: a.description, amount: a.amount }));
  const totalIncome = incomeTotal + incAdj.reduce((s, a) => s + a.amount, 0);

  // Merge expenses + expense adjustments into category buckets. Capital items
  // (improvements) are not allowable against rental income — they're excluded
  // from the deduction and reported separately. Replacements of domestic items
  // are repairs, not capital, so they are (correctly) left as CapitalExpense=false
  // and remain deductible.
  let capitalExpenses = 0;
  const byCat = new Map<string, number>();
  for (const r of expenses) {
    if (r.CapitalExpense) { capitalExpenses += (r.Amount || 0); continue; }
    byCat.set(r.Category, (byCat.get(r.Category) ?? 0) + (r.Amount || 0));
  }
  for (const a of adjustments.filter(a => a.type === 'expense')) {
    const cat = a.category || 'Other allowable property expenses';
    byCat.set(cat, (byCat.get(cat) ?? 0) + a.amount);
  }

  const financeCosts = byCat.get(LANDLORD_FINANCE_COST_CATEGORY) ?? 0;

  const deductibleCategories = Array.from(byCat.entries())
    .filter(([cat]) => !(restricted && cat === LANDLORD_FINANCE_COST_CATEGORY))
    .map(([category, amount]) => ({ category, amount }));
  const deductibleExpenses = deductibleCategories.reduce((s, e) => s + e.amount, 0);

  // Property income allowance — capped at income, and only when it beats expenses.
  const allowanceDeduction = Math.min(PROPERTY_INCOME_ALLOWANCE, Math.max(0, totalIncome));
  const allowanceWouldHelp = allowanceDeduction > deductibleExpenses;
  const allowanceUsed = !!opts.useAllowance;

  const expenseCategories = allowanceUsed
    ? [{ category: `Property income allowance`, amount: allowanceDeduction }]
    : deductibleCategories;
  const totalExpenses = allowanceUsed ? allowanceDeduction : deductibleExpenses;

  const netProfit = totalIncome - totalExpenses;

  // Brought-forward loss relief.
  let lossOffset = 0;
  let taxableProfit = netProfit;
  let lossCarriedForward = broughtForwardLoss;
  if (netProfit >= 0) {
    lossOffset = Math.min(broughtForwardLoss, netProfit);
    taxableProfit = netProfit - lossOffset;
    lossCarriedForward = broughtForwardLoss - lossOffset;
  } else {
    taxableProfit = 0;
    lossCarriedForward = broughtForwardLoss + Math.abs(netProfit);
  }

  // Finance-cost reducer (individuals, not when using the allowance).
  let financeReducer = 0;
  let unrelievedFinanceCosts = 0;
  if (restricted && !allowanceUsed && financeCosts > 0) {
    // Reducer is 20% of the lower of finance costs and property profits (after
    // loss relief). It's also capped by the client's total taxable income above
    // the personal allowance, which we don't have here — hence "estimate".
    const reliefBase = Math.min(financeCosts, Math.max(0, taxableProfit));
    financeReducer = reliefBase * FINANCE_RELIEF_RATE;
    unrelievedFinanceCosts = financeCosts - reliefBase;
  }

  return {
    incomeTotal, incomeAdjustments, totalIncome,
    expenseCategories, totalExpenses, netProfit,
    allowanceUsed, allowanceDeduction, allowanceWouldHelp,
    broughtForwardLoss, lossOffset, taxableProfit, lossCarriedForward,
    restricted, financeCosts, financeReducer, unrelievedFinanceCosts,
    capitalExpenses,
  };
}
