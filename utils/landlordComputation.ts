import { LANDLORD_FINANCE_COST_CATEGORY } from '@/components/features/landlord/categories';

// ─── UK property income computation ──────────────────────────────────────────
// Shared by the on-screen Rent Computation and the Excel export so the two
// never diverge.
//
// Finance-cost restriction (individuals): since 2020/21 residential finance
// costs (mortgage interest etc.) are NOT deductible from a landlord's rental
// profit — they instead give a basic-rate (20%) tax reducer. Limited companies
// deduct finance costs normally, so the treatment depends on the entity type.

export type LandlordEntityType = 'individual' | 'company';
export const FINANCE_RELIEF_RATE = 0.20;

interface IncomeAmount { Amount: number }
interface ExpenseAmount { Category: string; Amount: number }
interface CompAdjustment { type: 'income' | 'expense'; amount: number; category: string; description: string }

export interface RentComputation {
  incomeTotal: number;
  incomeAdjustments: Array<{ description: string; amount: number }>;
  totalIncome: number;
  /** Deductible expense categories (finance costs excluded when restricted), with adjustments merged in. */
  expenseCategories: Array<{ category: string; amount: number }>;
  totalExpenses: number;
  /** Taxable property profit = totalIncome − totalExpenses. */
  netProfit: number;
  /** True when the finance-cost restriction was applied (individual landlord). */
  restricted: boolean;
  financeCosts: number;
  /** Estimated basic-rate tax reduction (20% of the relievable finance costs). */
  financeReducer: number;
  /** Finance costs not relieved this year (carried forward). Informational. */
  unrelievedFinanceCosts: number;
}

export function computeRentComputation(
  income: IncomeAmount[],
  expenses: ExpenseAmount[],
  adjustments: CompAdjustment[],
  opts: { entityType: LandlordEntityType },
): RentComputation {
  const restricted = opts.entityType === 'individual';

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

  const expenseCategories = Array.from(byCat.entries())
    .filter(([cat]) => !(restricted && cat === LANDLORD_FINANCE_COST_CATEGORY))
    .map(([category, amount]) => ({ category, amount }));

  const totalExpenses = expenseCategories.reduce((s, e) => s + e.amount, 0);
  const netProfit = totalIncome - totalExpenses;

  let financeReducer = 0;
  let unrelievedFinanceCosts = 0;
  if (restricted && financeCosts > 0) {
    // Reducer is 20% of the lower of finance costs and property profits.
    // (The reducer is also capped by the client's total taxable income above
    // the personal allowance, which we don't have here — hence "estimate".)
    const reliefBase = Math.min(financeCosts, Math.max(0, netProfit));
    financeReducer = reliefBase * FINANCE_RELIEF_RATE;
    unrelievedFinanceCosts = financeCosts - reliefBase;
  }

  return {
    incomeTotal, incomeAdjustments, totalIncome,
    expenseCategories, totalExpenses, netProfit,
    restricted, financeCosts, financeReducer, unrelievedFinanceCosts,
  };
}
