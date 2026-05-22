// Bookkeeping — Chart of Accounts default seeds.
//
// One seed per book template type. When a new book is created, the matching
// seed (if any) is expanded into `bookkeeping_accounts` rows so the user
// starts with a working COA rather than an empty one.
//
// Sourced from VT Transaction+ default Ltd template — captured Phase 2A
// kickoff. Other template seeds (Sole Trader, LLP, etc.) land as their VT
// equivalents are exported.

import type { BookTemplateType } from '@/types/bookkeeping';

export type LedgerType = 'profit_and_loss' | 'balance_sheet';
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface CoaAccountSeed {
  name: string;
  /**
   * When true, this account is only seeded for VAT-registered books. The seed
   * function quietly skips these when book.vat_registered = false.
   *
   * When a book is later flipped to VAT-registered, the seeder back-fills the
   * missing accounts.
   */
  vat_only?: boolean;
}

export interface CoaLedgerSeed {
  /** Display label — e.g. "Income", "FA - intangible". */
  name: string;
  /** Drives report grouping (P&L vs Balance Sheet). */
  ledger_type: LedgerType;
  /** Drives the accounting category (asset/liability/etc.) for every account in this ledger. */
  account_type: AccountType;
  accounts: CoaAccountSeed[];
}

export interface CoaTemplateSeed {
  template_type: BookTemplateType;
  ledgers: CoaLedgerSeed[];
}

// ── Ltd (UK private limited company) ────────────────────────────────────────
// 22 ledgers, ~168 accounts (162 when not VAT registered).
export const LTD_COA_SEED: CoaTemplateSeed = {
  template_type: 'ltd',
  ledgers: [
    {
      name: 'Income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Fees' },
        { name: 'Interest receivable' },
        { name: 'Investment income' },
        { name: 'Other operating income' },
        { name: 'Sales' },
      ],
    },
    {
      name: 'Cost of sales',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Carriage' },
        { name: 'Commissions payable' },
        { name: 'Decrease/(increase) in stocks' },
        { name: 'Direct labour' },
        { name: 'Discounts allowed' },
        { name: 'Other' },
        { name: 'Purchases' },
        { name: 'Subcontractor costs' },
      ],
    },
    {
      name: 'Expenses',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Accountancy fees' },
        { name: 'Advertising and PR' },
        { name: 'Amortisation of goodwill' },
        { name: 'Audit fees' },
        { name: 'Bad debts' },
        { name: 'Bank charges' },
        { name: 'Bonuses' },
        { name: 'Cleaning' },
        { name: 'Consultancy fees' },
        { name: 'Courier services' },
        { name: 'Depreciation' },
        { name: 'Directors salaries' },
        { name: 'Donation' },
        { name: 'Employers NI' },
        { name: 'Entertaining' },
        { name: 'Equipment expensed' },
        { name: 'Equipment hire' },
        { name: 'Exchange differences & charges' },
        { name: 'Gain/loss on revaluation of current asset investments - listed' },
        { name: 'Gain/loss on revaluation of current asset investments - unlisted' },
        { name: 'Gain/loss on revaluation of fixed asset investments' },
        { name: 'Information and publications' },
        { name: 'Insurance' },
        { name: 'Interest - bank' },
        { name: 'Interest - leases & HP' },
        { name: 'Interest - other' },
        { name: 'Light and heat' },
        { name: 'Management fees' },
        { name: 'Motor expenses' },
        { name: 'Non-equity dividends' },
        { name: 'Other legal and prof' },
        { name: 'P/L on disposal of investments' },
        { name: 'P/L on disposal of land and buildings' },
        { name: 'P/L on disposal of plant and machinery' },
        { name: 'Pensions' },
        { name: 'Postage' },
        { name: 'Rates' },
        { name: 'Rent' },
        { name: 'Repairs and maintenance' },
        { name: 'Service charges' },
        { name: 'Software' },
        { name: 'Solicitors fees' },
        { name: 'Staff training & welfare' },
        { name: 'Stationery and printing' },
        { name: 'Subscriptions' },
        { name: 'Sundry' },
        { name: 'Telephone and internet' },
        { name: 'Temps and recruitment' },
        { name: 'Travel and subsistence' },
        { name: 'Use of home' },
        { name: 'Wages and salaries' },
        { name: 'Write backs/discounts' },
        { name: 'Write offs/discounts' },
      ],
    },
    {
      name: 'Taxation',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Corporation tax' },
        { name: 'Corporation tax - deferred tax' },
        { name: 'Corporation tax - prior year adjustment' },
      ],
    },
    {
      name: 'FA - intangible',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Amortisation - b/fwd' },
        { name: 'Amortisation - charge' },
        { name: 'Amortisation - disposals' },
        { name: 'Cost - b/fwd' },
        { name: 'Cost - additions' },
        { name: 'Cost - disposals' },
      ],
    },
    {
      name: 'FA - land and buildings',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd' },
        { name: 'Cost - additions' },
        { name: 'Cost - disposals' },
        { name: 'Cost - revaluation' },
        { name: 'Depn - b/fwd' },
        { name: 'Depn - charge' },
        { name: 'Depn - disposals' },
        { name: 'Depn - revaluation' },
      ],
    },
    {
      name: 'FA - plant and machinery',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd' },
        { name: 'Cost - additions' },
        { name: 'Cost - disposals' },
        { name: 'Depn - b/fwd' },
        { name: 'Depn - charge' },
        { name: 'Depn - disposals' },
      ],
    },
    {
      name: 'FA - equipment, fixtures & fittings',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd' },
        { name: 'Cost - additions' },
        { name: 'Cost - disposals' },
        { name: 'Depn - b/fwd' },
        { name: 'Depn - charge' },
        { name: 'Depn - disposals' },
      ],
    },
    {
      name: 'FA - vehicles',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd' },
        { name: 'Cost - additions' },
        { name: 'Cost - disposals' },
        { name: 'Depn - b/fwd' },
        { name: 'Depn - charge' },
        { name: 'Depn - disposals' },
      ],
    },
    {
      name: 'Investments - fixed',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Listed - b/fwd' },
        { name: 'Listed - additions' },
        { name: 'Listed - disposals' },
        { name: 'Listed - revaluation' },
        { name: 'Subsidiaries - b/fwd' },
        { name: 'Subsidiaries - additions' },
        { name: 'Subsidiaries - disposals' },
        { name: 'Subsidiaries - revaluation' },
        { name: 'Unlisted - b/fwd' },
        { name: 'Unlisted - additions' },
        { name: 'Unlisted - disposals' },
        { name: 'Unlisted - revaluation' },
      ],
    },
    {
      name: 'Investments - current',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Listed' },
        { name: 'Unlisted' },
      ],
    },
    {
      name: 'Stocks',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Finished goods' },
        { name: 'Long term contract balances' },
        { name: 'Payments received on account' },
        { name: 'Raw materials' },
        { name: 'Work in progress' },
      ],
    },
    {
      // Customer accounts are client-specific — created as the user adds them.
      // Ships empty.
      name: 'Customers',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [],
    },
    {
      name: 'Debtors',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Accrued income' },
        { name: 'Bad debt provision' },
        { name: 'Long term contracts' },
        { name: 'Prepayments' },
        { name: 'Staff loans' },
        { name: 'Sundry' },
        { name: 'Trade debtors' },
        { name: 'Translation differences' },
      ],
    },
    {
      name: 'Bank',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Current account' },
        { name: 'Deposit account' },
        { name: 'Petty cash' },
      ],
    },
    {
      name: 'Suppliers',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Credit card company' },
      ],
    },
    {
      name: 'Creditors',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Accruals' },
        { name: 'Accruals - preference dividend' },
        { name: 'ACT payable' },
        { name: 'Bank loans < 1 year' },
        { name: 'Bank loans > 1 year' },
        { name: 'Corporation tax' },
        { name: 'Deferred income' },
        { name: "Director's account" },
        { name: 'Leases & HP < 1 year' },
        { name: 'Leases & HP > 1 year' },
        { name: 'Long term contracts' },
        { name: 'Net VAT due',          vat_only: true },
        { name: 'Non-equity preference shares' },
        { name: 'Opening balances contra' },
        { name: 'PAYE and NI' },
        { name: 'Proposed dividends' },
        { name: 'Sundry' },
        { name: 'Trade creditors' },
        { name: 'VAT - Deferred input',  vat_only: true },
        { name: 'VAT - Deferred output', vat_only: true },
        { name: 'VAT - EC acquisitions', vat_only: true },
        { name: 'VAT - Input',           vat_only: true },
        { name: 'VAT - Output',          vat_only: true },
      ],
    },
    {
      name: 'Deferred tax',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Brought forward' },
        { name: 'Charged to other comprehensive income' },
        { name: 'Charged to profit and loss account' },
      ],
    },
    {
      name: 'Share capital',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Brought forward' },
        { name: 'Shares issued' },
        { name: 'Shares redeemed' },
      ],
    },
    {
      name: 'Share premium',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Brought forward' },
        { name: 'Expenses of issue' },
        { name: 'On shares issued' },
      ],
    },
    {
      name: 'Revaluation reserve',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Brought forward' },
        { name: 'Deferred taxation arising on the revaluation of land and buildings' },
        { name: 'Gain on revaluation of land and buildings' },
      ],
    },
    {
      name: 'Profit and loss account',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Brought forward' },
        { name: 'Equity dividends' },
      ],
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────
// New template seeds slot in here — no schema changes required.
export const COA_SEEDS: Partial<Record<BookTemplateType, CoaTemplateSeed>> = {
  ltd: LTD_COA_SEED,
  // sole_trader:   ...  TODO (next VT export)
  // self_employed: ...
  // partnership:   ...
  // llp:           ...
  // trust:         ...
  // charity:       ...
  // basic:         ...  Hand-built fallback — write from scratch.
};

export function getCoaSeed(templateType: BookTemplateType): CoaTemplateSeed | null {
  return COA_SEEDS[templateType] ?? null;
}

// ── Preview helper (UI) ─────────────────────────────────────────────────────
// Used by the "New book" modal to show the user what they're about to get.
// VAT-only accounts are filtered out when `vatRegistered = false`.

export interface CoaPreviewLedger {
  name: string;
  ledger_type: LedgerType;
  accounts: string[];
}

export interface CoaPreview {
  has_seed: boolean;
  total_ledgers: number;
  total_accounts: number;
  ledgers: CoaPreviewLedger[];
}

export function previewCoa(
  templateType: BookTemplateType,
  vatRegistered: boolean,
): CoaPreview {
  const seed = getCoaSeed(templateType);
  if (!seed) {
    return { has_seed: false, total_ledgers: 0, total_accounts: 0, ledgers: [] };
  }
  const ledgers: CoaPreviewLedger[] = seed.ledgers.map(l => ({
    name: l.name,
    ledger_type: l.ledger_type,
    accounts: l.accounts.filter(a => vatRegistered || !a.vat_only).map(a => a.name),
  }));
  return {
    has_seed: true,
    total_ledgers: ledgers.length,
    total_accounts: ledgers.reduce((sum, l) => sum + l.accounts.length, 0),
    ledgers,
  };
}
