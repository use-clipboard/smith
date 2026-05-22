// Pure split-builder. Given (config + row data + VAT account ids), produces
// the splits[] to send to POST /transactions. All accounting logic lives here
// so the input sheet, future invoice modals, and any future bulk importer can
// share the same Dr/Cr rules.
//
// Rules (canonical):
//   PAY/CHQ:        Cr Bank (total), Dr analysis (net), Dr VAT-Input (vat)
//   REC:            Dr Bank (total), Cr analysis (net), Cr VAT-Output (vat)
//   SIN:            Dr Customer (total), Cr Income (net), Cr VAT-Output (vat)
//   SCR:            Cr Customer (total), Dr Income (net), Dr VAT-Output (vat)
//   PIN:            Cr Supplier (total), Dr Expense (net), Dr VAT-Input (vat)
//   PCR:            Dr Supplier (total), Cr Expense (net), Cr VAT-Input (vat)
//   TRF:            Cr "from bank" (total), Dr "to bank" (total) — no VAT
//
// If VAT > 0 but the corresponding VAT account isn't in the book (e.g. non-VAT
// book that somehow got vat > 0 — defensively), we lump VAT into the analysis
// account so the splits balance. The API layer enforces vat=0 on non-VAT
// books separately.

import type { TransactionTypeConfig } from './transactionTypeConfig';

export interface BuildSplitsInput {
  config: TransactionTypeConfig;
  primaryAccountId: string;
  analysisAccountId: string;
  total: number;
  vat: number;
  net: number;
  /** Looked up by the caller via /api/bookkeeping/books/[id]/vat-accounts. */
  vatInputAccountId: string | null;
  vatOutputAccountId: string | null;
  entryDetails?: string | null;
  notes?: string | null;
}

export interface SplitInput {
  account_id: string;
  debit: number;
  credit: number;
  entry_details?: string | null;
  notes?: string | null;
}

export function buildSplits(input: BuildSplitsInput): SplitInput[] {
  const { config, primaryAccountId, analysisAccountId, total, vat, net,
          vatInputAccountId, vatOutputAccountId, entryDetails, notes } = input;

  // TRF — two bank accounts, no VAT, gross both sides.
  if (config.type === 'TRF') {
    return [
      { account_id: primaryAccountId,  debit: 0,     credit: total },
      { account_id: analysisAccountId, debit: total, credit: 0,
        entry_details: entryDetails ?? null, notes: notes ?? null },
    ];
  }

  const primaryIsDebit = config.primaryDirection === 'debit';
  const analysisIsDebit = !primaryIsDebit;

  // Pick the right VAT account.
  let vatAccountId: string | null = null;
  if (config.hasVat && vat > 0) {
    vatAccountId = config.vatDirection === 'input' ? vatInputAccountId : vatOutputAccountId;
  }
  const hasVatAccount = vatAccountId !== null && vat > 0;

  const splits: SplitInput[] = [
    // Primary leg — moves by the gross total
    {
      account_id: primaryAccountId,
      debit:  primaryIsDebit  ? total : 0,
      credit: primaryIsDebit  ? 0     : total,
    },
    // Analysis leg — moves by net if we can route VAT separately, else gross
    {
      account_id: analysisAccountId,
      debit:  analysisIsDebit ? (hasVatAccount ? net : total) : 0,
      credit: analysisIsDebit ? 0 : (hasVatAccount ? net : total),
      entry_details: entryDetails ?? null,
      notes: notes ?? null,
    },
  ];

  // VAT leg — only when we have an account to route to
  if (hasVatAccount) {
    splits.push({
      account_id: vatAccountId!,
      debit:  analysisIsDebit ? vat : 0,
      credit: analysisIsDebit ? 0   : vat,
    });
  }

  return splits;
}
