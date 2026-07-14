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
interface ExpenseAmount { Category: string; Amount: number }
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

  // Merge expenses + expense adjustments into category buckets.
  const byCat = new Map<string, number>();
  for (const r of expenses) byCat.set(r.Category, (byCat.get(r.Category) ?? 0) + (r.Amount || 0));
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
  };
}
