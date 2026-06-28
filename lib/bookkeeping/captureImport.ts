// Convert a Capture (SMITH-format) transaction into a staged ParsedTransaction
// for the bookkeeping import pipeline. Pure — the endpoint resolves the account
// references (against the book's COA) and passes them in.
//
// Canonical double-entry (mirrors lib/bookkeeping/buildSplits):
//   PIN  Cr supplier (gross) / Dr analysis (net) / Dr VAT-Input (vat)
//   PCR  Dr supplier (gross) / Cr analysis (net) / Cr VAT-Input (vat)
//   SIN  Dr customer (gross) / Cr analysis (net) / Cr VAT-Output (vat)
//   SCR  Cr customer (gross) / Dr analysis (net) / Dr VAT-Output (vat)
//   PAY  Cr bank (gross)     / Dr analysis (net) / Dr VAT-Input (vat)
//   REC  Dr bank (gross)     / Cr analysis (net) / Cr VAT-Output (vat)
//
// VAT safety net: when the book isn't VAT-registered (no VAT account supplied),
// the analysis leg takes the GROSS amount, no VAT leg is posted, and a warning
// is emitted.

import type { ParsedTransaction, ParsedSplit } from './vtTransactionReportParser';
import type { TransactionType } from '@/types/bookkeeping';

export interface AccountRef { ledger: string; name: string }

export interface CaptureRow {
  type: string;            // PIN | SIN | PAY | REC | PCR | SCR
  date: string;            // ISO yyyy-mm-dd
  contactName: string;
  reference: string;
  description: string;
  net: number;
  vat: number;
  gross: number;
  vatTreatment: string;
  primary: AccountRef;     // supplier / customer / bank
  analysis: AccountRef;    // income / expense account
  vatAccount: AccountRef | null; // null → don't post VAT (safety net)
  sourceDocUrl: string | null;
  sourceDocName: string | null;
  index: number;
}

const r2 = (n: number) => +(n || 0).toFixed(2);

/** Whether the PRIMARY leg is a debit for this transaction type. */
function primaryIsDebit(type: string): boolean {
  return type === 'PCR' || type === 'SIN' || type === 'REC';
}

export function buildCaptureTransaction(row: CaptureRow): { txn: ParsedTransaction; warnings: string[] } {
  const warnings: string[] = [];
  const hasVat = !!row.vatAccount && r2(row.vat) > 0;
  if (!row.vatAccount && r2(row.vat) > 0) {
    warnings.push(`${row.contactName || row.reference || 'A transaction'}: VAT £${r2(row.vat).toFixed(2)} detected but the book isn't VAT-registered — posted gross.`);
  }

  const gross = r2(row.gross);
  const analysisAmount = hasVat ? r2(row.net) : gross;
  const vat = r2(row.vat);
  const primaryDr = primaryIsDebit(row.type);

  const mk = (acc: AccountRef, debit: number, credit: number, line: number): ParsedSplit => ({
    accountDisplay: `${acc.ledger}: ${acc.name}`,
    ledger: acc.ledger,
    accountName: acc.name,
    entryDetails: row.description || null,
    debit: r2(debit),
    credit: r2(credit),
    marker: null,
    sourceRow: line,
  });

  const splits: ParsedSplit[] = [];
  let line = 1;
  // Primary leg — gross.
  splits.push(mk(row.primary, primaryDr ? gross : 0, primaryDr ? 0 : gross, line++));
  // Analysis leg — opposite direction, net (or gross under the safety net).
  splits.push(mk(row.analysis, primaryDr ? 0 : analysisAmount, primaryDr ? analysisAmount : 0, line++));
  // VAT leg — same direction as analysis.
  if (hasVat && row.vatAccount) {
    splits.push(mk(row.vatAccount, primaryDr ? 0 : vat, primaryDr ? vat : 0, line++));
  }

  const headerDetails = row.description
    || (row.contactName ? `${row.reference ? row.reference + ' — ' : ''}${row.contactName}` : null);

  const txn: ParsedTransaction = {
    originalRef: `__capture_${row.index}`,
    type: row.type as TransactionType,
    refSeq: row.index + 1,
    refNo: `${row.type} ${String(row.index + 1).padStart(6, '0')}`,
    originalRefIfRemapped: null,
    date: row.date,
    details: headerDetails,
    notes: null,
    splits,
    errors: [],
    sourceRowStart: row.index + 1,
    source: 'capture',
    vat_total: hasVat ? vat : 0,
    vat_treatment: hasVat ? row.vatTreatment : 'no_vat',
    source_doc_url: row.sourceDocUrl,
    source_doc_name: row.sourceDocName,
  };
  return { txn, warnings };
}
