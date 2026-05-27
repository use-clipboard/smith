/**
 * VT Transaction Report parser.
 *
 * Reads an XLSX export from VT's "Transaction Report" (every leg of every
 * transaction, double-entry layout) and turns it into a list of parsed
 * SMITH transactions ready to be inserted.
 *
 * ─── VT export layout (8 columns) ──────────────────────────────────────────
 *
 *   A  Date            (Excel serial, e.g. 46112 = 31-Mar-2026)
 *   B  Reference       ("PAY 001528", "REC 000116", "WOF 000004"…)
 *   C  Cleared flag    blank usually; carries "C" for reconciled rows — ignored
 *   D  Account         "Ledger: Account" form ("Bank: Current account",
 *                       "Suppliers: Cully Cullen"…)
 *   E  Details         per-split narrative — goes into split.entry_details
 *   F  A-marker        "§" = primary, "¢" = analysis. Informational; we use
 *                       G/H to decide Dr/Cr so this is just retained as
 *                       split.notes when present.
 *   G  Debit amount    set on the Dr leg
 *   H  Credit amount   set on the Cr leg
 *
 * Each transaction occupies N rows (one per leg) sharing the same reference,
 * separated from the next transaction by a blank row.
 *
 * ─── Notes ─────────────────────────────────────────────────────────────────
 * Column A normally holds the date, but VT also uses col A for FREE-TEXT
 * notes attached to the transaction immediately above. These rows have:
 *   • col A: arbitrary text (NOT an Excel serial date)
 *   • cols B, D, E, G, H: empty
 *
 * Notes can span multiple consecutive rows — even with internal blank rows
 * (VT uses a blank line as a paragraph break). We greedily consume every
 * note row + blank-after-note row until we hit a row that contains a real
 * date+ref (= start of the next transaction).
 *
 * ─── Type remapping ────────────────────────────────────────────────────────
 * VT has more transaction types than SMITH. We translate at the import
 * boundary rather than building UI for legacy types:
 *
 *   PCV → PAY      (petty-cash payment — same shape as PAY)
 *   CCV → PAY      (credit-card voucher — same shape as PAY)
 *   CTX → REC|PAY  (cash transaction — decide by which side of the cash
 *                    account moves: Dr cash → REC, Cr cash → PAY)
 *   VAT → JRN      (VT-generated VAT return entries — going forward SMITH
 *                    has its own VAT Return tab, so these are imported as
 *                    plain journals)
 *   PGS → JRN      (purge summarisation — VT archive entries)
 *   CRV → JRN      (currency revaluation — multi-currency, rarely seen)
 *
 * Refs from remapped types keep their original number in a `notes` tag so
 * a user matching back to the old VT file can still find them.
 *
 * Everything else (PAY/CHQ/REC/TRF/SIN/SCR/PIN/PCR/JRN/RJN/WOF/WBK/YET/DVT)
 * passes through as-is and keeps its original ref number.
 *
 * ─── What we return ────────────────────────────────────────────────────────
 * The parser is pure: it doesn't touch the database. It returns a fully
 * typed structure the importer route then validates against the live COA
 * and inserts in batches.
 */

import * as XLSX from 'xlsx';
import type { TransactionType } from '@/types/bookkeeping';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ParsedSplit {
  /** "Ledger: Account" string, exactly as it appeared in column D. */
  accountDisplay: string;
  /** Parsed ledger (left of ":"). */
  ledger: string;
  /** Parsed account name (right of ":"). */
  accountName: string;
  /** Per-split narrative — goes into split.entry_details. */
  entryDetails: string | null;
  /** Debit amount (≥0). */
  debit: number;
  /** Credit amount (≥0). */
  credit: number;
  /** § / ¢ marker if present — kept on the split's `notes` for audit. */
  marker: string | null;
  /** Original row number in the spreadsheet (1-based, including header).
   *  Used for error reporting back to the user. */
  sourceRow: number;
}

export interface ParsedTransaction {
  /** Original VT reference, e.g. "PAY 001528" — used to derive type + seq. */
  originalRef: string;
  /** SMITH transaction type after remapping (PAY/REC/JRN/…). */
  type: TransactionType;
  /** SMITH ref number sequence — preserved from VT verbatim
   *  (e.g. 1528 from "PAY 001528"). For remapped types we keep VT's seq
   *  too, then advance the destination type's counter. */
  refSeq: number;
  /** Final SMITH ref string, e.g. "PAY 001528". For remapped types this
   *  becomes the new type's prefix, e.g. CTX 000010 → REC <next seq>. */
  refNo: string;
  /** When the original VT ref differs from what we'd post (i.e. type was
   *  remapped, or seq was reallocated), this carries the original so the
   *  notes can reference it. NULL when no remap happened. */
  originalRefIfRemapped: string | null;
  /** Transaction date in ISO yyyy-mm-dd. */
  date: string;
  /** Transaction-level narrative — VT keeps this on every split row in col
   *  E. We pick the first non-empty one as the header details. */
  details: string | null;
  /** Multi-line free-text notes attached to the transaction (col A rows
   *  following the splits). Null if none. */
  notes: string | null;
  splits: ParsedSplit[];
  /** Set of validation errors found in this transaction's rows. The
   *  transaction is still emitted so the user can see and fix the row;
   *  the importer refuses to POST if any errors are present. */
  errors: string[];
  /** First source-row (1-based) of this transaction in the spreadsheet. */
  sourceRowStart: number;
}

export interface ParsedCoaEntry {
  /** "Ledger: Account" — the unique identity. */
  display: string;
  ledger: string;
  accountName: string;
  /** Inferred account_type by ledger-name mapping. May need user override. */
  inferredAccountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
}

export interface ParseResult {
  /** All parsed transactions in source order (oldest first if the sheet was
   *  ordered that way). The importer batches these. */
  transactions: ParsedTransaction[];
  /** Distinct accounts referenced by the file (deduped on "Ledger: Account"). */
  coa: ParsedCoaEntry[];
  /** Top-level parse errors that aren't tied to a specific transaction
   *  (missing columns, no data rows, etc.). */
  fatalErrors: string[];
  /** Per-row warnings — kept separately from fatal errors so the importer
   *  can still proceed if the user is happy ignoring them. */
  warnings: string[];
  /** Quick stats for the preview screen. */
  summary: {
    rows: number;
    transactions: number;
    byType: Record<string, number>;
    /** ISO date range. Empty strings when no parseable dates were found. */
    dateRange: { from: string; to: string };
    /** Count of transactions whose Dr ≠ Cr. */
    unbalanced: number;
    /** Count of distinct (ledger, account) pairs found in the file. */
    coaAccounts: number;
  };
}

// ── Type-remap rules ─────────────────────────────────────────────────────────

const PASSTHROUGH_TYPES: ReadonlySet<TransactionType> = new Set([
  'PAY','CHQ','REC','SIN','SCR','PIN','PCR','JRN','TRF','RJN','WOF','WBK','YET','DVT',
]);
const REMAP_TO_PAY = new Set(['PCV','CCV']);
const REMAP_TO_JRN = new Set(['VAT','PGS','CRV']);
/** CTX is direction-sensitive — decided per-transaction by inspecting which
 *  side of the cash account moves. Handled in code, not via a Set. */

// Ledger-name → default account_type. Picked from the SMITH Ltd COA seed so
// the importer can auto-create missing accounts without asking the user for
// every single one.
const LEDGER_DEFAULT_TYPE: Record<string, ParsedCoaEntry['inferredAccountType']> = {
  Income: 'income',
  'Cost of sales': 'expense',
  Expenses: 'expense',
  Taxation: 'expense',
  'FA - intangible': 'asset',
  'FA - land and buildings': 'asset',
  'FA - plant and machinery': 'asset',
  'FA - equipment, fixtures & fittings': 'asset',
  'FA - vehicles': 'asset',
  'Investments - fixed': 'asset',
  'Investments - current': 'asset',
  Stocks: 'asset',
  Customers: 'asset',
  Debtors: 'asset',
  Bank: 'asset',
  Suppliers: 'liability',
  Creditors: 'liability',
  'Deferred tax': 'liability',
  'Share capital': 'equity',
  'Share premium': 'equity',
  'Revaluation reserve': 'equity',
  'Profit and loss account': 'equity',
};

function inferAccountType(ledger: string): ParsedCoaEntry['inferredAccountType'] {
  if (ledger in LEDGER_DEFAULT_TYPE) return LEDGER_DEFAULT_TYPE[ledger];
  // Reasonable fallbacks for any custom ledger the user has in VT.
  const lc = ledger.toLowerCase();
  if (lc.startsWith('fa ') || lc.startsWith('investment')) return 'asset';
  if (lc.includes('income') || lc.includes('sales') || lc.includes('revenue')) return 'income';
  if (lc.includes('expense') || lc.includes('cost')) return 'expense';
  if (lc.includes('creditor') || lc.includes('supplier') || lc.includes('payable') || lc.includes('tax')) return 'liability';
  if (lc.includes('share') || lc.includes('reserve') || lc.includes('equity')) return 'equity';
  return 'expense'; // safest catch-all — user can override in the mapping UI
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Excel-serial-date → ISO yyyy-mm-dd. Uses the 1900-based (non-Mac) calendar
 *  which is what VT/Windows Excel produces. xlsx exposes a helper but we
 *  implement it inline to keep the parser self-contained and avoid timezone
 *  surprises. */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // Excel's day 0 is 1899-12-30 (accounting for the 1900-leap-year bug).
  const ms = Math.round(serial * 86400000);
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Strip leading/trailing whitespace and convert empty → null. */
function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Parse "TYPE SEQ" into { type, seq }. Tolerant of extra whitespace. */
function parseRef(ref: string): { type: string; seq: number } | null {
  const m = ref.trim().match(/^([A-Z]{3})\s+0*(\d+)$/);
  if (!m) return null;
  return { type: m[1], seq: parseInt(m[2], 10) };
}

/** Format a SMITH ref string from type + numeric seq (zero-padded to 6). */
function formatRef(type: string, seq: number): string {
  return `${type} ${String(seq).padStart(6, '0')}`;
}

/** Split "Ledger: Account name" → { ledger, accountName }. Accounts without
 *  a colon are treated as ledgerless (rare — VT always prefixes). */
function splitLedgerAccount(display: string): { ledger: string; accountName: string } {
  const idx = display.indexOf(':');
  if (idx < 0) return { ledger: '', accountName: display.trim() };
  return {
    ledger:      display.slice(0, idx).trim(),
    accountName: display.slice(idx + 1).trim(),
  };
}

/** Is this row "blank" in the parser's sense? (Nothing in cols A-H that
 *  matters.) Empty xlsx rows arrive as totally empty arrays, so any presence
 *  of a string in any cell counts as non-blank. */
function isBlankRow(row: unknown[]): boolean {
  return row.every(c => c === null || c === undefined || String(c).trim() === '');
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function parseVtTransactionReport(buffer: ArrayBuffer | Buffer): ParseResult {
  const fatalErrors: string[] = [];
  const warnings: string[] = [];
  const result: ParseResult = {
    transactions: [],
    coa: [],
    fatalErrors,
    warnings,
    summary: {
      rows: 0,
      transactions: 0,
      byType: {},
      dateRange: { from: '', to: '' },
      unbalanced: 0,
      coaAccounts: 0,
    },
  };

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  } catch (e) {
    fatalErrors.push(`Couldn't read the spreadsheet: ${e instanceof Error ? e.message : 'unknown error'}`);
    return result;
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) { fatalErrors.push('The workbook has no sheets.'); return result; }
  const sheet = wb.Sheets[sheetName];
  // header:1 returns arrays of cell values (typed) per row. We use defval:''
  // so missing cells come back as '' rather than holes — easier to index.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  if (rows.length < 2) { fatalErrors.push('No data rows in the spreadsheet.'); return result; }

  result.summary.rows = rows.length;

  // We allow the header row to be the first non-blank row — VT exports
  // sometimes have title/blank rows above the column headers.
  let headerIdx = 0;
  while (headerIdx < rows.length && isBlankRow(rows[headerIdx])) headerIdx++;
  // Sanity check: row should have at least 8 columns and start with "Date".
  const headerRow = rows[headerIdx] ?? [];
  const headerStartsWithDate = String(headerRow[0] ?? '').trim().toLowerCase() === 'date';
  if (!headerStartsWithDate) {
    warnings.push(`Header row doesn't start with "Date" — proceeding anyway, but check the columns line up.`);
  }

  // ── Group rows into transactions ───────────────────────────────────────────
  //
  // Algorithm:
  //   1. Iterate rows after the header.
  //   2. A row that contains a date (col A is a number) AND a ref (col B has
  //      something) starts/continues a transaction. We accumulate splits for
  //      that ref until we hit a row whose ref differs or no ref at all.
  //   3. A row with no date but text in col A is a NOTE row attached to the
  //      most recent transaction. We buffer those.
  //   4. A fully blank row separates groups. While inside a "notes" buffer we
  //      treat single blank rows as paragraph breaks — only when we see a
  //      blank-then-non-note do we close the notes off.
  //
  // The output is a strict list of ParsedTransaction objects in source order.

  // Map of accountDisplay → ParsedCoaEntry, deduped.
  const coaMap = new Map<string, ParsedCoaEntry>();

  // The transaction currently being built (or null if we're between txns).
  let current: ParsedTransaction | null = null;
  // Buffer of note paragraphs awaiting attachment to `current`. Stored as
  // an array of paragraphs (each = single string), joined with double-newline
  // on flush. We start a new paragraph when we encounter a blank row after
  // a note line.
  let noteParagraphs: string[] = [];
  let pendingBlankAfterNote = false;

  function flushNotesInto(txn: ParsedTransaction | null) {
    if (!txn) { noteParagraphs = []; pendingBlankAfterNote = false; return; }
    const joined = noteParagraphs.map(p => p.trim()).filter(Boolean).join('\n\n');
    if (joined.length > 0) {
      txn.notes = txn.notes ? `${txn.notes}\n\n${joined}` : joined;
    }
    noteParagraphs = [];
    pendingBlankAfterNote = false;
  }

  function closeCurrent() {
    if (!current) return;
    // Validate balance — Dr should equal Cr.
    const totalDr = current.splits.reduce((s, x) => s + x.debit, 0);
    const totalCr = current.splits.reduce((s, x) => s + x.credit, 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
      current.errors.push(`Out of balance: Dr ${totalDr.toFixed(2)} vs Cr ${totalCr.toFixed(2)}`);
      result.summary.unbalanced++;
    }
    // CTX direction resolution — happens here once all splits are known.
    if (current.type === ('CTX' as TransactionType)) {
      const isReceipt = current.splits.some(s => /(^|:\s*)(bank|cash)/i.test(s.ledger) && s.debit > 0);
      const remapTo: TransactionType = isReceipt ? 'REC' : 'PAY';
      current.originalRefIfRemapped = current.refNo;
      current.type = remapTo;
      // refSeq stays VT's number for now — the route handler will allocate a
      // fresh seq from SMITH's counter for the destination type and rewrite
      // refNo accordingly. We retain the VT ref in originalRefIfRemapped.
    }
    flushNotesInto(current);
    result.transactions.push(current);
    result.summary.byType[current.type] = (result.summary.byType[current.type] ?? 0) + 1;
    current = null;
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const sourceRow = i + 1; // 1-based for user-facing errors
    const a = row[0];
    const b = cleanText(row[1]);
    const d = cleanText(row[3]);
    const e = cleanText(row[4]);
    const f = cleanText(row[5]);
    const g = typeof row[6] === 'number' ? row[6] as number : parseFloat(String(row[6] ?? '')) || 0;
    const h = typeof row[7] === 'number' ? row[7] as number : parseFloat(String(row[7] ?? '')) || 0;

    const aIsDate = typeof a === 'number' && a > 0;
    const aIsText = !aIsDate && cleanText(a) !== null;

    if (isBlankRow(row)) {
      // Blank row: if we're collecting notes, mark a pending paragraph
      // break — don't close the txn yet (notes might continue below). If
      // we're not collecting notes, close the current txn.
      if (noteParagraphs.length > 0) {
        pendingBlankAfterNote = true;
      } else {
        closeCurrent();
      }
      continue;
    }

    // Note row — col A has text, B/D are empty.
    if (aIsText && !b && !d) {
      if (pendingBlankAfterNote) {
        noteParagraphs.push(''); // start a new paragraph
        pendingBlankAfterNote = false;
      }
      if (noteParagraphs.length === 0) noteParagraphs.push('');
      const last = noteParagraphs.length - 1;
      noteParagraphs[last] = (noteParagraphs[last] ? noteParagraphs[last] + ' ' : '') + cleanText(a)!;
      continue;
    }

    // A split row needs both a date and a ref. Anything else is malformed.
    if (!aIsDate || !b) {
      warnings.push(`Row ${sourceRow}: skipped — couldn't recognise as split or note.`);
      continue;
    }

    // If we were buffering notes and now hit a split row, the notes attach
    // to whatever current was (the previous txn), then we start fresh.
    if (noteParagraphs.length > 0) flushNotesInto(current);

    const dateIso = excelSerialToIso(a as number);
    if (!dateIso) {
      warnings.push(`Row ${sourceRow}: invalid date "${a}".`);
      continue;
    }

    const parsedRef = parseRef(b);
    if (!parsedRef) {
      warnings.push(`Row ${sourceRow}: unrecognised reference "${b}" — skipped.`);
      continue;
    }

    // Apply type remapping. CTX is decided on closeCurrent() once we see
    // every split.
    let finalType: TransactionType;
    let originalRefIfRemapped: string | null = null;
    const upper = parsedRef.type;
    if (PASSTHROUGH_TYPES.has(upper as TransactionType)) {
      finalType = upper as TransactionType;
    } else if (REMAP_TO_PAY.has(upper)) {
      finalType = 'PAY';
      originalRefIfRemapped = formatRef(upper, parsedRef.seq);
    } else if (REMAP_TO_JRN.has(upper)) {
      finalType = 'JRN';
      originalRefIfRemapped = formatRef(upper, parsedRef.seq);
    } else if (upper === 'CTX') {
      finalType = 'CTX' as TransactionType; // resolved on closeCurrent()
      originalRefIfRemapped = formatRef(upper, parsedRef.seq);
    } else {
      // Unknown type — bail this transaction with an error.
      warnings.push(`Row ${sourceRow}: unknown VT type "${upper}" — skipped.`);
      continue;
    }

    // Start or continue a transaction by ref.
    if (!current || current.originalRef !== b) {
      if (current) closeCurrent();
      current = {
        originalRef: b,
        type: finalType,
        refSeq: parsedRef.seq,
        refNo: PASSTHROUGH_TYPES.has(finalType) ? formatRef(finalType, parsedRef.seq) : '', // remapped get reallocated on POST
        originalRefIfRemapped,
        date: dateIso,
        details: e,
        notes: null,
        splits: [],
        errors: [],
        sourceRowStart: sourceRow,
      };
    } else if (current.date !== dateIso) {
      // Same ref but different date — unlikely in practice; flag it but
      // accept the first date we saw.
      warnings.push(`Row ${sourceRow}: ref ${b} appears with two different dates; using ${current.date}.`);
    }

    if (!d) {
      current.errors.push(`Row ${sourceRow}: split has no account — skipped.`);
      continue;
    }

    const { ledger, accountName } = splitLedgerAccount(d);
    if (!ledger || !accountName) {
      current.errors.push(`Row ${sourceRow}: account "${d}" isn't in "Ledger: Account" form.`);
    }
    // Track the account in the COA dedupe map.
    if (!coaMap.has(d)) {
      coaMap.set(d, {
        display: d,
        ledger,
        accountName,
        inferredAccountType: inferAccountType(ledger),
      });
    }

    current.splits.push({
      accountDisplay: d,
      ledger,
      accountName,
      entryDetails: e && e !== current.details ? e : null,
      debit:  g > 0 ? g : 0,
      credit: h > 0 ? h : 0,
      marker: f,
      sourceRow,
    });
  }

  // End of sheet — flush whatever's open.
  closeCurrent();

  // ── Finalise summary ─────────────────────────────────────────────────────
  result.summary.transactions = result.transactions.length;
  result.coa = [...coaMap.values()].sort((a, b) =>
    a.ledger.localeCompare(b.ledger) || a.accountName.localeCompare(b.accountName));
  result.summary.coaAccounts = result.coa.length;
  if (result.transactions.length > 0) {
    const dates = result.transactions.map(t => t.date).sort();
    result.summary.dateRange = { from: dates[0], to: dates[dates.length - 1] };
  }
  return result;
}
