// Turn aggregated book balances into clean, plain-text financial statements
// (Trial Balance, Profit & Loss, Balance Sheet) for handing to the Accounts
// Review / Performance AI tools. Text — not a scanned PDF — so the figures are
// exact and the model never has to OCR. Grouping mirrors the bookkeeping report
// tabs (ProfitLossTab / BalanceSheetTab / TrialBalanceTab) so the handed-over
// statements match what the user sees on screen.

import type { BalanceAccount } from './balances';

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Accountant's number: thousands-separated, 2dp, negatives in parentheses. */
function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
}

/** One "Label ............ amount" line, right-aligned amount in a 16-wide col. */
function row(label: string, amount: number, indent = 0): string {
  const pad = ' '.repeat(indent);
  const amt = money(amount).padStart(16);
  return `${pad}${label}`.padEnd(48) + amt;
}

function rule(char = '-'): string {
  return char.repeat(64);
}

// ── Ledger → P&L bucket (mirrors ProfitLossTab.bucketForLedger) ──────────────

type PlBucket = 'income' | 'cost_of_sales' | 'expense' | 'taxation';

function plBucket(ledger: string | null, accountType: string): PlBucket {
  const lc = (ledger ?? '').toLowerCase();
  if (lc === 'income' || lc.includes('income') || lc.includes('sales') || lc.includes('revenue')) return 'income';
  if (lc.includes('cost of sales') || lc.includes('cogs')) return 'cost_of_sales';
  if (lc.includes('tax')) return 'taxation';
  if (accountType === 'income') return 'income';
  return 'expense';
}

// ── Section helpers ──────────────────────────────────────────────────────────

interface Section { ledger: string; accounts: { name: string; amount: number }[]; total: number }

function groupByLedger(
  accounts: BalanceAccount[],
  amountOf: (a: BalanceAccount) => number,
): Section[] {
  const byLedger = new Map<string, Section>();
  for (const a of accounts) {
    const amount = amountOf(a);
    if (Math.abs(amount) < 0.005) continue; // drop zero rows
    const key = a.ledger ?? 'Other';
    const sec = byLedger.get(key) ?? { ledger: key, accounts: [], total: 0 };
    sec.accounts.push({ name: a.name, amount });
    sec.total = +(sec.total + amount).toFixed(2);
    byLedger.set(key, sec);
  }
  return [...byLedger.values()].sort((a, b) => a.ledger.localeCompare(b.ledger));
}

function renderSection(title: string, sec: Section): string[] {
  const lines = [`${title}`];
  for (const acc of sec.accounts) lines.push(row(acc.name, acc.amount, 2));
  lines.push(row(`Total ${title}`, sec.total, 0));
  return lines;
}

// ── Trial Balance ────────────────────────────────────────────────────────────

export function buildTrialBalanceText(
  accounts: BalanceAccount[],
  opts: { businessName: string; periodLabel: string },
): string {
  const lines: string[] = [
    `TRIAL BALANCE — ${opts.businessName}`,
    opts.periodLabel,
    rule('='),
    `${'Account'.padEnd(40)}${'Debit'.padStart(12)}${'Credit'.padStart(12)}`,
    rule(),
  ];
  let dr = 0, cr = 0;
  // accounts arrive already sorted by ledger then name (computeBalances).
  for (const a of accounts) {
    const bal = a.balance; // debit_total − credit_total
    if (Math.abs(bal) < 0.005) continue;
    const debit = bal > 0 ? bal : 0;
    const credit = bal < 0 ? -bal : 0;
    dr += debit; cr += credit;
    const name = (a.ledger ? `${a.ledger}: ${a.name}` : a.name).slice(0, 40).padEnd(40);
    lines.push(`${name}${(debit ? money(debit) : '').padStart(12)}${(credit ? money(credit) : '').padStart(12)}`);
  }
  lines.push(rule());
  lines.push(`${'TOTAL'.padEnd(40)}${money(dr).padStart(12)}${money(cr).padStart(12)}`);
  return lines.join('\n');
}

// ── Profit & Loss ────────────────────────────────────────────────────────────

export function buildProfitLossText(
  accounts: BalanceAccount[],
  opts: { businessName: string; periodLabel: string },
): string {
  const pl = accounts.filter(a => a.account_type === 'income' || a.account_type === 'expense');
  const buckets: Record<PlBucket, BalanceAccount[]> = { income: [], cost_of_sales: [], expense: [], taxation: [] };
  for (const a of pl) buckets[plBucket(a.ledger, a.account_type)].push(a);

  // Income shows credit−debit; costs/expenses/tax show debit−credit (positive).
  const incomeAmt = (a: BalanceAccount) => +(a.credit_total - a.debit_total).toFixed(2);
  const costAmt   = (a: BalanceAccount) => +(a.debit_total - a.credit_total).toFixed(2);

  const incomeSecs = groupByLedger(buckets.income, incomeAmt);
  const cosSecs    = groupByLedger(buckets.cost_of_sales, costAmt);
  const expSecs    = groupByLedger(buckets.expense, costAmt);
  const taxSecs    = groupByLedger(buckets.taxation, costAmt);

  const sum = (secs: Section[]) => +secs.reduce((s, x) => s + x.total, 0).toFixed(2);
  const incomeTotal = sum(incomeSecs);
  const cosTotal    = sum(cosSecs);
  const expTotal    = sum(expSecs);
  const taxTotal    = sum(taxSecs);
  const grossProfit = +(incomeTotal - cosTotal).toFixed(2);
  const operatingProfit = +(grossProfit - expTotal).toFixed(2);
  const netProfit = +(operatingProfit - taxTotal).toFixed(2);

  const lines: string[] = [
    `PROFIT & LOSS ACCOUNT — ${opts.businessName}`,
    opts.periodLabel,
    rule('='),
  ];
  for (const s of incomeSecs) lines.push(...renderSection(s.ledger, s));
  if (incomeSecs.length) lines.push(row('TURNOVER', incomeTotal), '');
  if (cosSecs.length) {
    for (const s of cosSecs) lines.push(...renderSection(s.ledger, s));
    lines.push(row('Gross profit', grossProfit), '');
  }
  for (const s of expSecs) lines.push(...renderSection(s.ledger, s));
  if (expSecs.length) lines.push(row('Operating profit', operatingProfit), '');
  for (const s of taxSecs) lines.push(...renderSection(s.ledger, s));
  lines.push(rule());
  lines.push(row('NET PROFIT/(LOSS)', netProfit));
  return lines.join('\n');
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

export function buildBalanceSheetText(
  accounts: BalanceAccount[],
  netProfit: number,
  opts: { businessName: string; asAtLabel: string },
): string {
  const assetAmt = (a: BalanceAccount) => +(a.debit_total - a.credit_total).toFixed(2);   // assets natural debit
  const liabEqAmt = (a: BalanceAccount) => +(a.credit_total - a.debit_total).toFixed(2);   // liab/equity natural credit

  const assetSecs = groupByLedger(accounts.filter(a => a.account_type === 'asset'), assetAmt);
  const liabSecs  = groupByLedger(accounts.filter(a => a.account_type === 'liability'), liabEqAmt);
  const equitySecs = groupByLedger(accounts.filter(a => a.account_type === 'equity'), liabEqAmt);

  const sum = (secs: Section[]) => +secs.reduce((s, x) => s + x.total, 0).toFixed(2);
  const totalAssets = sum(assetSecs);
  const totalLiabs = sum(liabSecs);
  const netAssets = +(totalAssets - totalLiabs).toFixed(2);
  const equityBooked = sum(equitySecs);
  // Income/expense not yet closed to reserves show as current-period profit.
  const totalEquity = +(equityBooked + netProfit).toFixed(2);

  const lines: string[] = [
    `BALANCE SHEET — ${opts.businessName}`,
    `As at ${opts.asAtLabel}`,
    rule('='),
  ];
  for (const s of assetSecs) lines.push(...renderSection(s.ledger, s));
  lines.push(row('TOTAL ASSETS', totalAssets), '');
  for (const s of liabSecs) lines.push(...renderSection(s.ledger, s));
  if (liabSecs.length) lines.push(row('TOTAL LIABILITIES', totalLiabs), '');
  lines.push(rule());
  lines.push(row('NET ASSETS', netAssets), '');
  for (const s of equitySecs) lines.push(...renderSection(s.ledger, s));
  if (Math.abs(netProfit) >= 0.005) lines.push(row('Profit/(loss) for the period', netProfit, 2));
  lines.push(rule());
  lines.push(row("TOTAL EQUITY / CAPITAL & RESERVES", totalEquity));
  return lines.join('\n');
}

// ── Bundle ───────────────────────────────────────────────────────────────────

export interface StatementSet {
  tbText: string;
  pnlText: string;
  bsText: string;
}

/** Combine the three statements into a single document for one period. */
export function combineStatements(set: StatementSet, heading: string): string {
  return [
    `===== ${heading} =====`,
    '',
    set.pnlText,
    '',
    '',
    set.bsText,
    '',
    '',
    set.tbText,
  ].join('\n');
}
