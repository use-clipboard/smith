// Accounts Studio — build STRUCTURED statutory statements from book balances.
//
// Mirrors the grouping used by the bookkeeping report tabs and the text
// statement builder (lib/bookkeeping/statementText.ts) so the numbers match
// what the user sees elsewhere — but returns structured data (sections, lines,
// subtotals) with prior-year comparatives, ready to render and to persist on an
// engagement. Pure functions over already-aggregated BalanceAccount[].

import type { BalanceAccount } from '@/lib/bookkeeping/balances';

const r2 = (n: number) => +n.toFixed(2);

// ── Structured statement shapes (persisted on the engagement) ────────────────
export interface StmtLine {
  label: string;
  current: number;
  prior: number | null;
}
export interface StmtGroup {
  title: string;           // ledger name
  lines: StmtLine[];
  total: number;
  totalPrior: number | null;
}
export interface ProfitLoss {
  turnover: StmtGroup[];
  turnoverTotal: number;   turnoverTotalPrior: number | null;
  costOfSales: StmtGroup[];
  grossProfit: number;     grossProfitPrior: number | null;
  expenses: StmtGroup[];
  operatingProfit: number; operatingProfitPrior: number | null;
  taxation: StmtGroup[];
  netProfit: number;       netProfitPrior: number | null;
}
export interface BalanceSheet {
  assets: StmtGroup[];        totalAssets: number;      totalAssetsPrior: number | null;
  liabilities: StmtGroup[];   totalLiabilities: number; totalLiabilitiesPrior: number | null;
  netAssets: number;          netAssetsPrior: number | null;
  equity: StmtGroup[];
  profitForYear: number;      profitForYearPrior: number | null;
  totalEquity: number;        totalEquityPrior: number | null;
}
export interface FinancialStatements {
  hasPrior: boolean;
  profitLoss: ProfitLoss;
  balanceSheet: BalanceSheet;
}

// ── P&L bucketing (mirrors statementText.plBucket / ProfitLossTab) ───────────
type PlBucket = 'income' | 'cost_of_sales' | 'expense' | 'taxation';
function plBucket(ledger: string | null, accountType: string): PlBucket {
  const lc = (ledger ?? '').toLowerCase();
  if (lc === 'income' || lc.includes('income') || lc.includes('sales') || lc.includes('revenue')) return 'income';
  if (lc.includes('cost of sales') || lc.includes('cogs')) return 'cost_of_sales';
  if (lc.includes('tax')) return 'taxation';
  if (accountType === 'income') return 'income';
  return 'expense';
}

type AmountOf = (a: BalanceAccount) => number;
const incomeAmt: AmountOf = a => r2(a.credit_total - a.debit_total);
const costAmt:   AmountOf = a => r2(a.debit_total - a.credit_total);
const assetAmt:  AmountOf = a => r2(a.debit_total - a.credit_total);
const liabEqAmt: AmountOf = a => r2(a.credit_total - a.debit_total);

/**
 * Group current + prior accounts into ledger sections, matching lines by name
 * so comparatives sit on the same row. Drops lines that are ~0 in both periods.
 */
function groupWithPrior(
  current: BalanceAccount[],
  prior: BalanceAccount[] | null,
  amountOf: AmountOf,
): StmtGroup[] {
  // ledger → (accountName → { current, prior })
  const byLedger = new Map<string, Map<string, { current: number; prior: number | null }>>();
  const cell = (ledger: string, name: string) => {
    const l = byLedger.get(ledger) ?? new Map();
    byLedger.set(ledger, l);
    const c = l.get(name) ?? { current: 0, prior: prior ? 0 : null };
    l.set(name, c);
    return c;
  };
  for (const a of current) { const c = cell(a.ledger ?? 'Other', a.name); c.current = r2(c.current + amountOf(a)); }
  if (prior) for (const a of prior) { const c = cell(a.ledger ?? 'Other', a.name); c.prior = r2((c.prior ?? 0) + amountOf(a)); }

  const groups: StmtGroup[] = [];
  for (const [ledger, names] of [...byLedger.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lines: StmtLine[] = [];
    let total = 0; let totalPrior: number | null = prior ? 0 : null;
    for (const [name, v] of [...names.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (Math.abs(v.current) < 0.005 && Math.abs(v.prior ?? 0) < 0.005) continue;
      lines.push({ label: name, current: v.current, prior: v.prior });
      total = r2(total + v.current);
      if (prior) totalPrior = r2((totalPrior ?? 0) + (v.prior ?? 0));
    }
    if (lines.length) groups.push({ title: ledger, lines, total, totalPrior });
  }
  return groups;
}

const sumTotal = (g: StmtGroup[]) => r2(g.reduce((s, x) => s + x.total, 0));
const sumTotalPrior = (g: StmtGroup[], hasPrior: boolean): number | null =>
  hasPrior ? r2(g.reduce((s, x) => s + (x.totalPrior ?? 0), 0)) : null;

interface PeriodInput { pl: BalanceAccount[]; bs: BalanceAccount[]; bsNetProfit: number }

export function buildStatements(current: PeriodInput, prior?: PeriodInput | null): FinancialStatements {
  const hasPrior = !!prior;
  const priorPl = prior?.pl ?? null;
  const priorBs = prior?.bs ?? null;

  // ── Profit & Loss ──────────────────────────────────────────────────────────
  const bucket = (accts: BalanceAccount[] | null, b: PlBucket) =>
    accts ? accts.filter(a => (a.account_type === 'income' || a.account_type === 'expense') && plBucket(a.ledger, a.account_type) === b) : null;

  const turnover    = groupWithPrior(bucket(current.pl, 'income')!,        bucket(priorPl, 'income'),        incomeAmt);
  const costOfSales = groupWithPrior(bucket(current.pl, 'cost_of_sales')!, bucket(priorPl, 'cost_of_sales'), costAmt);
  const expenses    = groupWithPrior(bucket(current.pl, 'expense')!,       bucket(priorPl, 'expense'),       costAmt);
  const taxation    = groupWithPrior(bucket(current.pl, 'taxation')!,      bucket(priorPl, 'taxation'),      costAmt);

  const turnoverTotal = sumTotal(turnover);
  const cosTotal = sumTotal(costOfSales);
  const expTotal = sumTotal(expenses);
  const taxTotal = sumTotal(taxation);
  const grossProfit = r2(turnoverTotal - cosTotal);
  const operatingProfit = r2(grossProfit - expTotal);
  const netProfit = r2(operatingProfit - taxTotal);

  const turnoverTotalPrior = sumTotalPrior(turnover, hasPrior);
  const cosTotalPrior = sumTotalPrior(costOfSales, hasPrior);
  const expTotalPrior = sumTotalPrior(expenses, hasPrior);
  const taxTotalPrior = sumTotalPrior(taxation, hasPrior);
  const grossProfitPrior = hasPrior ? r2((turnoverTotalPrior ?? 0) - (cosTotalPrior ?? 0)) : null;
  const operatingProfitPrior = hasPrior ? r2((grossProfitPrior ?? 0) - (expTotalPrior ?? 0)) : null;
  const netProfitPrior = hasPrior ? r2((operatingProfitPrior ?? 0) - (taxTotalPrior ?? 0)) : null;

  // ── Balance Sheet ──────────────────────────────────────────────────────────
  const assets      = groupWithPrior(current.bs.filter(a => a.account_type === 'asset'),     priorBs?.filter(a => a.account_type === 'asset') ?? null,     assetAmt);
  const liabilities = groupWithPrior(current.bs.filter(a => a.account_type === 'liability'), priorBs?.filter(a => a.account_type === 'liability') ?? null, liabEqAmt);
  const equity      = groupWithPrior(current.bs.filter(a => a.account_type === 'equity'),    priorBs?.filter(a => a.account_type === 'equity') ?? null,    liabEqAmt);

  const totalAssets = sumTotal(assets);
  const totalLiabilities = sumTotal(liabilities);
  const netAssets = r2(totalAssets - totalLiabilities);
  const equityBooked = sumTotal(equity);
  const profitForYear = r2(current.bsNetProfit);
  const totalEquity = r2(equityBooked + profitForYear);

  const totalAssetsPrior = sumTotalPrior(assets, hasPrior);
  const totalLiabilitiesPrior = sumTotalPrior(liabilities, hasPrior);
  const netAssetsPrior = hasPrior ? r2((totalAssetsPrior ?? 0) - (totalLiabilitiesPrior ?? 0)) : null;
  const equityBookedPrior = sumTotalPrior(equity, hasPrior);
  const profitForYearPrior = hasPrior ? r2(prior!.bsNetProfit) : null;
  const totalEquityPrior = hasPrior ? r2((equityBookedPrior ?? 0) + (profitForYearPrior ?? 0)) : null;

  return {
    hasPrior,
    profitLoss: {
      turnover, turnoverTotal, turnoverTotalPrior,
      costOfSales, grossProfit, grossProfitPrior,
      expenses, operatingProfit, operatingProfitPrior,
      taxation, netProfit, netProfitPrior,
    },
    balanceSheet: {
      assets, totalAssets, totalAssetsPrior,
      liabilities, totalLiabilities, totalLiabilitiesPrior,
      netAssets, netAssetsPrior,
      equity, profitForYear, profitForYearPrior,
      totalEquity, totalEquityPrior,
    },
  };
}

// ── Framework / size detection ───────────────────────────────────────────────
// Companies Act size thresholds (two of three must be met). Employees aren't
// available from the ledger, so we classify on turnover + balance-sheet total
// (gross assets) — a sound default the preparer can override.
export type StudioSize = 'micro' | 'small' | 'medium' | 'large';

export function detectSize(turnover: number, grossAssets: number): StudioSize {
  const t = Math.abs(turnover); const a = Math.abs(grossAssets);
  // Micro-entity: turnover ≤ £632k, balance-sheet total ≤ £316k.
  if (t <= 632_000 && a <= 316_000) return 'micro';
  // Small: turnover ≤ £10.2m, balance-sheet total ≤ £5.1m.
  if (t <= 10_200_000 && a <= 5_100_000) return 'small';
  // Medium: turnover ≤ £36m, balance-sheet total ≤ £18m.
  if (t <= 36_000_000 && a <= 18_000_000) return 'medium';
  return 'large';
}

/** Applicable framework label from entity type + size. */
export function detectFramework(entityType: string, size: StudioSize): string {
  if (entityType === 'charity') return 'FRS 102 (Charities SORP)';
  if (size === 'micro' && (entityType === 'limited_company' || entityType === 'sole_trader' || entityType === 'partnership')) {
    return 'FRS 105 (Micro-entity)';
  }
  const base = size === 'small' ? 'FRS 102 Section 1A' : 'FRS 102';
  if (entityType === 'llp') return `${base} (LLP SORP)`;
  return base;
}
