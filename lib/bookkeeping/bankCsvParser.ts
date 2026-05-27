/**
 * bankCsvParser — turns a UK bank statement CSV into normalised
 * { date, description, amount, statementBalance? } rows.
 *
 * Why this is a real piece of code (and not "just JSON.parse"):
 *   UK banks ship statement CSVs in ~5 layouts and any number of date
 *   formats. We have to handle:
 *     • Header row vs. no header row
 *     • Money in / Money out separate columns vs. signed Amount
 *     • Balance column on the right (or missing)
 *     • Dates as dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, "DD MMM YYYY"
 *     • Numbers with thousand separators ("1,234.56"), currency
 *       symbols ("£123.45"), trailing minus signs ("123.45-"),
 *       parentheses for negatives ("(123.45)").
 *
 *   Rather than expect the user to massage their CSV before upload,
 *   we sniff the header to find the columns, normalise the values
 *   per row, and reject anything we can't make sense of with a clear
 *   message the UI can surface.
 *
 * Signed convention used everywhere downstream:
 *   amount > 0  →  money INTO the bank account (debit to bank)
 *   amount < 0  →  money OUT of the bank account (credit to bank)
 *
 *   Two-column "Money in / Money out" layouts are folded to this
 *   single signed value at parse time so the rest of the rec code
 *   never has to special-case the layout.
 */

export interface ParsedBankLine {
  date: string;              // ISO YYYY-MM-DD
  description: string;
  amount: number;            // signed (see top of file)
  statementBalance: number | null;
}

export interface ParseResult {
  ok: true;
  lines: ParsedBankLine[];
  /** Diagnostic — which columns we ended up using. Helpful for the
   *  upload preview screen so the user can confirm before committing. */
  columns: {
    date: string;
    description: string;
    amountSigned: string | null;     // when a single signed column was used
    moneyIn: string | null;          // when separate in/out columns were used
    moneyOut: string | null;
    balance: string | null;
  };
  /** Every CSV column header in source order, surfaced so the UI can
   *  render a "column allocation" editor letting the user override
   *  auto-detection (e.g. when a bank uses non-standard headers like
   *  "Withdrawal" / "Deposit"). */
  headers: string[];
  /** Same role → column-index map as the auto-detector produced, after
   *  any user overrides have been applied. Lets the UI show the
   *  currently-selected option in each role dropdown. */
  columnMap: ColumnMap;
  /** Lines we skipped because they failed validation. Returned for the
   *  preview so the user knows what's been dropped (e.g. blank rows,
   *  rows with no date). */
  skipped: { lineNo: number; reason: string; raw: string }[];
}
export interface ParseError {
  ok: false;
  error: string;
  /** Surfaced even on failure so the UI can render the column allocator
   *  and let the user fix a bad auto-detect. */
  headers?: string[];
}

/** Per-role column index map. `null` means "no column assigned" for the
 *  optional roles; date is always required.  Exported so the UI can
 *  build a typed override for re-parse. */
export interface ColumnMap {
  date:         number;
  description:  number | null;
  amountSigned: number | null;
  moneyIn:      number | null;
  moneyOut:     number | null;
  balance:      number | null;
}

/** Override shape — every field optional. `undefined` means "auto-detect
 *  this role"; `null` means "explicitly leave unassigned" (the user
 *  picked '(none)' in the column allocator). */
export type ColumnOverrides = {
  [K in keyof ColumnMap]?: ColumnMap[K] | null;
};

// ── Public API ──────────────────────────────────────────────────────────────
export function parseBankCsv(
  input: string,
  options?: { columnOverrides?: ColumnOverrides },
): ParseResult | ParseError {
  const rows = splitCsv(input);
  if (rows.length < 2) return { ok: false, error: 'CSV looks empty — no rows to import.' };

  // Find the header row by looking for one that contains both a "date" and
  // a description-y / amount-y column. Banks sometimes prepend metadata
  // lines ("Account: 12345-6789", "Period: 1 Apr — 30 Apr") that we have
  // to skip past.
  //
  // When the user has supplied a manual `date` override we trust them
  // implicitly — use the first non-blank row as the header so we don't
  // accidentally reject a perfectly valid CSV whose headers just happen
  // to be unrecognisable to our keyword list.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (looksLikeHeader(rows[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1 && options?.columnOverrides?.date !== undefined) {
    headerIdx = rows.findIndex(r => r.some(c => c.trim().length > 0));
  }
  if (headerIdx === -1) {
    return {
      ok: false,
      error: 'Couldn’t find a header row with Date / Amount columns. Use the column allocator below to pick the columns manually.',
      headers: rows[0]?.map(c => c.trim()),
    };
  }

  const header = rows[headerIdx].map(c => c.trim());
  const cols = mapColumns(header, options?.columnOverrides);
  if (!cols) {
    return {
      ok: false,
      error: 'CSV needs at least a Date column and either an Amount column or both Money In and Money Out columns. Pick the columns manually below if auto-detection missed them.',
      headers: header,
    };
  }

  const lines: ParsedBankLine[] = [];
  const skipped: ParseResult['skipped'] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c.trim() === '')) continue; // blank row

    const rawJoin = r.join(',');
    const dateRaw = r[cols.date] ?? '';
    const date = parseDate(dateRaw);
    if (!date) {
      skipped.push({ lineNo: i + 1, reason: `Couldn’t parse date "${dateRaw}".`, raw: rawJoin });
      continue;
    }

    const description = (cols.description != null ? r[cols.description] : '') ?? '';

    let amount: number | null = null;
    if (cols.amountSigned != null) {
      amount = parseAmount(r[cols.amountSigned] ?? '');
    } else if (cols.moneyIn != null && cols.moneyOut != null) {
      const inAmt  = parseAmount(r[cols.moneyIn]  ?? '') ?? 0;
      const outAmt = parseAmount(r[cols.moneyOut] ?? '') ?? 0;
      // Money out columns are stored as positive in UK CSVs; we sign it
      // negative for our convention.
      amount = inAmt - outAmt;
      if (inAmt === 0 && outAmt === 0) amount = null; // both blank → skip
    }

    if (amount == null || !Number.isFinite(amount)) {
      skipped.push({ lineNo: i + 1, reason: 'Couldn’t parse an amount on this row.', raw: rawJoin });
      continue;
    }
    if (amount === 0) {
      skipped.push({ lineNo: i + 1, reason: 'Zero-amount line skipped.', raw: rawJoin });
      continue;
    }

    const balance = cols.balance != null ? parseAmount(r[cols.balance] ?? '') : null;

    lines.push({
      date,
      description: description.trim(),
      amount: round2(amount),
      statementBalance: balance != null && Number.isFinite(balance) ? round2(balance) : null,
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: 'No valid statement lines found in the CSV.' };
  }

  return {
    ok: true,
    lines,
    columns: {
      date: header[cols.date],
      description: cols.description != null ? header[cols.description] : '',
      amountSigned: cols.amountSigned != null ? header[cols.amountSigned] : null,
      moneyIn:  cols.moneyIn  != null ? header[cols.moneyIn]  : null,
      moneyOut: cols.moneyOut != null ? header[cols.moneyOut] : null,
      balance:  cols.balance  != null ? header[cols.balance]  : null,
    },
    headers: header,
    columnMap: cols,
    skipped,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Minimal RFC-4180-ish CSV split — supports quoted fields containing commas
 *  and escaped quotes (""). Doesn't try to be a fully general parser; banks
 *  ship simple files. */
function splitCsv(input: string): string[][] {
  // Normalise line endings, drop BOM if present.
  const clean = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  // Trailing field
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const DATE_KEYS        = ['date', 'transaction date', 'txn date', 'posting date', 'value date'];
const DESC_KEYS        = ['description', 'narrative', 'details', 'memo', 'reference', 'transaction', 'particulars', 'payee'];
const AMOUNT_KEYS      = ['amount', 'value', 'transaction amount'];
const MONEY_IN_KEYS    = ['money in', 'paid in', 'credit', 'credits', 'deposits', 'in', 'received'];
const MONEY_OUT_KEYS   = ['money out', 'paid out', 'debit', 'debits', 'withdrawals', 'out', 'spent'];
const BALANCE_KEYS     = ['balance', 'running balance', 'closing balance'];

function looksLikeHeader(row: string[]): boolean {
  const norm = row.map(c => c.trim().toLowerCase());
  const hasDate = norm.some(c => DATE_KEYS.includes(c));
  const hasAmount =
    norm.some(c => AMOUNT_KEYS.includes(c)) ||
    (norm.some(c => MONEY_IN_KEYS.includes(c)) && norm.some(c => MONEY_OUT_KEYS.includes(c)));
  return hasDate && hasAmount;
}

function mapColumns(header: string[], overrides?: ColumnOverrides): ColumnMap | null {
  const norm = header.map(c => c.trim().toLowerCase());
  const findFirst = (keys: string[]) => norm.findIndex(c => keys.includes(c));

  // Start with auto-detected values. -1 / null → "not found".
  const autoDate = findFirst(DATE_KEYS);
  let amountSigned: number | null = findFirst(AMOUNT_KEYS);
  if (amountSigned === -1) amountSigned = null;
  let moneyIn: number | null = findFirst(MONEY_IN_KEYS);
  if (moneyIn === -1) moneyIn = null;
  let moneyOut: number | null = findFirst(MONEY_OUT_KEYS);
  if (moneyOut === -1) moneyOut = null;

  // If we have both an Amount column AND Money In/Out — prefer the dedicated
  // columns since they're unambiguous (a positive "Amount" alone doesn't
  // tell us money in or out for some banks).
  if (moneyIn != null && moneyOut != null) amountSigned = null;

  let description: number | null = findFirst(DESC_KEYS);
  if (description === -1) description = null;
  let balance: number | null = findFirst(BALANCE_KEYS);
  if (balance === -1) balance = null;

  // Apply user overrides — null means "explicitly clear", undefined means
  // "keep auto-detect". The override-takes-precedence rule lets the user
  // recover from a misclassified header.
  const date = overrides?.date !== undefined ? overrides.date ?? -1 : autoDate;
  if (overrides?.description !== undefined) description = overrides.description;
  if (overrides?.amountSigned !== undefined) amountSigned = overrides.amountSigned;
  if (overrides?.moneyIn !== undefined)      moneyIn      = overrides.moneyIn;
  if (overrides?.moneyOut !== undefined)     moneyOut     = overrides.moneyOut;
  if (overrides?.balance !== undefined)      balance      = overrides.balance;

  // Validation — same rules as before. Date must be picked, and either a
  // signed Amount column OR both Money In + Money Out together.
  if (date === -1 || date == null) return null;
  if (amountSigned == null && (moneyIn == null || moneyOut == null)) return null;

  return { date, description, amountSigned, moneyIn, moneyOut, balance };
}

/** Accepts: 31/12/2025, 31-12-2025, 2025-12-31, 31 Dec 2025, 31/12/25.
 *  Always returns ISO yyyy-mm-dd or null. */
function parseDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // ISO already (yyyy-mm-dd or yyyy/mm/dd)
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  // dd/mm/yyyy or dd-mm-yyyy (UK)
  const uk = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(s);
  if (uk) {
    const day = uk[1].padStart(2, '0');
    const month = uk[2].padStart(2, '0');
    let year = uk[3];
    if (year.length === 2) {
      // Two-digit year — pivot at 50 (00-49 → 20xx, 50-99 → 19xx).
      const yn = parseInt(year, 10);
      year = (yn < 50 ? 2000 + yn : 1900 + yn).toString();
    }
    return `${year}-${month}-${day}`;
  }

  // "31 Dec 2025" or "31-Dec-2025"
  const named = /^(\d{1,2})[\s-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s-](\d{2}|\d{4})$/i.exec(s);
  if (named) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const day = named[1].padStart(2, '0');
    const month = String(months.indexOf(named[2].toLowerCase()) + 1).padStart(2, '0');
    let year = named[3];
    if (year.length === 2) {
      const yn = parseInt(year, 10);
      year = (yn < 50 ? 2000 + yn : 1900 + yn).toString();
    }
    return `${year}-${month}-${day}`;
  }

  return null;
}

/** Accepts "1,234.56", "£1,234.56", "(123.45)" (= -123.45), "123.45-",
 *  blank/whitespace (returns null). Returns number or null. */
function parseAmount(raw: string): number | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  // Strip currency symbols & thousands separators
  s = s.replace(/[£€$,]/g, '');
  // Trailing minus → leading minus
  if (/-$/.test(s)) s = '-' + s.slice(0, -1);
  // Parentheses → negative
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  s = s.trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
