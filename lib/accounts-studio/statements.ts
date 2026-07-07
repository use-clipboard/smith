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
// Companies Act small-company balance-sheet format: fixed assets, current
// assets, creditors < 1yr, net current assets, total assets less current
// liabilities, creditors > 1yr, provisions, net assets, capital & reserves.
export interface BalanceSheet {
  fixedAssets: StmtGroup[];         fixedAssetsTotal: number;         fixedAssetsTotalPrior: number | null;
  currentAssets: StmtGroup[];       currentAssetsTotal: number;       currentAssetsTotalPrior: number | null;
  creditorsWithin: StmtGroup[];     creditorsWithinTotal: number;     creditorsWithinTotalPrior: number | null;
  netCurrentAssets: number;         netCurrentAssetsPrior: number | null;
  totalAssetsLessCurrent: number;   totalAssetsLessCurrentPrior: number | null;
  creditorsAfter: StmtGroup[];      creditorsAfterTotal: number;      creditorsAfterTotalPrior: number | null;
  provisions: StmtGroup[];          provisionsTotal: number;          provisionsTotalPrior: number | null;
  netAssets: number;                netAssetsPrior: number | null;
  capitalAndReserves: StmtGroup[];  capitalTotal: number;             capitalTotalPrior: number | null;
  profitForYear: number;            profitForYearPrior: number | null;
  totalEquity: number;              totalEquityPrior: number | null;
  // Convenience aggregates (used by size detection, validations, headline figures).
  totalAssets: number;              totalAssetsPrior: number | null;
  totalLiabilities: number;         totalLiabilitiesPrior: number | null;
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

// ── Statutory balance-sheet classification (heuristic, name/ledger-based) ─────
/** Fixed (non-current) asset vs current asset. Current keywords win. */
function assetIsFixed(ledger: string | null, name: string): boolean {
  const s = `${ledger ?? ''} ${name}`.toLowerCase();
  if (/current asset|debtor|receivable|prepay|accrued income|stock|inventor|work in progress|\bwip\b|\bbank\b|\bcash\b|petty|deposit account/.test(s)) return false;
  return /fixed asset|tangible|intangible|goodwill|plant|machinery|equipment|fixture|fitting|motor|vehicle|property|\bland\b|building|freehold|leasehold|depreciation|amortis|investment/.test(s);
}
type LiabClass = 'within' | 'after' | 'provision';
/** Split creditors into <1yr, >1yr and provisions. Defaults to within one year. */
function liabilityClass(ledger: string | null, name: string): LiabClass {
  const s = `${ledger ?? ''} ${name}`.toLowerCase();
  if (/provision|deferred tax/.test(s)) return 'provision';
  if (/after (more than )?one year|> ?1 ?year|over one year|long[- ]term|non[- ]current|mortgage|debenture|falling due after/.test(s)) return 'after';
  return 'within';
}

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

  // ── Balance Sheet (Companies Act small-company format) ───────────────────────
  const curAsset = current.bs.filter(a => a.account_type === 'asset');
  const priAsset = priorBs?.filter(a => a.account_type === 'asset') ?? null;
  const curLiab  = current.bs.filter(a => a.account_type === 'liability');
  const priLiab  = priorBs?.filter(a => a.account_type === 'liability') ?? null;

  const fixedAssets   = groupWithPrior(curAsset.filter(a => assetIsFixed(a.ledger, a.name)),  priAsset?.filter(a => assetIsFixed(a.ledger, a.name)) ?? null,  assetAmt);
  const currentAssets = groupWithPrior(curAsset.filter(a => !assetIsFixed(a.ledger, a.name)), priAsset?.filter(a => !assetIsFixed(a.ledger, a.name)) ?? null, assetAmt);
  const creditorsWithin = groupWithPrior(curLiab.filter(a => liabilityClass(a.ledger, a.name) === 'within'), priLiab?.filter(a => liabilityClass(a.ledger, a.name) === 'within') ?? null, liabEqAmt);
  const creditorsAfter  = groupWithPrior(curLiab.filter(a => liabilityClass(a.ledger, a.name) === 'after'),  priLiab?.filter(a => liabilityClass(a.ledger, a.name) === 'after') ?? null,  liabEqAmt);
  const provisions      = groupWithPrior(curLiab.filter(a => liabilityClass(a.ledger, a.name) === 'provision'), priLiab?.filter(a => liabilityClass(a.ledger, a.name) === 'provision') ?? null, liabEqAmt);
  const capitalAndReserves = groupWithPrior(current.bs.filter(a => a.account_type === 'equity'), priorBs?.filter(a => a.account_type === 'equity') ?? null, liabEqAmt);

  const fixedAssetsTotal      = sumTotal(fixedAssets);
  const currentAssetsTotal    = sumTotal(currentAssets);
  const creditorsWithinTotal  = sumTotal(creditorsWithin);
  const creditorsAfterTotal   = sumTotal(creditorsAfter);
  const provisionsTotal       = sumTotal(provisions);
  const netCurrentAssets      = r2(currentAssetsTotal - creditorsWithinTotal);
  const totalAssetsLessCurrent = r2(fixedAssetsTotal + netCurrentAssets);
  const netAssets             = r2(totalAssetsLessCurrent - creditorsAfterTotal - provisionsTotal);
  const capitalTotal          = sumTotal(capitalAndReserves);
  const profitForYear         = r2(current.bsNetProfit);
  const totalEquity           = r2(capitalTotal + profitForYear);
  const totalAssets           = r2(fixedAssetsTotal + currentAssetsTotal);
  const totalLiabilities      = r2(creditorsWithinTotal + creditorsAfterTotal + provisionsTotal);

  const fixedAssetsTotalPrior     = sumTotalPrior(fixedAssets, hasPrior);
  const currentAssetsTotalPrior   = sumTotalPrior(currentAssets, hasPrior);
  const creditorsWithinTotalPrior = sumTotalPrior(creditorsWithin, hasPrior);
  const creditorsAfterTotalPrior  = sumTotalPrior(creditorsAfter, hasPrior);
  const provisionsTotalPrior      = sumTotalPrior(provisions, hasPrior);
  const netCurrentAssetsPrior     = hasPrior ? r2((currentAssetsTotalPrior ?? 0) - (creditorsWithinTotalPrior ?? 0)) : null;
  const totalAssetsLessCurrentPrior = hasPrior ? r2((fixedAssetsTotalPrior ?? 0) + (netCurrentAssetsPrior ?? 0)) : null;
  const netAssetsPrior            = hasPrior ? r2((totalAssetsLessCurrentPrior ?? 0) - (creditorsAfterTotalPrior ?? 0) - (provisionsTotalPrior ?? 0)) : null;
  const capitalTotalPrior         = sumTotalPrior(capitalAndReserves, hasPrior);
  const profitForYearPrior        = hasPrior ? r2(prior!.bsNetProfit) : null;
  const totalEquityPrior          = hasPrior ? r2((capitalTotalPrior ?? 0) + (profitForYearPrior ?? 0)) : null;
  const totalAssetsPrior          = hasPrior ? r2((fixedAssetsTotalPrior ?? 0) + (currentAssetsTotalPrior ?? 0)) : null;
  const totalLiabilitiesPrior     = hasPrior ? r2((creditorsWithinTotalPrior ?? 0) + (creditorsAfterTotalPrior ?? 0) + (provisionsTotalPrior ?? 0)) : null;

  return {
    hasPrior,
    profitLoss: {
      turnover, turnoverTotal, turnoverTotalPrior,
      costOfSales, grossProfit, grossProfitPrior,
      expenses, operatingProfit, operatingProfitPrior,
      taxation, netProfit, netProfitPrior,
    },
    balanceSheet: {
      fixedAssets, fixedAssetsTotal, fixedAssetsTotalPrior,
      currentAssets, currentAssetsTotal, currentAssetsTotalPrior,
      creditorsWithin, creditorsWithinTotal, creditorsWithinTotalPrior,
      netCurrentAssets, netCurrentAssetsPrior,
      totalAssetsLessCurrent, totalAssetsLessCurrentPrior,
      creditorsAfter, creditorsAfterTotal, creditorsAfterTotalPrior,
      provisions, provisionsTotal, provisionsTotalPrior,
      netAssets, netAssetsPrior,
      capitalAndReserves, capitalTotal, capitalTotalPrior,
      profitForYear, profitForYearPrior,
      totalEquity, totalEquityPrior,
      totalAssets, totalAssetsPrior,
      totalLiabilities, totalLiabilitiesPrior,
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

// ── Filleted accounts eligibility (Companies House filing) ───────────────────
// Only companies/LLPs that qualify as small (or micro) under the small companies
// regime may deliver "filleted" accounts (balance sheet + notes, no P&L /
// directors' report). Medium/large entities must file full accounts.
const FILING_ENTITIES = ['limited_company', 'cic', 'dormant_company', 'llp'];

export function filletEligibility(entityType: string, size: StudioSize): {
  filingEntity: boolean;   // files at Companies House at all
  eligible: boolean;       // may fillet
  reason: string;          // why not, when !eligible
} {
  if (!FILING_ENTITIES.includes(entityType)) {
    return { filingEntity: false, eligible: false, reason: 'Filleted accounts apply only to companies and LLPs that file at Companies House.' };
  }
  if (size === 'micro' || size === 'small') {
    return { filingEntity: true, eligible: true, reason: '' };
  }
  const kind = entityType === 'llp' ? 'LLP' : 'company';
  return {
    filingEntity: true,
    eligible: false,
    reason: `This is a ${size}-sized ${kind}, so it doesn't qualify for the small companies regime. Full accounts must be delivered to Companies House — filleted accounts aren't permitted.`,
  };
}

/** Applicable framework label from entity type + size. */
export function detectFramework(entityType: string, size: StudioSize): string {
  if (entityType === 'charity') return 'FRS 102 (Charities SORP)';
  if (size === 'micro' && (entityType === 'limited_company' || entityType === 'sole_trader' || entityType === 'partnership')) {
    return 'FRS 105 (Micro-entity)';
  }
  // Traditional partnerships aren't under the Companies Act small-companies
  // regime, so they use full FRS 102 (never "Section 1A" — that's for small
  // companies and LLPs). LLPs get 1A + the LLP SORP.
  if (entityType === 'partnership') return 'FRS 102';
  const base = size === 'small' ? 'FRS 102 Section 1A' : 'FRS 102';
  if (entityType === 'llp') return `${base} (LLP SORP)`;
  return base;
}
