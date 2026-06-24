// Bookkeeping — Chart of Accounts default seeds.
//
// One seed per book template type. When a new book is created, the matching
// seed (if any) is expanded into `bookkeeping_accounts` rows so the user
// starts with a working COA rather than an empty one.
//
// Sourced from VT Transaction+ default templates — Ltd captured Phase 2A
// kickoff, Sole Trader captured 24/06/26. Other template seeds (LLP, etc.)
// land as their VT equivalents are exported.
//
// Each ledger carries a stable `ledger_key`, and special accounts carry a
// `system_role` (see lib/bookkeeping/accountCodes.ts). The server resolves
// FA/VAT/year-end accounts by role, NOT by display name — so users can rename
// accounts freely without breaking the wiring. User-facing `code` numbers are
// assigned at seed time by `seedAccountCode` (ranged by type).

import type { BookTemplateType } from '@/types/bookkeeping';
import {
  type SystemRole,
  type CodeAccountType,
  rangeBaseFor,
  CODE_STEP,
  formatCode,
} from '@/lib/bookkeeping/accountCodes';

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
  /**
   * Immutable machine identity for special accounts the system posts to
   * automatically (FA movement, VAT control, retained earnings, disposal P&L).
   * Resolved by role, never by name — renaming the account can't break it.
   */
  system_role?: SystemRole;
}

export interface CoaLedgerSeed {
  /** Display label — e.g. "Income", "FA - intangible". */
  name: string;
  /** Stable key, independent of the display label. */
  ledger_key: string;
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
      ledger_key: 'income',
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
      ledger_key: 'cost_of_sales',
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
      ledger_key: 'expenses',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Accountancy fees' },
        { name: 'Advertising and PR' },
        { name: 'Amortisation', system_role: 'amortisation_expense' },
        { name: 'Amortisation of goodwill' },
        { name: 'Audit fees' },
        { name: 'Bad debts' },
        { name: 'Bank charges' },
        { name: 'Bonuses' },
        { name: 'Cleaning' },
        { name: 'Consultancy fees' },
        { name: 'Courier services' },
        { name: 'Depreciation', system_role: 'depreciation_expense' },
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
        { name: 'P/L on disposal of fixed assets', system_role: 'disposal_pl' },
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
      ledger_key: 'taxation',
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
      ledger_key: 'fa_intangible',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Amortisation - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Amortisation - charge', system_role: 'fa_depn_charge' },
        { name: 'Amortisation - disposals', system_role: 'fa_depn_disposals' },
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
      ],
    },
    {
      name: 'FA - land and buildings',
      ledger_key: 'fa_land_buildings',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Cost - revaluation' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
        { name: 'Depn - revaluation' },
      ],
    },
    {
      name: 'FA - plant and machinery',
      ledger_key: 'fa_plant_machinery',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'FA - equipment, fixtures & fittings',
      ledger_key: 'fa_equipment',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'FA - vehicles',
      ledger_key: 'fa_vehicles',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'Investments - fixed',
      ledger_key: 'investments_fixed',
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
      ledger_key: 'investments_current',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Listed' },
        { name: 'Unlisted' },
      ],
    },
    {
      name: 'Stocks',
      ledger_key: 'stocks',
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
      ledger_key: 'customers',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [],
    },
    {
      name: 'Debtors',
      ledger_key: 'debtors',
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
      ledger_key: 'bank',
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
      ledger_key: 'suppliers',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Credit card company' },
      ],
    },
    {
      name: 'Creditors',
      ledger_key: 'creditors',
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
        { name: 'Net VAT due',          vat_only: true, system_role: 'net_vat_due' },
        { name: 'Non-equity preference shares' },
        { name: 'Opening balances contra' },
        { name: 'PAYE and NI' },
        { name: 'Proposed dividends' },
        { name: 'Sundry' },
        { name: 'Trade creditors' },
        { name: 'VAT - Deferred input',  vat_only: true, system_role: 'vat_deferred_input' },
        { name: 'VAT - Deferred output', vat_only: true, system_role: 'vat_deferred_output' },
        { name: 'VAT - EC acquisitions', vat_only: true, system_role: 'vat_ec_acquisitions' },
        { name: 'VAT - Input',           vat_only: true, system_role: 'vat_input' },
        { name: 'VAT - Output',          vat_only: true, system_role: 'vat_output' },
      ],
    },
    {
      name: 'Deferred tax',
      ledger_key: 'deferred_tax',
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
      ledger_key: 'share_capital',
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
      ledger_key: 'share_premium',
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
      ledger_key: 'revaluation_reserve',
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
      ledger_key: 'pl_account',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Brought forward', system_role: 'retained_earnings' },
        { name: 'Equity dividends' },
      ],
    },
  ],
};

// ── Sole trader (UK unincorporated, single owner) ───────────────────────────
// 16 ledgers. Captured verbatim from a clean VT Transaction+ "Chart of accounts
// for a sole trader" trial balance export (24/06/26). Differences vs Ltd:
//  - No Taxation/Corporation tax, share capital/premium, dividends, deferred tax.
//  - Equity is a single "Capital account" ledger (Brought forward / Capital
//    introduced / Drawings). Net profit rolls into "Brought forward" at year-end
//    (resolved via the retained_earnings system_role).
//  - Two extra disallowable mirror ledgers ("Disallowable c. of sales" and
//    "Disallowable expenses") VT uses to segregate tax-disallowable spend. The
//    FA-engine roles (depreciation_expense, disposal_pl) are tagged ONLY on the
//    allowable Expenses ledger, never the disallowable mirror.
//  - FA ledgers are VT's sole-trader set: Plant and machinery, Motor vehicles,
//    a Spare category, and an "FA - Other" catch-all (Goodwill/Investments/
//    Premises — no depreciation movement accounts).
export const SOLE_TRADER_COA_SEED: CoaTemplateSeed = {
  template_type: 'sole_trader',
  ledgers: [
    {
      name: 'Income',
      ledger_key: 'income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Fees' },
        { name: 'Interest' },
        { name: 'Reimbursed expenses' },
        { name: 'Rents' },
        { name: 'Sales' },
      ],
    },
    {
      name: 'Cost of sales',
      ledger_key: 'cost_of_sales',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Commissions' },
        { name: 'Dec/(Inc) in stocks' },
        { name: 'Direct labour' },
        { name: 'Other' },
        { name: 'Purchases' },
        { name: 'Subcontractor costs' },
      ],
    },
    {
      name: 'Expenses',
      ledger_key: 'expenses',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Accountants fees' },
        { name: 'Advertising and PR' },
        { name: 'Amortisation of goodwill' },
        { name: 'Bad debts' },
        { name: 'Bank charges' },
        { name: 'Bonuses' },
        { name: 'Cleaning' },
        { name: 'Consultancy fees' },
        { name: 'Couriers' },
        { name: 'Depreciation', system_role: 'depreciation_expense' },
        { name: 'Electricity' },
        { name: "Employer's NI" },
        { name: 'Entertaining' },
        { name: 'Equipment expensed' },
        { name: "Exchange diff's & charges" },
        { name: 'Hire of equipment' },
        { name: 'Info & publications' },
        { name: 'Insurance - motor' },
        { name: 'Insurance - other' },
        { name: 'Insurance - professional indemnity' },
        { name: 'Insurance - property' },
        { name: 'Interest' },
        { name: 'Interest - HP and leases' },
        { name: 'Legal and professional' },
        { name: 'P/L on disposal of fixed assets', system_role: 'disposal_pl' },
        { name: 'Management fees' },
        { name: 'Motor expenses' },
        { name: 'Pensions' },
        { name: 'Postage' },
        { name: 'Rates' },
        { name: 'Recruitment fees' },
        { name: 'Rent' },
        { name: 'Repairs and maintenance' },
        { name: 'Service charges' },
        { name: 'Software' },
        { name: 'Solicitors fees' },
        { name: 'Staff training & welfare' },
        { name: 'Stationery and printing' },
        { name: 'Subscriptions' },
        { name: 'Sundry expenses' },
        { name: 'Telephone and internet' },
        { name: 'Temporary staff' },
        { name: 'Travel and subsistence' },
        { name: 'Use of home' },
        { name: 'Wages and salaries' },
        { name: 'Water rates/charges' },
        { name: 'Write backs/discounts' },
        { name: 'Write offs/discounts' },
      ],
    },
    {
      name: 'Disallowable c. of sales',
      ledger_key: 'disallowable_cost_of_sales',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Commissions' },
        { name: 'Dec/(Inc) in stocks' },
        { name: 'Direct labour' },
        { name: 'Other' },
        { name: 'Purchases' },
        { name: 'Subcontractor costs' },
      ],
    },
    {
      name: 'Disallowable expenses',
      ledger_key: 'disallowable_expenses',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Accountants fees' },
        { name: 'Advertising and PR' },
        { name: 'Amortisation of goodwill' },
        { name: 'Bad debts' },
        { name: 'Bank charges' },
        { name: 'Bonuses' },
        { name: 'Cleaning' },
        { name: 'Consultancy fees' },
        { name: 'Couriers' },
        { name: 'Depreciation' },
        { name: 'Electricity' },
        { name: "Employer's NI" },
        { name: 'Entertaining' },
        { name: 'Equipment expensed' },
        { name: 'Hire of equipment' },
        { name: 'Info & publications' },
        { name: 'Insurance - motor' },
        { name: 'Insurance - other' },
        { name: 'Insurance - professional indemnity' },
        { name: 'Insurance - property' },
        { name: 'Interest' },
        { name: 'Interest - HP and leases' },
        { name: 'Legal and professional' },
        { name: 'P/L on disposal of fixed assets' },
        { name: 'Management fees' },
        { name: 'Motor expenses' },
        { name: 'Pensions' },
        { name: 'Postage' },
        { name: 'Rates' },
        { name: 'Recruitment fees' },
        { name: 'Rent' },
        { name: 'Repairs and maintenance' },
        { name: 'Service charges' },
        { name: 'Software' },
        { name: 'Solicitors fees' },
        { name: 'Staff training & welfare' },
        { name: 'Stationery and printing' },
        { name: 'Subscriptions' },
        { name: 'Sundry expenses' },
        { name: 'Telephone and fax' },
        { name: 'Temporary staff' },
        { name: 'Travel and subsistence' },
        { name: 'Use of home' },
        { name: 'Wages and salaries' },
        { name: 'Water rates/charges' },
      ],
    },
    {
      name: 'FA - Plant and machinery',
      ledger_key: 'fa_plant_machinery',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'FA - Motor vehicles',
      ledger_key: 'fa_motor_vehicles',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'FA - Spare category',
      ledger_key: 'fa_spare',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'FA - Other',
      ledger_key: 'fa_other',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Goodwill' },
        { name: 'Investments' },
        { name: 'Premises' },
      ],
    },
    {
      name: 'Stocks',
      ledger_key: 'stocks',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Finished goods' },
        { name: 'Raw materials' },
        { name: 'Work-in-progress' },
      ],
    },
    {
      // Client-specific — created as the user adds customers. Ships empty.
      name: 'Customers',
      ledger_key: 'customers',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [],
    },
    {
      name: 'Debtors',
      ledger_key: 'debtors',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Prepayments' },
        { name: 'Staff loans' },
        { name: 'Sundry' },
        { name: 'Trade debtors' },
        { name: 'Translation differences' },
      ],
    },
    {
      name: 'Bank',
      ledger_key: 'bank',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Current a/c' },
        { name: 'Deposit a/c' },
        { name: 'Loan' },
        { name: 'Petty cash' },
      ],
    },
    {
      name: 'Suppliers',
      ledger_key: 'suppliers',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Credit card company' },
      ],
    },
    {
      name: 'Creditors',
      ledger_key: 'creditors',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Accruals' },
        { name: 'Finance leases/HP' },
        { name: 'Inland Revenue' },
        { name: 'Loans due after 1 year' },
        { name: 'Net VAT due',          vat_only: true, system_role: 'net_vat_due' },
        { name: 'Opening balances contra' },
        { name: 'PAYE and NI' },
        { name: 'Sundry' },
        { name: 'Trade creditors' },
        { name: 'VAT - Deferred input',  vat_only: true, system_role: 'vat_deferred_input' },
        { name: 'VAT - Deferred output', vat_only: true, system_role: 'vat_deferred_output' },
        { name: 'VAT - EC acquisitions', vat_only: true, system_role: 'vat_ec_acquisitions' },
        { name: 'VAT - Input',           vat_only: true, system_role: 'vat_input' },
        { name: 'VAT - Output',          vat_only: true, system_role: 'vat_output' },
      ],
    },
    {
      name: 'Capital account',
      ledger_key: 'capital_account',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Brought forward', system_role: 'retained_earnings' },
        { name: 'Capital introduced' },
        { name: 'Drawings' },
      ],
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────
// New template seeds slot in here — no schema changes required.
export const COA_SEEDS: Partial<Record<BookTemplateType, CoaTemplateSeed>> = {
  ltd: LTD_COA_SEED,
  sole_trader: SOLE_TRADER_COA_SEED,
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

// ── Account-code assignment ───────────────────────────────────────────────────
// Walk a seed in ledger/account order and assign a ranged-by-type code to every
// account. Computed over the FULL seed (including vat_only accounts) so a code
// is stable for a given account whether or not the book is VAT-registered.
// Returns a map keyed by `${ledger}::${name}`.
export function assignSeedCodes(seed: CoaTemplateSeed): Map<string, string> {
  const codes = new Map<string, string>();
  const nextByBand = new Map<number, number>(); // band base → next code to hand out
  for (const ledger of seed.ledgers) {
    for (const account of ledger.accounts) {
      const base = rangeBaseFor(
        ledger.account_type as CodeAccountType,
        ledger.ledger_key,
        ledger.name,
      );
      const ceiling = base + 999;
      let code = nextByBand.get(base) ?? base;
      if (code > ceiling) code = ceiling;
      codes.set(`${ledger.name}::${account.name}`, formatCode(code));
      // Advance: step by 10, fall back to unit steps once dense.
      let next = code + CODE_STEP;
      if (next > ceiling) next = code + 1;
      nextByBand.set(base, next);
    }
  }
  return codes;
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
