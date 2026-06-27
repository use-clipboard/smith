// Map a sole-trader bookkeeping P&L into MTD IT self-employment entries.
//
// Given the per-account balances for a sole_trader / self_employed book over a
// quarter's date range, produce one import line per P&L account with a suggested
// MTD sole category. Categories are a default heuristic — the user can override
// each in the import preview before entries are created.

import type { BalanceAccount } from '@/lib/bookkeeping/balances';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ImportLine {
  account_id: string;
  description: string;
  ledger: string | null;
  entry_type: 'income' | 'expense';
  amount: number;
  category: string;
}

/** Suggest an MTD sole-trader INCOME category from an account name. */
export function suggestSoleIncomeCategory(name: string): string {
  const s = name.toLowerCase();
  if (/interest|rent|reimburs|investment|\bother\b/.test(s)) return 'Other Income';
  return 'Turnover';
}

/** Suggest an MTD sole-trader EXPENSE category from an account name + ledger. */
export function suggestSoleExpenseCategory(name: string, ledger: string | null): string {
  const s = `${name} ${ledger ?? ''}`.toLowerCase();
  const has = (...keys: string[]) => keys.some(k => s.includes(k));
  if (has('subcontractor', 'cis')) return 'CIS Payments';
  if (has('purchase', 'cost of sales', 'direct labour', 'carriage', 'commission', 'stock', 'goods')) return 'Cost of Goods Bought';
  if (has('wage', 'salar', 'employer', "employer's ni", 'pension', 'staff', 'bonus', 'recruit', 'temp', 'training', 'welfare')) return 'Staff Cost';
  if (has('travel', 'motor', 'subsistence')) return 'Travelling Cost';
  if (has('rent', 'rates', 'insurance', 'light', 'heat', 'electric', 'gas', 'water', 'premises', 'service charge', 'use of home', 'cleaning')) return 'Premises Cost';
  if (has('repair', 'maintenance')) return 'Maintenance Cost';
  if (has('advertis', 'marketing', ' pr', 'promotion')) return 'Advertising Cost';
  if (has('entertain')) return 'Entertainment Cost';
  if (has('interest')) return 'Interest Cost';
  if (has('finance', 'lease', ' hp', 'hire')) return 'Finance Charges';
  if (has('bad debt')) return 'Bad Debts';
  if (has('account', 'legal', 'professional', 'solicitor', 'consult', 'audit')) return 'Professional Fee';
  if (has('deprecia', 'amortis')) return 'Depreciation';
  if (has('telephone', 'internet', 'software', 'postage', 'stationery', 'print', 'subscription', 'sundry', 'bank charge', 'office', 'admin', 'courier', 'information', 'publication', 'equipment expensed', 'laundry')) return 'Admin Cost';
  return 'Other Expense';
}

/**
 * Build import lines from a book's P&L balances. Excludes the "Disallowable"
 * mirror ledgers (non-deductible — not reported in the MTD figures) and
 * zero-movement accounts. Amount is the period movement, signed positive on the
 * natural side (income = credit−debit, expense = debit−credit).
 */
export function buildImportLines(accounts: BalanceAccount[]): ImportLine[] {
  const lines: ImportLine[] = [];
  for (const a of accounts) {
    if (a.account_type !== 'income' && a.account_type !== 'expense') continue;
    if ((a.ledger ?? '').toLowerCase().startsWith('disallowable')) continue;
    const amount = a.account_type === 'income'
      ? round2(a.credit_total - a.debit_total)
      : round2(a.debit_total - a.credit_total);
    if (Math.abs(amount) < 0.005) continue;
    lines.push({
      account_id: a.id,
      description: a.name,
      ledger: a.ledger,
      entry_type: a.account_type,
      amount,
      category: a.account_type === 'income'
        ? suggestSoleIncomeCategory(a.name)
        : suggestSoleExpenseCategory(a.name, a.ledger),
    });
  }
  return lines;
}
