// Per-transaction-type configuration. Single source of truth for what each
// transaction "shape" looks like in the input sheet — column labels, which
// ledger the primary/analysis pickers filter to, whether VAT applies, and
// which direction (Input vs Output) VAT goes when it does.
//
// Used by:
//   • UniversalInputSheet — drives column labels, picker filters
//   • buildSplits         — drives the Dr/Cr layout per transaction type
//
// Journals (JRN) are NOT here — they use a separate Dr/Cr table UI which
// arrives in a follow-up sub-phase.

import type { TransactionType } from '@/types/bookkeeping';

export interface TransactionTypeConfig {
  type: TransactionType;
  /** What to call this in the type selector. */
  shortLabel: string;
  /** Longer description for tooltips. */
  description: string;
  /** Group the type belongs to — for visual ordering. */
  family: 'bank' | 'sales' | 'purchases' | 'transfer';
  /** Ledger the primary-account picker filters to (single VT-style ledger name). */
  primaryLedger: string | null;
  /** Label for the primary account column. */
  primaryLabel: string;
  /** Ledger the analysis-account picker filters to (null = any ledger). */
  analysisLedger: string | null;
  /** Label for the analysis account column. */
  analysisLabel: string;
  /** Does VAT apply? */
  hasVat: boolean;
  /**
   * Direction VAT flows when VAT applies. Used to pick the right Creditors
   * VAT account (Input vs Output).
   */
  vatDirection: 'input' | 'output' | null;
  /**
   * How the primary account moves in this transaction's splits.
   * - 'credit'  → primary is credited (money leaves, e.g. PAY/CHQ)
   * - 'debit'   → primary is debited  (money in, e.g. REC, SIN)
   *
   * The analysis account moves in the opposite direction.
   */
  primaryDirection: 'debit' | 'credit';
}

export const TRANSACTION_TYPE_CONFIG: Record<
  Exclude<TransactionType, 'JRN' | 'RJN' | 'YET' | 'DVT' | 'TRF'>,
  TransactionTypeConfig
> & { TRF: TransactionTypeConfig } = {
  PAY: {
    type: 'PAY',
    shortLabel: 'Bank payment',
    description: 'Money out of the bank to a supplier or expense',
    family: 'bank',
    primaryLedger: 'Bank',
    primaryLabel: 'Bank account',
    analysisLedger: null,
    analysisLabel: 'Analysis account',
    hasVat: true,
    vatDirection: 'input',
    primaryDirection: 'credit',
  },
  CHQ: {
    type: 'CHQ',
    shortLabel: 'Cheque payment',
    description: 'Cheque issued — separate reference series from PAY',
    family: 'bank',
    primaryLedger: 'Bank',
    primaryLabel: 'Bank account',
    analysisLedger: null,
    analysisLabel: 'Analysis account',
    hasVat: true,
    vatDirection: 'input',
    primaryDirection: 'credit',
  },
  REC: {
    type: 'REC',
    shortLabel: 'Bank receipt',
    description: 'Money into the bank from a customer or other source',
    family: 'bank',
    primaryLedger: 'Bank',
    primaryLabel: 'Bank account',
    analysisLedger: null,
    analysisLabel: 'Source / analysis',
    hasVat: true,
    vatDirection: 'output',
    primaryDirection: 'debit',
  },
  TRF: {
    type: 'TRF',
    shortLabel: 'Transfer',
    description: 'Move money between two bank accounts',
    family: 'transfer',
    primaryLedger: 'Bank',
    primaryLabel: 'From bank',
    analysisLedger: 'Bank',
    analysisLabel: 'To bank',
    hasVat: false,
    vatDirection: null,
    primaryDirection: 'credit',
  },
  SIN: {
    type: 'SIN',
    shortLabel: 'Sales invoice',
    description: 'Bill a customer for goods or services',
    family: 'sales',
    primaryLedger: 'Customers',
    primaryLabel: 'Customer',
    analysisLedger: null,
    analysisLabel: 'Income account',
    hasVat: true,
    vatDirection: 'output',
    primaryDirection: 'debit',
  },
  SCR: {
    type: 'SCR',
    shortLabel: 'Sales credit note',
    description: 'Credit issued to a customer — reverses a sales invoice',
    family: 'sales',
    primaryLedger: 'Customers',
    primaryLabel: 'Customer',
    analysisLedger: null,
    analysisLabel: 'Income account',
    hasVat: true,
    vatDirection: 'output',
    primaryDirection: 'credit',
  },
  PIN: {
    type: 'PIN',
    shortLabel: 'Purchase invoice',
    description: 'Bill received from a supplier',
    family: 'purchases',
    primaryLedger: 'Suppliers',
    primaryLabel: 'Supplier',
    analysisLedger: null,
    analysisLabel: 'Expense account',
    hasVat: true,
    vatDirection: 'input',
    primaryDirection: 'credit',
  },
  PCR: {
    type: 'PCR',
    shortLabel: 'Purchase credit note',
    description: 'Credit received from a supplier — reverses a purchase invoice',
    family: 'purchases',
    primaryLedger: 'Suppliers',
    primaryLabel: 'Supplier',
    analysisLedger: null,
    analysisLabel: 'Expense account',
    hasVat: true,
    vatDirection: 'input',
    primaryDirection: 'debit',
  },
  // WOF / WBK live in the "purchases" family (they typically act on supplier
  // ledgers) but the primary picker is open to ANY ledger because the user
  // might be writing off a debtor balance as well. VAT is off — write-offs
  // don't carry VAT (the VAT was claimed/charged on the original invoice).
  WOF: {
    type: 'WOF',
    shortLabel: 'Write off',
    description: 'Clear a residual balance — Dr expense, Cr supplier/debtor',
    family: 'purchases',
    primaryLedger: null,
    primaryLabel: 'Supplier / debtor',
    analysisLedger: null,
    analysisLabel: 'Write-off account',
    hasVat: false,
    vatDirection: null,
    primaryDirection: 'credit',
  },
  WBK: {
    type: 'WBK',
    shortLabel: 'Write back',
    description: 'Re-instate a previously written-off balance — Dr supplier/debtor, Cr expense',
    family: 'purchases',
    primaryLedger: null,
    primaryLabel: 'Supplier / debtor',
    analysisLedger: null,
    analysisLabel: 'Write-back account',
    hasVat: false,
    vatDirection: null,
    primaryDirection: 'debit',
  },
};

/** Type guard for "types using the primary/analysis input sheet". The journal-
 *  style types (JRN, RJN, YET, DVT) have their own multi-leg Dr/Cr grid UI. */
export function isInputSheetType(t: TransactionType): t is keyof typeof TRANSACTION_TYPE_CONFIG {
  return t !== 'JRN' && t !== 'RJN' && t !== 'YET' && t !== 'DVT';
}

export function getTypeConfig(t: TransactionType): TransactionTypeConfig | null {
  return isInputSheetType(t) ? TRANSACTION_TYPE_CONFIG[t] : null;
}
