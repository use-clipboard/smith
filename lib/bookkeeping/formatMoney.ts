/**
 * formatMoney — single source of truth for displaying GBP-style amounts
 * across the bookkeeping module.
 *
 * Standard format: thousands separators + 2 decimals, e.g.
 *   1234567.89  →  "1,234,567.89"
 *      1234.5   →  "1,234.50"
 *         0     →  "0.00"
 *      -123     →  "(123.00)"      (negatives use accountant parentheses)
 *
 * Use this in any JSX cell, popover, modal subtotal etc. — anywhere the
 * user reads a money value. Do NOT use it for values being sent BACK to
 * the API (Zod schemas expect bare numbers); pass the raw number there.
 *
 * Variants:
 *   • formatMoney(n)                       — "1,234.56"
 *   • formatMoney(-1234.56)                — "(1,234.56)"        accountant style
 *   • formatMoneyOrBlank(n)                — "1,234.56" or ""    (zero → empty)
 *   • formatMoneyOrDash(n)                 — "1,234.56" or "-"   (zero → dash, matches reports)
 *   • formatMoneyAbs(n)                    — "1,234.56"          ignores sign
 *
 * Implementation note: we always use 'en-GB' so the separators stay as
 * comma + dot regardless of the user's browser locale. Bookkeeping is
 * UK-only for the foreseeable future — different locales would also flip
 * the date format (dd-mm-yyyy is firm policy) so locking is intentional.
 */

const LOCALE = 'en-GB';
const FMT_OPTS = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** Core formatter — preserves the sign with a leading minus by default.
 *  Most call sites want the accountant-style parentheses variant though;
 *  use formatMoney() (default export) for that. */
export function formatMoneySigned(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString(LOCALE, FMT_OPTS);
}

/** Default — accountant-style: negatives in parentheses, no minus sign.
 *  Mirrors what the on-screen Trial Balance, P&L, BS, ledger view, etc.
 *  all do already; this just makes it consistent everywhere. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) < 0.005) return '0.00';
  const abs = Math.abs(n).toLocaleString(LOCALE, FMT_OPTS);
  return n < 0 ? `(${abs})` : abs;
}

/** Absolute-value version — used by Dr/Cr columns where the side
 *  conveys the sign and we don't want it duplicated as parentheses. */
export function formatMoneyAbs(n: number): string {
  if (!Number.isFinite(n)) return '';
  return Math.abs(n).toLocaleString(LOCALE, FMT_OPTS);
}

/** Empty string for zero — handy in tables where you don't want a "0.00"
 *  cluttering up rows that didn't move. */
export function formatMoneyOrBlank(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '';
  return formatMoneyAbs(n);
}

/** Dash for zero — the accountant convention used in the formal reports
 *  (P&L, BS) so empty cells read as "no movement" rather than "we
 *  forgot to fill this in". */
export function formatMoneyOrDash(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '-';
  return formatMoney(n);
}
