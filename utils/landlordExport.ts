import * as XLSX from 'xlsx';
import type { LandlordIncomeTransaction, LandlordExpenseTransaction, LandlordAdjustment } from '@/types';

type Row = (string | number)[];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAddr(addr: string): string {
  return (!addr || addr === 'No Address') ? 'Non Allocated' : addr;
}

/**
 * Whether an ISO (YYYY-MM-DD) date falls within the desired range.
 * Mirrors the isInRange logic used on the Landlord page so the export
 * and the on-screen results agree on what is in vs out of range.
 */
export function isInRange(date: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!date) return true;
  if (from && date < from) return false;
  if (to   && date > to)   return false;
  return true;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtAmt(n: number): string {
  return `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function blankRows(n = 1): Row[] {
  return Array.from({ length: n }, () => []);
}

function reportHeader(
  reportName: string,
  clientName: string,
  clientCode: string,
  dateFrom: string,
  dateTo: string,
): Row[] {
  const dateRange = dateFrom || dateTo
    ? `${dateFrom ? fmtDate(dateFrom) : 'All dates'} to ${dateTo ? fmtDate(dateTo) : 'present'}`
    : 'All dates';
  return [
    [`Report: ${reportName}`],
    [`Client: ${clientName || '—'}`],
    [`Client Code: ${clientCode || '—'}`],
    [`Date Range: ${dateRange}`],
    [],
  ];
}

function makeSheet(rows: Row[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Auto-width: measure each column
  const colWidths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length;
      colWidths[i] = Math.max(colWidths[i] ?? 8, Math.min(len + 2, 60));
    });
  }
  ws['!cols'] = colWidths.map(w => ({ wch: w }));
  return ws;
}

// ─── Sheet builders ───────────────────────────────────────────────────────────

function incomeHeaders(withLink = false): Row {
  const base: Row = ['Date', 'Property', 'Description', 'Category', 'Amount (£)'];
  return withLink ? [...base, 'Source'] : base;
}

function incomeRow(r: LandlordIncomeTransaction, withLink = false): Row {
  const base: Row = [fmtDate(r.Date), r.PropertyAddress, r.Description, r.Category, r.Amount];
  return withLink ? [...base, r.fileName] : base;
}

function expenseHeaders(withLink = false): Row {
  const base: Row = ['Date', 'Supplier', 'Description', 'Category', 'Amount (£)', 'Property', 'Tenant Payable', 'Capital Expense'];
  return withLink ? [...base, 'Source'] : base;
}

function expenseRow(r: LandlordExpenseTransaction, withLink = false): Row {
  const base: Row = [
    fmtDate(r.DueDate), r.Supplier, r.Description, r.Category,
    r.Amount, r.PropertyAddress,
    r.TenantPayable ? 'Yes' : 'No',
    r.CapitalExpense ? 'Yes' : 'No',
  ];
  return withLink ? [...base, r.fileName] : base;
}

/** After aoa_to_sheet, replace fileName values in the link column with "View" + hyperlink */
function applyDriveLinks(
  ws: XLSX.WorkSheet,
  rows: Row[],
  linkColIndex: number,
  driveLinks: Record<string, string>,
): void {
  rows.forEach((row, rowIdx) => {
    const fileName = row[linkColIndex];
    if (typeof fileName === 'string' && driveLinks[fileName]) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: linkColIndex });
      if (ws[cellRef]) {
        ws[cellRef].v = 'View';
        ws[cellRef].l = { Target: driveLinks[fileName], Tooltip: 'Open in Google Drive' };
      }
    }
  });
}

// ─── All Income ──────────────────────────────────────────────────────────────

function buildAllIncomeSheet(
  income: LandlordIncomeTransaction[],
  meta: ReportMeta,
  driveLinks: Record<string, string>,
): XLSX.WorkSheet {
  const hasLinks = Object.keys(driveLinks).length > 0;
  const rows: Row[] = [
    ...reportHeader('All Income', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    incomeHeaders(hasLinks),
    ...income.map(r => incomeRow(r, hasLinks)),
    [],
    ['', '', '', 'TOTAL', income.reduce((s, r) => s + r.Amount, 0)],
  ];
  const ws = makeSheet(rows);
  if (hasLinks) applyDriveLinks(ws, rows, 5, driveLinks);
  return ws;
}

// ─── Income by Property ───────────────────────────────────────────────────────

function buildIncomeByPropertySheet(
  income: LandlordIncomeTransaction[],
  meta: ReportMeta,
  driveLinks: Record<string, string>,
): XLSX.WorkSheet {
  const hasLinks = Object.keys(driveLinks).length > 0;
  const byProp = new Map<string, LandlordIncomeTransaction[]>();
  for (const r of income) {
    const key = normalizeAddr(r.PropertyAddress);
    if (!byProp.has(key)) byProp.set(key, []);
    byProp.get(key)!.push(r);
  }
  const orderedProps = [...byProp.keys()].sort((a, b) =>
    a === 'Non Allocated' ? 1 : b === 'Non Allocated' ? -1 : a.localeCompare(b)
  );

  const rows: Row[] = [
    ...reportHeader('Income by Property', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
  ];

  for (const prop of orderedProps) {
    const propRows = byProp.get(prop)!;
    rows.push([prop]);
    rows.push(incomeHeaders(hasLinks));
    propRows.forEach(r => rows.push(incomeRow(r, hasLinks)));
    rows.push(['', '', '', 'Subtotal', propRows.reduce((s, r) => s + r.Amount, 0)]);
    rows.push([]);
  }

  rows.push(['', '', '', 'TOTAL', income.reduce((s, r) => s + r.Amount, 0)]);
  const ws = makeSheet(rows);
  if (hasLinks) applyDriveLinks(ws, rows, 5, driveLinks);
  return ws;
}

// ─── All Expenses ─────────────────────────────────────────────────────────────

function buildAllExpensesSheet(
  expenses: LandlordExpenseTransaction[],
  meta: ReportMeta,
  driveLinks: Record<string, string>,
): XLSX.WorkSheet {
  const hasLinks = Object.keys(driveLinks).length > 0;
  const rows: Row[] = [
    ...reportHeader('All Expenses', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    expenseHeaders(hasLinks),
    ...expenses.map(r => expenseRow(r, hasLinks)),
    [],
    ['', '', '', 'TOTAL', expenses.reduce((s, r) => s + r.Amount, 0)],
  ];
  const ws = makeSheet(rows);
  if (hasLinks) applyDriveLinks(ws, rows, 8, driveLinks);
  return ws;
}

// ─── Expenses by Property ─────────────────────────────────────────────────────

function buildExpensesByPropertySheet(
  expenses: LandlordExpenseTransaction[],
  meta: ReportMeta,
  driveLinks: Record<string, string>,
): XLSX.WorkSheet {
  const hasLinks = Object.keys(driveLinks).length > 0;
  const byProp = new Map<string, LandlordExpenseTransaction[]>();
  for (const r of expenses) {
    const key = normalizeAddr(r.PropertyAddress);
    if (!byProp.has(key)) byProp.set(key, []);
    byProp.get(key)!.push(r);
  }
  const orderedProps = [...byProp.keys()].sort((a, b) =>
    a === 'Non Allocated' ? 1 : b === 'Non Allocated' ? -1 : a.localeCompare(b)
  );

  const rows: Row[] = [
    ...reportHeader('Expenses by Property', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
  ];

  for (const prop of orderedProps) {
    const propRows = byProp.get(prop)!;
    rows.push([prop]);
    rows.push(expenseHeaders(hasLinks));
    propRows.forEach(r => rows.push(expenseRow(r, hasLinks)));
    rows.push(['', '', '', 'Subtotal', propRows.reduce((s, r) => s + r.Amount, 0)]);
    rows.push([]);
  }

  rows.push(['', '', '', 'TOTAL', expenses.reduce((s, r) => s + r.Amount, 0)]);
  const ws = makeSheet(rows);
  if (hasLinks) applyDriveLinks(ws, rows, 8, driveLinks);
  return ws;
}

// ─── Rent Computation helpers ─────────────────────────────────────────────────

interface CompData {
  income: LandlordIncomeTransaction[];
  expenses: LandlordExpenseTransaction[];
  adjustments: LandlordAdjustment[];
}

function buildCompRows(data: CompData): Row[] {
  const rows: Row[] = [];

  // Income
  rows.push(['INCOME', '', '']);
  const incomeTotal = data.income.reduce((s, r) => s + r.Amount, 0);
  rows.push(['Total rents and other income from property', '', incomeTotal]);

  const incAdj = data.adjustments.filter(a => a.type === 'income');
  if (incAdj.length > 0) {
    incAdj.forEach(a => rows.push([a.description, '', a.amount]));
  }

  const incAdjTotal = incAdj.reduce((s, a) => s + a.amount, 0);
  const totalIncome = incomeTotal + incAdjTotal;
  rows.push(['TOTAL INCOME', '', totalIncome]);
  rows.push([]);

  // Expenses by category (merge regular expenses + expense adjustments into same buckets)
  rows.push(['EXPENSES', '', '']);
  const expAdj = data.adjustments.filter(a => a.type === 'expense');
  const byCat = new Map<string, number>();
  for (const r of data.expenses) {
    byCat.set(r.Category, (byCat.get(r.Category) ?? 0) + r.Amount);
  }
  for (const a of expAdj) {
    const cat = a.category || 'Other allowable property expenses';
    byCat.set(cat, (byCat.get(cat) ?? 0) + a.amount);
  }
  for (const [cat, amt] of byCat.entries()) {
    rows.push([cat, '', amt]);
  }

  const expensesTotal = data.expenses.reduce((s, r) => s + r.Amount, 0);
  const expAdjTotal = expAdj.reduce((s, a) => s + a.amount, 0);
  const totalExpenses = expensesTotal + expAdjTotal;
  rows.push(['TOTAL EXPENSES', '', totalExpenses]);
  rows.push([]);

  // Net
  const net = totalIncome - totalExpenses;
  rows.push([net >= 0 ? 'NET RENTAL PROFIT' : 'NET RENTAL LOSS', '', Math.abs(net)]);
  if (net < 0) rows.push(['(carried forward as a loss)', '', '']);

  return rows;
}

// ─── All Rent Computation ─────────────────────────────────────────────────────

function buildRentCompSheet(data: CompData, meta: ReportMeta): XLSX.WorkSheet {
  const rows: Row[] = [
    ...reportHeader('Rent Computation', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    ...buildCompRows(data),
  ];
  return makeSheet(rows);
}

// ─── Rent Computation by Property ─────────────────────────────────────────────

function buildRentCompByPropertySheet(data: CompData, meta: ReportMeta): XLSX.WorkSheet {
  const propSet = new Set([
    ...data.income.map(r => normalizeAddr(r.PropertyAddress)),
    ...data.expenses.map(r => normalizeAddr(r.PropertyAddress)),
    ...data.adjustments.map(a => a.propertyAddress || 'Non Allocated'),
  ]);
  const properties = [...propSet].sort((a, b) =>
    a === 'Non Allocated' ? 1 : b === 'Non Allocated' ? -1 : a.localeCompare(b)
  );

  const rows: Row[] = [
    ...reportHeader('Rent Comp by Property', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
  ];

  for (const prop of properties) {
    rows.push([prop]);
    const propIncome = data.income.filter(r => normalizeAddr(r.PropertyAddress) === prop);
    const propExpenses = data.expenses.filter(r => normalizeAddr(r.PropertyAddress) === prop);
    const propAdj = data.adjustments.filter(a => (a.propertyAddress || 'Non Allocated') === prop);
    rows.push(...buildCompRows({ income: propIncome, expenses: propExpenses, adjustments: propAdj }));
    rows.push([]);
  }

  return makeSheet(rows);
}

// ─── Flagged ──────────────────────────────────────────────────────────────────

function buildFlaggedSheet(
  flagged: Array<{ type: 'income' | 'expense'; date: string; description: string; amount: number; reason: string; fileName: string }>,
  meta: ReportMeta,
): XLSX.WorkSheet {
  const rows: Row[] = [
    ...reportHeader('Flagged Entries', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    ['Type', 'Date', 'Description', 'Amount (£)', 'Flag Reason', 'Source File'],
    ...flagged.map(r => [r.type === 'income' ? 'Income' : 'Expense', fmtDate(r.date), r.description, r.amount, r.reason, r.fileName]),
  ];
  return makeSheet(rows);
}

// ─── Out of Date Range ─────────────────────────────────────────────────────────

function buildOutOfRangeSheet(
  income: LandlordIncomeTransaction[],
  expenses: LandlordExpenseTransaction[],
  meta: ReportMeta,
  driveLinks: Record<string, string>,
): XLSX.WorkSheet {
  const hasLinks = Object.keys(driveLinks).length > 0;
  const header: Row = ['Type', 'Date', 'Supplier', 'Description', 'Category', 'Amount (£)', 'Property'];
  const rows: Row[] = [
    ...reportHeader('Out of Date Range', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    [`These ${income.length + expenses.length} item(s) fall outside the date range above and are excluded from the totals in the other tabs.`],
    [],
    hasLinks ? [...header, 'Source'] : header,
  ];

  for (const r of income) {
    const base: Row = ['Income', fmtDate(r.Date), '', r.Description, r.Category, r.Amount, r.PropertyAddress];
    rows.push(hasLinks ? [...base, r.fileName] : base);
  }
  for (const r of expenses) {
    const base: Row = ['Expense', fmtDate(r.DueDate), r.Supplier, r.Description, r.Category, r.Amount, r.PropertyAddress];
    rows.push(hasLinks ? [...base, r.fileName] : base);
  }

  const ws = makeSheet(rows);
  if (hasLinks) applyDriveLinks(ws, rows, 7, driveLinks);
  return ws;
}

// ─── Public export ────────────────────────────────────────────────────────────

interface ReportMeta {
  clientName: string;
  clientCode: string;
  dateFrom: string;
  dateTo: string;
}

export interface LandlordExportData {
  income: LandlordIncomeTransaction[];
  expenses: LandlordExpenseTransaction[];
  adjustments: LandlordAdjustment[];
  flaggedIncome: Array<{ date: string; description: string; amount: number; reason: string; fileName: string }>;
  flaggedExpenses: Array<{ date: string; description: string; amount: number; reason: string; fileName: string }>;
  clientName: string;
  clientCode: string;
  dateFrom: string;
  dateTo: string;
  filename?: string;
  /** fileName → Google Drive URL, used to add hyperlinks to source document columns */
  driveLinks?: Record<string, string>;
}

export function exportLandlordWorkbook(data: LandlordExportData): void {
  const meta: ReportMeta = {
    clientName: data.clientName,
    clientCode: data.clientCode,
    dateFrom: data.dateFrom,
    dateTo: data.dateTo,
  };

  // Split by date range — only in-range items belong in the data tabs and the
  // rent computation; out-of-range items are listed separately so they never
  // inflate the totals.
  const inRangeIncome   = data.income.filter(r => isInRange(r.Date, data.dateFrom, data.dateTo));
  const outRangeIncome  = data.income.filter(r => !isInRange(r.Date, data.dateFrom, data.dateTo));
  const inRangeExpenses = data.expenses.filter(r => isInRange(r.DueDate, data.dateFrom, data.dateTo));
  const outRangeExpenses= data.expenses.filter(r => !isInRange(r.DueDate, data.dateFrom, data.dateTo));

  const compData: CompData = {
    income: inRangeIncome,
    expenses: inRangeExpenses,
    adjustments: data.adjustments,
  };

  const flagged = [
    ...data.flaggedIncome.map(r => ({ ...r, type: 'income' as const })),
    ...data.flaggedExpenses.map(r => ({ ...r, type: 'expense' as const })),
  ];

  const driveLinks = data.driveLinks ?? {};
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildAllIncomeSheet(inRangeIncome, meta, driveLinks), 'All Income');
  XLSX.utils.book_append_sheet(wb, buildIncomeByPropertySheet(inRangeIncome, meta, driveLinks), 'Income by Property');
  XLSX.utils.book_append_sheet(wb, buildAllExpensesSheet(inRangeExpenses, meta, driveLinks), 'All Expenses');
  XLSX.utils.book_append_sheet(wb, buildExpensesByPropertySheet(inRangeExpenses, meta, driveLinks), 'Expenses by Property');
  XLSX.utils.book_append_sheet(wb, buildRentCompSheet(compData, meta), 'Rent Computation');
  XLSX.utils.book_append_sheet(wb, buildRentCompByPropertySheet(compData, meta), 'Rent Comp by Property');
  if (outRangeIncome.length > 0 || outRangeExpenses.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildOutOfRangeSheet(outRangeIncome, outRangeExpenses, meta, driveLinks), 'Out of Date Range');
  }
  if (flagged.length > 0) {
    XLSX.utils.book_append_sheet(wb, buildFlaggedSheet(flagged, meta), 'Flagged');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = data.filename || `landlord_analysis_${dateStr}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// Re-export fmtAmt for use in the page
export { fmtAmt };
