/**
 * Tiny CSV export helper for the bookkeeping reports.
 *
 * The CSV format is the same shape each report renders on screen — section
 * headers and sub-totals included — so a user opening the file in Excel
 * sees what they expected from the on-screen view. We deliberately don't
 * try to produce the VT-PDF look in a spreadsheet (that's what the Print
 * button is for); CSV is for re-using the numbers in another tool.
 *
 * Each row is an array of strings. The util quotes/escapes properly so
 * commas and quotes in account names don't break the CSV.
 */

export type CsvRow = (string | number | null | undefined)[];

/** Quote a single cell if it contains a comma, quote, or newline. Inner
 *  quotes are doubled per RFC 4180. Numbers stringify naturally. */
function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : v;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Convert rows → a single CSV string. */
export function rowsToCsv(rows: CsvRow[]): string {
  return rows.map(r => r.map(escapeCell).join(',')).join('\r\n');
}

/** Trigger a download of `csv` in the user's browser. Uses Blob + a
 *  short-lived anchor click, then revokes the object URL. */
export function downloadCsv(filename: string, csv: string): void {
  // Excel sniffs UTF-8 only if it sees a BOM at the start. Prefixing avoids
  // mojibake on accounts with £ signs / accented characters when the user
  // opens the file via double-click rather than the "Import" wizard.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob URL on the next tick — most browsers fire the download
  // synchronously but Safari is finickity.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** Convenience: rows → file in one call. */
export function exportRowsAsCsv(filename: string, rows: CsvRow[]): void {
  downloadCsv(filename, rowsToCsv(rows));
}
