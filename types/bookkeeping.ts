// Bookkeeping tool — shared types.
//
// Kept in its own file (not types/index.ts) because the tool is large and
// will grow many domain types — transactions, splits, matches, VAT returns,
// etc. — over the course of the build.

export type BookTemplateType =
  | 'basic'
  | 'ltd'
  | 'llp'
  | 'partnership'
  | 'sole_trader'
  | 'trust'
  | 'charity';

export type VatScheme =
  | 'standard'
  | 'flat_rate'
  | 'cash'
  | 'annual'
  | 'margin'
  | 'partial_exemption';

export type BookRole = 'viewer' | 'bookkeeper' | 'reviewer' | 'admin';

export interface BookClientRef {
  id: string;
  name: string;
  client_ref: string | null;
  /** Client record status — 'active' | 'hold' | 'inactive'. */
  status?: string | null;
}

export interface BookCreatorRef {
  id: string;
  full_name: string | null;
  email: string;
}

export interface Book {
  id: string;
  firm_id: string;
  client_id: string | null;
  client?: BookClientRef | null;
  name: string;
  template_type: BookTemplateType;
  base_currency: string;
  vat_registered: boolean;
  vat_scheme: VatScheme | null;
  vat_number: string | null;
  /** Flat Rate Scheme percentage (e.g. 14.50). Only meaningful when
   *  vat_scheme === 'flat_rate'. */
  flat_rate_percentage: number | null;
  period_lock_date: string | null;
  /** Soft VAT lock — auto-set to the latest filed VAT return's period_to.
   *  Transactions dated on/before this can still be posted, but they must be
   *  flagged as late entries via `vat_period_override` on the transaction. */
  vat_lock_date: string | null;
  /** MM-DD pattern for the book's year-end (e.g. '03-31'). Drives the FY
   *  boundaries surfaced in bookkeeping_financial_years. Null means the
   *  user hasn't set a year-end yet — most period features stay dormant
   *  until they do. */
  year_end_md: string | null;
  current_fy_id?: string | null;
  /** Start date of the very first FY on this book. Set the first time the
   *  user sets a year-end. Can be a "short first year" (i.e. doesn't have
   *  to align with the pattern). */
  first_period_start: string | null;
  /** Equity account that the year-end close journal credits the net P&L
   *  into. Null until the user picks one in book settings. */
  retained_earnings_account_id: string | null;
  admin_locked: boolean;
  archived: boolean;
  created_by: string | null;
  creator?: BookCreatorRef | null;
  created_at: string;
  updated_at: string;
}

// ── Financial years (period management) ──────────────────────────────────────

export type FinancialYearStatus = 'open' | 'closed' | 'reopened';

export interface FinancialYear {
  id: string;
  book_id: string;
  /** ISO yyyy-mm-dd inclusive boundary. */
  start_date: string;
  end_date: string;
  status: FinancialYearStatus;
  closed_at: string | null;
  closed_by: string | null;
  /** The JRN that effected the year-end close (zeros P&L into Retained
   *  earnings). Null until the year is closed. */
  closing_journal_id: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Picker labels (ordered for the create modal) ─────────────────────────────

export const BOOK_TEMPLATE_OPTIONS: { id: BookTemplateType; label: string; hint: string }[] = [
  { id: 'ltd',           label: 'Limited Company',  hint: 'Companies House registered, CT' },
  { id: 'sole_trader',   label: 'Sole Trader',      hint: 'Single owner, unincorporated (incl. self-employed)' },
  { id: 'partnership',   label: 'Partnership',      hint: 'Two or more partners, no LLP' },
  { id: 'llp',           label: 'LLP',              hint: 'Limited Liability Partnership' },
  { id: 'trust',         label: 'Trust',            hint: 'Discretionary, interest-in-possession, etc.' },
  { id: 'charity',       label: 'Charity',          hint: 'Charity Commission / SORP' },
  { id: 'basic',         label: 'Basic',            hint: 'Generic chart of accounts — anything else' },
];

export const BOOK_TEMPLATE_LABEL: Record<BookTemplateType, string> =
  Object.fromEntries(BOOK_TEMPLATE_OPTIONS.map(o => [o.id, o.label])) as Record<BookTemplateType, string>;

export const VAT_SCHEME_OPTIONS: { id: VatScheme; label: string }[] = [
  { id: 'standard',          label: 'Standard (accrual)' },
  { id: 'cash',              label: 'Cash accounting' },
  { id: 'flat_rate',         label: 'Flat rate' },
  { id: 'annual',            label: 'Annual accounting' },
  { id: 'margin',            label: 'Margin scheme' },
  { id: 'partial_exemption', label: 'Partial exemption' },
];

export const VAT_SCHEME_LABEL: Record<VatScheme, string> =
  Object.fromEntries(VAT_SCHEME_OPTIONS.map(o => [o.id, o.label])) as Record<VatScheme, string>;

// Common base currencies. Multi-currency support arrives later phases — this
// is just the list shown in the picker on book creation.
export const BASE_CURRENCY_OPTIONS = ['GBP', 'EUR', 'USD'] as const;
export type BaseCurrency = typeof BASE_CURRENCY_OPTIONS[number];

// ── Charity funds (fund accounting dimension) ────────────────────────────────

export type FundType = 'unrestricted' | 'restricted' | 'endowment';

export const FUND_TYPE_LABEL: Record<FundType, string> = {
  unrestricted: 'Unrestricted',
  restricted: 'Restricted',
  endowment: 'Endowment',
};

export const FUND_TYPE_OPTIONS: { id: FundType; label: string; hint: string }[] = [
  { id: 'unrestricted', label: 'Unrestricted', hint: 'General funds the charity can spend on any of its purposes' },
  { id: 'restricted',   label: 'Restricted',   hint: 'Funds the donor restricted to a specific purpose' },
  { id: 'endowment',    label: 'Endowment',    hint: 'Capital that must be retained, not spent' },
];

export interface BookFund {
  id: string;
  book_id: string;
  name: string;
  fund_type: FundType;
  description: string | null;
  sort_order: number;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  /** Whether the fund has any posted splits (drives delete-protection in UI). */
  in_use?: boolean;
}

/** Minimal fund shape for display on a split. */
export interface BookFundRef {
  id: string;
  name: string;
  fund_type: FundType;
}

// ── Transactions ────────────────────────────────────────────────────────────

export type TransactionType =
  | 'PAY'  // Bank payment (out of bank)
  | 'CHQ'  // Cheque payment (out of bank, separate sequence)
  | 'REC'  // Bank receipt (into bank)
  | 'SIN'  // Sales invoice
  | 'SCR'  // Sales credit note
  | 'PIN'  // Purchase invoice
  | 'PCR'  // Purchase credit note
  | 'JRN'  // Journal
  | 'RJN'  // Reversing journal — self-reverses on a chosen future date
  | 'TRF'  // Bank-to-bank transfer
  | 'WOF'  // Write off — clear residual supplier/debtor balance
  | 'WBK'  // Write back — re-instate a previously written-off balance
  | 'YET'  // Year-end transaction — closing journal posted on FY end date
  | 'DVT'; // Deferred VAT transfer — moves import VAT between control accounts

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  PAY: 'Bank payment',
  CHQ: 'Cheque payment',
  REC: 'Bank receipt',
  SIN: 'Sales invoice',
  SCR: 'Sales credit note',
  PIN: 'Purchase invoice',
  PCR: 'Purchase credit note',
  JRN: 'Journal',
  RJN: 'Reversing journal',
  TRF: 'Transfer',
  WOF: 'Write off',
  WBK: 'Write back',
  YET: 'Year-end transaction',
  DVT: 'Deferred VAT transfer',
};

export type TransactionStatus = 'posted' | 'draft';

export type VatTreatment =
  | 'no_vat'
  | 'standard_20'
  | 'reduced_5'
  | 'zero'
  | 'exempt'
  | 'outside_scope';

export const VAT_TREATMENT_OPTIONS: { id: VatTreatment; label: string; rate: number }[] = [
  { id: 'no_vat',         label: 'No VAT',           rate: 0  },
  { id: 'standard_20',    label: 'Standard (20%)',   rate: 20 },
  { id: 'reduced_5',      label: 'Reduced (5%)',     rate: 5  },
  { id: 'zero',           label: 'Zero-rated',       rate: 0  },
  { id: 'exempt',         label: 'Exempt',           rate: 0  },
  { id: 'outside_scope',  label: 'Outside scope',    rate: 0  },
];

export interface BookAccountRef {
  id: string;
  name: string;
  ledger: string | null;
  account_type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  /** User-facing ranged-by-type account number (display only). */
  code?: string | null;
}

export interface TransactionSplit {
  id: string;
  transaction_id: string;
  line_no: number;
  account_id: string;
  account?: BookAccountRef | null;
  debit: number;
  credit: number;
  entry_details: string | null;
  notes: string | null;
  /** Charity fund this line belongs to. Null on non-charity books. */
  fund_id: string | null;
  /** Denormalised fund ref for display (joined on read). */
  fund?: BookFundRef | null;
}

export interface Transaction {
  id: string;
  book_id: string;
  type: TransactionType;
  ref_no: string;
  ref_seq: number;
  date: string;
  payee_text: string | null;
  details: string | null;
  total: number;
  vat_total: number;
  vat_rate: number | null;
  vat_treatment: VatTreatment | null;
  /** Late-entry override. When set, the VAT-return calculation uses this
   *  date instead of `date` to slot the transaction into a VAT return.
   *  Allows missed invoices for a filed period to be carried into the
   *  next return while keeping their real posting date for P&L/BS. */
  vat_period_override: string | null;
  primary_account_id: string | null;
  primary_account?: BookAccountRef | null;
  /** FRS — purchase flagged as a reclaimable capital asset. */
  frs_capital_reclaim?: boolean;
  status: TransactionStatus;
  /** Link to the source document (Google Drive via Capture/Vault). Pointer
   *  only — the file is not stored in SMITH. */
  source_doc_url?: string | null;
  source_doc_name?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  splits?: TransactionSplit[];
}

// ── Recurring (memorised) transactions ──────────────────────────────────────

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const RECURRING_FREQUENCY_OPTIONS: { id: RecurringFrequency; label: string }[] = [
  { id: 'weekly',    label: 'Weekly' },
  { id: 'monthly',   label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly',    label: 'Yearly' },
];

export const RECURRING_FREQUENCY_LABEL: Record<RecurringFrequency, string> =
  Object.fromEntries(RECURRING_FREQUENCY_OPTIONS.map(o => [o.id, o.label])) as Record<RecurringFrequency, string>;

/** One leg of a recurring template. Mirrors a transaction split. */
export interface RecurringSplit {
  account_id: string;
  debit: number;
  credit: number;
  entry_details?: string | null;
  notes?: string | null;
  fund_id?: string | null;
}

/** The saved transaction shape a recurring template materialises into. */
export interface RecurringTemplate {
  payee_text: string | null;
  details: string | null;
  total: number;
  vat_total: number;
  vat_rate: number | null;
  vat_treatment: VatTreatment | null;
  primary_account_id: string | null;
  splits: RecurringSplit[];
}

export interface RecurringTransaction {
  id: string;
  book_id: string;
  name: string;
  type: TransactionType;
  frequency: RecurringFrequency;
  interval_count: number;
  next_due_date: string;
  /** Stop once next_due_date passes this date (null = no date limit). */
  end_date: string | null;
  /** Stop after this many posted occurrences (null = no count limit). */
  max_occurrences: number | null;
  /** How many occurrences have been posted so far. */
  occurrences_posted: number;
  last_run_date: string | null;
  active: boolean;
  template: RecurringTemplate;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Derived server-side: occurrence is due on/before today and still active. */
  is_due?: boolean;
}

// ── VAT returns ─────────────────────────────────────────────────────────────

export interface VatReturn {
  id: string;
  book_id: string;
  /** Sequential VT-style ref — VAT 000001, etc. */
  ref_no: string | null;
  ref_seq: number | null;
  period_from: string;
  period_to: string;
  box1: number;
  box2: number;
  box3: number;
  box4: number;
  box5: number;
  box6: number;
  box7: number;
  box8: number;
  box9: number;
  /** VAT amount in this return that came in via late entries from earlier
   *  filed periods. Memorandum figure for the 10th row of the boxes table. */
  late_entry_vat: number;
  filed_at: string;
  filed_by: string | null;
  filed_by_name?: string | null;
  /** When the return was actually sent to HMRC. Distinct from filed_at, which
   *  is when it was recorded in SMITH. Null until set. */
  submitted_at: string | null;
  submission_method: 'manual' | 'mtd_api' | null;
  hmrc_reference: string | null;
  notes: string | null;
  /** Link to the closing journal posted at filing time. */
  filing_journal_id: string | null;
  /** Full transaction-level audit snapshot captured at filing time. */
  snapshot: unknown;
  created_at: string;
  updated_at: string;
}

// ── Fixed asset depreciation ─────────────────────────────────────────────────

export type DepreciationMethod = 'straight_line' | 'reducing_balance';
export type AssetSource = 'addition' | 'brought_forward';
export type AssetStatus = 'active' | 'disposed';

/** Effective-dated rate/method for one FA ledger. */
export interface LedgerDepreciationSetting {
  id: string;
  book_id: string;
  ledger: string;
  effective_from: string;
  method: DepreciationMethod;
  /** Annual rate as a percentage, e.g. 25 for 25%. */
  annual_rate: number;
  created_by: string | null;
  created_at: string;
}

/** One fixed asset in the register. */
export interface Asset {
  id: string;
  book_id: string;
  ledger: string;
  source: AssetSource;
  /** The Cost-additions split that booked an `addition`; null for b/fwd. */
  split_id: string | null;
  /** Charity fund this asset belongs to (NULL on non-charity books).
   *  Additions inherit it from their booking split; depreciation/disposal
   *  journals carry it so the per-fund SOFA reconciles. */
  fund_id: string | null;
  description: string;
  purchase_date: string;
  cost: number;
  /** Accumulated depreciation before the register existed (b/fwd only). */
  opening_accumulated_depn: number;
  status: AssetStatus;
  disposal_date: string | null;
  disposal_proceeds: number | null;
  disposal_journal_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One posted depreciation charge for an asset in a period. */
export interface DepreciationCharge {
  id: string;
  book_id: string;
  asset_id: string;
  period_from: string;
  period_to: string;
  amount: number;
  /** Method & rate in force when this charge was posted. Null on legacy rows
   *  posted before these were captured — callers fall back to the settings. */
  method?: DepreciationMethod | null;
  annual_rate?: number | null;
  journal_txn_id: string | null;
  created_at: string;
}

/** A computed row in the asset schedule for a given period. */
export interface AssetScheduleRow {
  asset: Asset;
  method: DepreciationMethod;
  annualRate: number;
  /** Accumulated depreciation at the start of the period. */
  depnBroughtForward: number;
  /** Charge computed for the period (0 once fully depreciated / disposed before it). */
  periodCharge: number;
  /** Accumulated depreciation at the end of the period. */
  depnCarriedForward: number;
  /** Net book value at the end of the period. */
  nbv: number;
  /** Whether this period's charge has already been posted to a journal. */
  posted: boolean;
}

// Best-effort mapping from a client's business_type to a sensible default
// template_type for the create modal. The user can always change it.
export function defaultTemplateFromBusinessType(bt: string | null | undefined): BookTemplateType {
  if (!bt) return 'basic';
  const t = bt.toLowerCase();
  if (t.includes('limited') || t.includes('ltd')) return 'ltd';
  if (t.includes('llp')) return 'llp';
  if (t.includes('partnership')) return 'partnership';
  if (t.includes('sole')) return 'sole_trader';
  if (t.includes('self') || t.includes('individual')) return 'sole_trader';
  if (t.includes('trust')) return 'trust';
  if (t.includes('charity')) return 'charity';
  return 'basic';
}

// ── Book participants (people behind the entity) ─────────────────────────────

export type ParticipantRole = 'partner' | 'sole_trader' | 'director' | 'shareholder';
export type ParticipantSource = 'client_link' | 'key_contact' | 'manual';

export const PARTICIPANT_ROLE_LABEL: Record<ParticipantRole, string> = {
  partner: 'Partner',
  sole_trader: 'Sole trader',
  director: 'Director',
  shareholder: 'Shareholder',
};

export interface BookParticipant {
  id: string;
  book_id: string;
  role: ParticipantRole;
  source_type: ParticipantSource;
  /** The client record this person is (when source is a client link). Bridge to
   *  self-assessment / vouchers / minutes later. */
  linked_client_id: string | null;
  name: string;
  profit_share_pct: number | null;
  shareholding_pct: number | null;
  shares_held: number | null;
  annual_salary: number | null;
  /** Optional mapping to the per-partner capital ledger account (P1..P9). */
  capital_account_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

/** A pickable source for adding a participant (client link or key contact). */
export interface ParticipantSourceOption {
  kind: 'client_link' | 'key_contact';
  /** client id (link) or a synthetic id (key contact). */
  ref_id: string;
  name: string;
  /** e.g. 'director' / 'shareholder' from the link type or contact role. */
  role_hint: string | null;
  linked_client_id: string | null;
  /** Ownership % carried on a client link, if any. */
  ownership_percentage: number | null;
}
