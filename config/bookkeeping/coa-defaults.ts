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

// ── Partnership (UK unincorporated, 2+ partners) ────────────────────────────
// 16 ledgers. Captured verbatim from a clean VT Transaction+ "Chart of accounts
// for a partnership" trial balance export (26/06/26). Mirrors Sole Trader's P&L
// structure (allowable + disallowable ledgers, no corporation tax) but the
// equity ledger is "Capital accounts": per-partner P1–P9 (b/fwd / capital
// introduced / drawings) plus "Profit to be allocated" — the year-end close
// target (tagged retained_earnings), where net profit lands before being
// allocated to partners.
//
// VT's exact account names are kept (e.g. "Loss/profit on sale of FA"); the
// FA/VAT/disposal/retained-earnings accounts are wired by system_role, so they
// resolve regardless of the display name (see lib/bookkeeping/accountCodes.ts).
export const PARTNERSHIP_COA_SEED: CoaTemplateSeed = {
  template_type: 'partnership',
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
        { name: 'Gas' },
        { name: 'Info & publications' },
        { name: 'Insurance' },
        { name: 'Interest' },
        { name: 'Interest - HP and leases' },
        { name: 'Laundry' },
        { name: 'Legal and professional' },
        { name: 'Loss/profit on sale of FA', system_role: 'disposal_pl' },
        { name: 'Management fees' },
        { name: 'Motor expenses' },
        { name: 'Pensions' },
        { name: 'Postage and carriage' },
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
        { name: 'Gas' },
        { name: 'Info & publications' },
        { name: 'Insurance' },
        { name: 'Interest' },
        { name: 'Interest - HP and leases' },
        { name: 'Laundry' },
        { name: 'Legal and professional' },
        { name: 'Loss/profit on sale of FA' },
        { name: 'Management fees' },
        { name: 'Motor expenses' },
        { name: 'Pensions' },
        { name: 'Postage and carriage' },
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
      // Per-partner capital/current accounts P1–P9, plus the year-end profit
      // holding account. "Profit to be allocated" is the retained_earnings
      // target — net P&L closes into it before being split between partners.
      name: 'Capital accounts',
      ledger_key: 'capital_accounts',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'P1 - b/fwd' },
        { name: 'P1 - capital introduced' },
        { name: 'P1 - drawings' },
        { name: 'P2 - b/fwd' },
        { name: 'P2 - capital introduced' },
        { name: 'P2 - drawings' },
        { name: 'P3 - b/fwd' },
        { name: 'P3 - capital introduced' },
        { name: 'P3 - drawings' },
        { name: 'P4 - b/fwd' },
        { name: 'P4 - capital introduced' },
        { name: 'P4 - drawings' },
        { name: 'P5 - b/fwd' },
        { name: 'P5 - capital introduced' },
        { name: 'P5 - drawings' },
        { name: 'P6 - b/fwd' },
        { name: 'P6 - capital introduced' },
        { name: 'P6 - drawings' },
        { name: 'P7 - b/fwd' },
        { name: 'P7 - capital introduced' },
        { name: 'P7 - drawings' },
        { name: 'P8 - b/fwd' },
        { name: 'P8 - capital introduced' },
        { name: 'P8 - drawings' },
        { name: 'P9 - b/fwd' },
        { name: 'P9 - capital introduced' },
        { name: 'P9 - drawings' },
        { name: 'Profit to be allocated', system_role: 'retained_earnings' },
      ],
    },
  ],
};

// ── LLP (UK Limited Liability Partnership) ──────────────────────────────────
// 27 ledgers. Captured verbatim from a clean VT Transaction+ "Chart of accounts
// for a limited liability partnership" trial balance export (27/06/26). Much
// richer than Partnership — full FRS 102 LLP SORP equity structure (members'
// capital classified as debt, loans from members, retirement-benefit
// liabilities, profits due to members, members' equity capital, reserves) plus
// investments and revaluation. No corporation tax; members taxed personally.
//
// Members' remuneration is a P&L expense ledger. FA movement accounts use VT's
// LLP wording ("Amortisation - provided in year", "Depn - charge for the year")
// — resolved by system_role, not name. Year-end net profit closes into
// "Other reserves (inc profit) → B/fwd" (tagged retained_earnings).
//
// JUDGEMENT CALLS flagged to Christos (LLP SORP varies by members' agreement):
//   • retained_earnings target = "Other reserves (inc profit): B/fwd".
//   • "Profits due to members" classified as equity (members' current account).
export const LLP_COA_SEED: CoaTemplateSeed = {
  template_type: 'llp',
  ledgers: [
    {
      name: 'Income',
      ledger_key: 'income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Fees' },
        { name: 'Income from investments' },
        { name: 'Interest' },
        { name: 'P/L on reval - current asset listed investments' },
        { name: 'P/L on reval - current asset unlisted investments' },
        { name: 'P/L on reval - fixed asset investments' },
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
        { name: 'Amortisation of goodwill', system_role: 'amortisation_expense' },
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
        { name: 'Equipment hire' },
        { name: 'Exceptional P/L on disposal of investments' },
        { name: 'Exceptional P/L on disposal of land and buildings' },
        { name: 'Exceptional P/L on disposal of plant & machinery' },
        { name: "Exchange diff's & charges" },
        { name: 'Gas' },
        { name: 'Info & publications' },
        { name: 'Insurance' },
        { name: 'Interest' },
        { name: 'Interest - HP and leases' },
        { name: 'Laundry' },
        { name: 'Legal and professional' },
        { name: 'Loss/profit on sale of FA', system_role: 'disposal_pl' },
        { name: 'Management fees' },
        { name: 'Motor expenses' },
        { name: 'Pensions' },
        { name: 'Postage and carriage' },
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
      name: 'Members remuneration',
      ledger_key: 'members_remuneration',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Automatic division of profits' },
        { name: "Interest payable on members' capital" },
        { name: 'Retirement benefit costs' },
        { name: 'Salaries paid under LLP agreement' },
      ],
    },
    {
      name: 'FA - Intangible',
      ledger_key: 'fa_intangible',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Amortisation - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Amortisation - disposals', system_role: 'fa_depn_disposals' },
        { name: 'Amortisation - provided in year', system_role: 'fa_depn_charge' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
      ],
    },
    {
      name: 'FA - Land & buildings',
      ledger_key: 'fa_land_buildings',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Cost - revaluation' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge for the year', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
        { name: 'Depn - revaluation' },
      ],
    },
    {
      name: 'FA - Plant & machinery',
      ledger_key: 'fa_plant_machinery',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge for the year', system_role: 'fa_depn_charge' },
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
        { name: 'Depn - charge for the year', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      name: 'Investments in subsidiaries',
      ledger_key: 'investments_subsidiaries',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Additions' },
        { name: 'Disposals' },
        { name: 'Revaluation' },
      ],
    },
    {
      name: 'Other investments listed',
      ledger_key: 'investments_listed',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Additions' },
        { name: 'Disposals' },
        { name: 'Revaluation' },
      ],
    },
    {
      name: 'Other investments unlisted',
      ledger_key: 'investments_unlisted',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Additions' },
        { name: 'Disposals' },
        { name: 'Revaluation' },
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
        { name: 'Accrued income' },
        { name: 'Bad debt provision' },
        { name: 'Prepayments' },
        { name: 'Staff loans' },
        { name: 'Sundry' },
        { name: 'Trade debtors' },
        { name: 'Translation differences' },
      ],
    },
    {
      name: 'Current asset investments',
      ledger_key: 'current_asset_investments',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Listed' },
        { name: 'Unlisted' },
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
        { name: 'Bank loans' },
        { name: 'Deferred income' },
        { name: 'Leases & HP' },
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
      name: 'Creditors > 1 year',
      ledger_key: 'creditors_over_1yr',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Bank loans' },
        { name: 'Leases & HP' },
        { name: 'Other creditors' },
        { name: 'Trade creditors' },
      ],
    },
    {
      name: 'Provisions for liabilities',
      ledger_key: 'provisions',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Provisions made during the period' },
        { name: 'Utilised' },
      ],
    },
    {
      name: 'Members capital classified as debt',
      ledger_key: 'members_capital_debt',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Introduced' },
        { name: 'Other movements' },
        { name: 'Repaid' },
      ],
    },
    {
      name: 'Loans from members',
      ledger_key: 'loans_from_members',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Introduced' },
        { name: 'Other movements' },
        { name: 'Repaid' },
      ],
    },
    {
      name: 'Members retirement benefit liabilities',
      ledger_key: 'members_retirement_liabilities',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Charged to members remuneration' },
        { name: 'Drawings' },
        { name: 'Other movements' },
        { name: 'Transferred to creditors' },
      ],
    },
    {
      // Members' current accounts for undrawn profits — PER-MEMBER (M1–M9),
      // unlike VT's aggregate default, so each member's profit share, drawings
      // and balance are tracked separately and Phase 2 allocation credits each
      // member's own account. Treated as equity (LLP SORP varies — confirm
      // against the members' agreement).
      name: 'Profits due to members',
      ledger_key: 'profits_due_to_members',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'M1 - B/fwd' },
        { name: 'M1 - Allocation of profits' },
        { name: 'M1 - Drawings' },
        { name: 'M1 - Members remuneration' },
        { name: 'M1 - Other movements' },
        { name: 'M2 - B/fwd' },
        { name: 'M2 - Allocation of profits' },
        { name: 'M2 - Drawings' },
        { name: 'M2 - Members remuneration' },
        { name: 'M2 - Other movements' },
        { name: 'M3 - B/fwd' },
        { name: 'M3 - Allocation of profits' },
        { name: 'M3 - Drawings' },
        { name: 'M3 - Members remuneration' },
        { name: 'M3 - Other movements' },
        { name: 'M4 - B/fwd' },
        { name: 'M4 - Allocation of profits' },
        { name: 'M4 - Drawings' },
        { name: 'M4 - Members remuneration' },
        { name: 'M4 - Other movements' },
        { name: 'M5 - B/fwd' },
        { name: 'M5 - Allocation of profits' },
        { name: 'M5 - Drawings' },
        { name: 'M5 - Members remuneration' },
        { name: 'M5 - Other movements' },
        { name: 'M6 - B/fwd' },
        { name: 'M6 - Allocation of profits' },
        { name: 'M6 - Drawings' },
        { name: 'M6 - Members remuneration' },
        { name: 'M6 - Other movements' },
        { name: 'M7 - B/fwd' },
        { name: 'M7 - Allocation of profits' },
        { name: 'M7 - Drawings' },
        { name: 'M7 - Members remuneration' },
        { name: 'M7 - Other movements' },
        { name: 'M8 - B/fwd' },
        { name: 'M8 - Allocation of profits' },
        { name: 'M8 - Drawings' },
        { name: 'M8 - Members remuneration' },
        { name: 'M8 - Other movements' },
        { name: 'M9 - B/fwd' },
        { name: 'M9 - Allocation of profits' },
        { name: 'M9 - Drawings' },
        { name: 'M9 - Members remuneration' },
        { name: 'M9 - Other movements' },
      ],
    },
    {
      name: 'Members equity capital',
      ledger_key: 'members_equity_capital',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Introduced' },
        { name: 'Other movements' },
        { name: 'Repaid' },
      ],
    },
    {
      name: 'Revaluation reserve',
      ledger_key: 'revaluation_reserve',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'B/fwd' },
        { name: 'Other movements' },
        { name: 'Revaluation of land and buildings' },
        { name: 'Revaluation of subsidiaries, associates and joint ventures' },
      ],
    },
    {
      // Year-end net profit closes into "B/fwd" here (tagged retained_earnings),
      // then "Allocation of profits to members" moves it out to members.
      name: 'Other reserves (inc profit)',
      ledger_key: 'other_reserves',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'B/fwd', system_role: 'retained_earnings' },
        { name: 'Allocation of profits to members' },
        { name: 'Other movements' },
      ],
    },
  ],
};

// ── Trust (UK trust accounting) ─────────────────────────────────────────────
// 9 ledgers. Captured verbatim from a clean VT Transaction+ "Chart of accounts
// for trust accounting" export (27/06/26). Much simpler and structurally
// different: investment income (dividends/interest), trustee/professional fees,
// and beneficiaries' capital + income accounts instead of company/partner
// equity. No VAT and no fixed-asset ledgers. Net income for the period closes
// into "Beneficiaries → Income account" (tagged retained_earnings).
export const TRUST_COA_SEED: CoaTemplateSeed = {
  template_type: 'trust',
  ledgers: [
    {
      name: 'Income',
      ledger_key: 'income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Dividends' },
        { name: 'Interest' },
        { name: 'Other' },
      ],
    },
    {
      name: 'Expenses',
      ledger_key: 'expenses',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Accountants fees' },
        { name: 'Bank charges' },
        { name: 'Exchange differences' },
        { name: 'Legal fees' },
        { name: 'Other professional fees' },
        { name: 'Sundry' },
        { name: 'Trustee fees' },
        { name: 'Write backs' },
        { name: 'Write offs' },
      ],
    },
    {
      name: 'Taxation',
      ledger_key: 'taxation',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Tax' },
      ],
    },
    {
      // Investment holdings — added as the trust acquires them. Ships empty.
      name: 'Investments',
      ledger_key: 'investments',
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
        { name: 'Prepayments' },
        { name: 'Translation differences' },
      ],
    },
    {
      name: 'Bank accounts',
      ledger_key: 'bank',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Current account' },
        { name: 'Deposit account' },
      ],
    },
    {
      // Trade creditors — added as needed. Ships empty.
      name: 'Creditors ledger',
      ledger_key: 'creditors',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [],
    },
    {
      name: 'Other creditors',
      ledger_key: 'other_creditors',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Accruals' },
        { name: 'Deferred income' },
        { name: 'Inland Revenue' },
      ],
    },
    {
      // Beneficiaries' capital + income accounts. Net income closes into the
      // Income account (retained_earnings); capital movements to the Capital
      // account.
      name: 'Beneficiaries',
      ledger_key: 'beneficiaries',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Capital account' },
        { name: 'Income account', system_role: 'retained_earnings' },
      ],
    },
  ],
};

// ── Charity (Charities SORP / FRS 102) ──────────────────────────────────────
// HAND-BUILT (VT has no charity template) on the Charities SORP. Two things
// define charity accounts: the SOFA (Statement of Financial Activities) replaces
// the P&L, and FUND ACCOUNTING — every figure belongs to an unrestricted,
// restricted or endowment fund. We model funds as an orthogonal DIMENSION
// (bookkeeping_funds + a fund_id on each split, see 20260719 migration) rather
// than duplicating the chart per fund — so this COA stays clean and the per-fund
// SOFA is produced by the reporting layer (SofaTab) from the same accounts.
//
// Income ledgers = SOFA income headers; expenditure ledgers = SOFA expenditure
// headers. Net movement in funds closes into "Funds: Unrestricted funds"
// (retained_earnings). VAT control accounts ship for partially-VAT-registered
// charities. NOTE (v1): the year-end close posts to one accumulated-funds
// account (not split per fund), and auto-journals (depreciation) aren't
// fund-tagged yet — both are future refinements.
export const CHARITY_COA_SEED: CoaTemplateSeed = {
  template_type: 'charity',
  ledgers: [
    // ── SOFA — Income ───────────────────────────────────────────────────────
    {
      name: 'Donations and legacies',
      ledger_key: 'donations_legacies',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Donations' },
        { name: 'Legacies' },
        { name: 'Gift Aid reclaimed' },
        { name: 'Grants receivable' },
      ],
    },
    {
      name: 'Charitable activities income',
      ledger_key: 'charitable_income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Fees and charges' },
        { name: 'Contract income' },
        { name: 'Performance grants' },
      ],
    },
    {
      name: 'Other trading activities',
      ledger_key: 'trading_income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Fundraising events' },
        { name: 'Shop / trading income' },
        { name: 'Sponsorship' },
      ],
    },
    {
      name: 'Investment income',
      ledger_key: 'investment_income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Bank interest' },
        { name: 'Dividends' },
        { name: 'Rental income' },
      ],
    },
    {
      name: 'Other income',
      ledger_key: 'other_income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [
        { name: 'Other income' },
      ],
    },
    // ── SOFA — Expenditure ──────────────────────────────────────────────────
    {
      name: 'Cost of raising funds',
      ledger_key: 'raising_funds',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Fundraising costs' },
        { name: 'Trading costs' },
        { name: 'Investment management costs' },
      ],
    },
    {
      name: 'Charitable activities',
      ledger_key: 'charitable_expenditure',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Grants payable' },
        { name: 'Staff costs' },
        { name: 'Project costs' },
        { name: 'Premises costs' },
        { name: 'Depreciation', system_role: 'depreciation_expense' },
      ],
    },
    {
      name: 'Support costs',
      ledger_key: 'support_costs',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Office and administration' },
        { name: 'IT and communications' },
        { name: 'Insurance' },
        { name: 'Bank charges' },
      ],
    },
    {
      name: 'Governance costs',
      ledger_key: 'governance_costs',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Audit and accountancy' },
        { name: 'Legal and professional' },
        { name: 'Trustee expenses' },
      ],
    },
    {
      name: 'Other expenditure',
      ledger_key: 'other_expenditure',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: 'Net (gain)/loss on disposal of assets', system_role: 'disposal_pl' },
        { name: 'Other expenditure' },
      ],
    },
    // ── Balance sheet — assets ──────────────────────────────────────────────
    {
      name: 'FA - Tangible',
      ledger_key: 'fa_tangible',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Cost - b/fwd', system_role: 'fa_cost_bfwd' },
        { name: 'Cost - additions', system_role: 'fa_cost_additions' },
        { name: 'Cost - disposals', system_role: 'fa_cost_disposals' },
        { name: 'Depn - b/fwd', system_role: 'fa_depn_bfwd' },
        { name: 'Depn - charge for the year', system_role: 'fa_depn_charge' },
        { name: 'Depn - disposals', system_role: 'fa_depn_disposals' },
      ],
    },
    {
      // Investment holdings — added as acquired. Ships empty.
      name: 'Investments',
      ledger_key: 'investments',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [],
    },
    {
      name: 'Stocks',
      ledger_key: 'stocks',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Stock' },
      ],
    },
    {
      name: 'Debtors',
      ledger_key: 'debtors',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [
        { name: 'Trade debtors' },
        { name: 'Gift Aid recoverable' },
        { name: 'Prepayments' },
        { name: 'Accrued income' },
        { name: 'Other debtors' },
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
      // Client-specific — created as the user adds customers. Ships empty.
      name: 'Customers',
      ledger_key: 'customers',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [],
    },
    // ── Balance sheet — liabilities ─────────────────────────────────────────
    {
      // Trade suppliers — added as needed. Ships empty.
      name: 'Suppliers',
      ledger_key: 'suppliers',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [],
    },
    {
      name: 'Creditors',
      ledger_key: 'creditors',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Trade creditors' },
        { name: 'Accruals' },
        { name: 'Deferred income' },
        { name: 'Grants payable' },
        { name: 'PAYE and NI' },
        { name: 'Other creditors' },
        { name: 'Net VAT due', vat_only: true, system_role: 'net_vat_due' },
        { name: 'VAT - Input',  vat_only: true, system_role: 'vat_input' },
        { name: 'VAT - Output', vat_only: true, system_role: 'vat_output' },
      ],
    },
    {
      name: 'Creditors > 1 year',
      ledger_key: 'creditors_over_1yr',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Loans' },
        { name: 'Other creditors' },
      ],
    },
    // ── Funds (equity) ──────────────────────────────────────────────────────
    {
      // Brought-forward fund balances. The fund a movement belongs to is carried
      // on each split (fund dimension); these accumulate the closing balances.
      // Net movement closes into "Unrestricted funds" (retained_earnings) — v1
      // posts a single accumulated-funds close, not a per-fund split.
      name: 'Funds',
      ledger_key: 'funds',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Unrestricted funds', system_role: 'retained_earnings' },
        { name: 'Restricted funds' },
        { name: 'Endowment funds' },
      ],
    },
  ],
};

// ── Basic (generic catch-all) ────────────────────────────────────────────────
// Captured verbatim from VT Transaction+ "Basic ledgers with only default
// accounts set up" (28/06/26) — the minimal generic chart for any entity that
// doesn't fit the specific templates. Several ledgers ship EMPTY (Income,
// Taxation and dividends, Fixed assets, Customers, Suppliers) — the user adds
// accounts as needed. Net profit closes into "Shareholders' funds: Profit and
// loss account" (retained_earnings). VAT control accounts ship for VAT books.
//
// Note: the fixed-asset ledger is plain "Fixed assets" (not "FA - …"), so the
// depreciation engine doesn't drive it and there are no fa_*/depreciation/
// disposal roles to tag — fitting for a generic ships-empty chart.
export const BASIC_COA_SEED: CoaTemplateSeed = {
  template_type: 'basic',
  ledgers: [
    {
      name: 'Income',
      ledger_key: 'income',
      ledger_type: 'profit_and_loss',
      account_type: 'income',
      accounts: [],
    },
    {
      name: 'Expenses',
      ledger_key: 'expenses',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [
        { name: "Exchange diff's & charges" },
        { name: 'Write backs/discounts' },
        { name: 'Write offs/discounts' },
      ],
    },
    {
      // Appropriation ledger (corporation tax / dividends). Ships empty.
      name: 'Taxation and dividends',
      ledger_key: 'taxation_dividends',
      ledger_type: 'profit_and_loss',
      account_type: 'expense',
      accounts: [],
    },
    {
      name: 'Fixed assets',
      ledger_key: 'fixed_assets',
      ledger_type: 'balance_sheet',
      account_type: 'asset',
      accounts: [],
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
      ],
    },
    {
      // Trade suppliers — added as needed. Ships empty.
      name: 'Suppliers',
      ledger_key: 'suppliers',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [],
    },
    {
      name: 'Creditors',
      ledger_key: 'creditors',
      ledger_type: 'balance_sheet',
      account_type: 'liability',
      accounts: [
        { name: 'Accruals' },
        { name: 'Net VAT due',          vat_only: true, system_role: 'net_vat_due' },
        { name: 'Opening balances contra' },
        { name: 'VAT - Deferred input',  vat_only: true, system_role: 'vat_deferred_input' },
        { name: 'VAT - Deferred output', vat_only: true, system_role: 'vat_deferred_output' },
        { name: 'VAT - EC acquisitions', vat_only: true, system_role: 'vat_ec_acquisitions' },
        { name: 'VAT - Input',           vat_only: true, system_role: 'vat_input' },
        { name: 'VAT - Output',          vat_only: true, system_role: 'vat_output' },
      ],
    },
    {
      name: "Shareholders' funds",
      ledger_key: 'shareholders_funds',
      ledger_type: 'balance_sheet',
      account_type: 'equity',
      accounts: [
        { name: 'Profit and loss account', system_role: 'retained_earnings' },
      ],
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────
// New template seeds slot in here — no schema changes required.
export const COA_SEEDS: Partial<Record<BookTemplateType, CoaTemplateSeed>> = {
  ltd: LTD_COA_SEED,
  sole_trader: SOLE_TRADER_COA_SEED,
  partnership: PARTNERSHIP_COA_SEED,
  llp: LLP_COA_SEED,
  trust: TRUST_COA_SEED,
  charity: CHARITY_COA_SEED,
  basic: BASIC_COA_SEED,
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
