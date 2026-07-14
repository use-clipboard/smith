'use client';

// Convert a CSV / TSV / Excel file into plain CSV text so it can be sent to
// Claude as a text block (the AI can't read an .xlsx binary or a non-image
// media type). Excel is parsed with SheetJS (already a dependency, loaded
// dynamically to keep it out of the main bundle); CSV/TSV/text is read as-is.

/** True for files we convert to text rather than send as a PDF/image. */
export function isSpreadsheetFile(file: File): boolean {
  return /\.(csv|tsv|xls|xlsx)$/i.test(file.name)
    || file.type.includes('csv')
    || file.type.includes('sheet')
    || file.type.includes('excel')
    || file.type === 'text/tab-separated-values';
}

/** Read a spreadsheet/CSV file as CSV text (all sheets, labelled when >1). */
export async function spreadsheetToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  // Plain-text formats — read directly.
  if (/\.(csv|tsv|txt)$/.test(name) || file.type.includes('csv') || file.type === 'text/plain' || file.type === 'text/tab-separated-values') {
    return (await file.text()).trim();
  }

  // Excel — parse each sheet to CSV.
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]).trim();
    if (csv) parts.push(wb.SheetNames.length > 1 ? `# Sheet: ${sheetName}\n${csv}` : csv);
  }
  return parts.join('\n\n');
}
