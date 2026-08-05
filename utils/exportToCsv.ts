// Shared CSV export — used by every tool's history dashboard so "export to
// CSV / Sheets" behaves identically across the app.

export type CsvCell = string | number | null | undefined;

function csvEscape(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV blob from headers + rows and trigger a download. */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** `prefix_YYYY-MM-DD.csv` — the standard filename shape for a history export. */
export function csvFilename(prefix: string): string {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
}
