import * as XLSX from 'xlsx';
import type { LandlordIncomeTransaction, LandlordExpenseTransaction, LandlordAdjustment, LandlordProperty } from '@/types';
import { computePersonBreakdown } from './landlordAllocation';
import { computeRentComputation, type LandlordEntityType } from './landlordComputation';

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

function buildCompRows(data: CompData, entityType: LandlordEntityType): Row[] {
  const c = computeRentComputation(data.income, data.expenses, data.adjustments, { entityType });
  const rows: Row[] = [];

  // Income
  rows.push(['INCOME', '', '']);
  rows.push(['Total rents and other income from property', '', c.incomeTotal]);
  for (const a of c.incomeAdjustments) rows.push([a.description, '', a.amount]);
  rows.push(['TOTAL INCOME', '', c.totalIncome]);
  rows.push([]);

  // Expenses (finance costs excluded here when the individual restriction applies)
  rows.push(['EXPENSES', '', '']);
  for (const e of c.expenseCategories) rows.push([e.category, '', e.amount]);
  rows.push(['TOTAL EXPENSES', '', c.totalExpenses]);
  rows.push([]);

  // Net
  rows.push([c.netProfit >= 0 ? 'NET RENTAL PROFIT' : 'NET RENTAL LOSS', '', Math.abs(c.netProfit)]);
  if (c.netProfit < 0) rows.push(['(carried forward as a loss)', '', '']);

  // Finance costs & basic-rate relief (individuals only)
  if (c.restricted && c.financeCosts > 0) {
    rows.push([]);
    rows.push(['FINANCE COSTS (not deducted above)', '', '']);
    rows.push(['Residential finance costs', '', c.financeCosts]);
    rows.push(['Basic-rate tax reduction (20%, estimate)', '', c.financeReducer]);
    if (c.unrelievedFinanceCosts > 0.001) rows.push(['Unrelieved finance costs carried forward', '', c.unrelievedFinanceCosts]);
    rows.push(['Note: for individuals, residential finance costs are relieved as a 20% tax reducer (capped at 20% of property profits), not deducted from profit.', '', '']);
  }

  return rows;
}

// ─── All Rent Computation ─────────────────────────────────────────────────────

function buildRentCompSheet(data: CompData, meta: ReportMeta, entityType: LandlordEntityType): XLSX.WorkSheet {
  const rows: Row[] = [
    ...reportHeader('Rent Computation', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    ...buildCompRows(data, entityType),
  ];
  return makeSheet(rows);
}

// ─── Rent Computation by Property ─────────────────────────────────────────────

function buildRentCompByPropertySheet(data: CompData, meta: ReportMeta, entityType: LandlordEntityType): XLSX.WorkSheet {
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
    rows.push(...buildCompRows({ income: propIncome, expenses: propExpenses, adjustments: propAdj }, entityType));
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

// ─── By Person ─────────────────────────────────────────────────────────────────

function buildPersonSheet(
  income: IncomeExportRow[],
  expenses: ExpenseExportRow[],
  adjustments: LandlordAdjustment[],
  properties: LandlordProperty[],
  primary: { id: string | null; name: string },
  meta: ReportMeta,
): XLSX.WorkSheet {
  const incAmounts = [
    ...income.map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount })),
    ...adjustments.filter(a => a.type === 'income').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount })),
  ];
  const expAmounts = [
    ...expenses.map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount })),
    ...adjustments.filter(a => a.type === 'expense').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount })),
  ];
  const bd = computePersonBreakdown(incAmounts, expAmounts, properties, primary);

  const rows: Row[] = [
    ...reportHeader('Income by Person', meta.clientName, meta.clientCode, meta.dateFrom, meta.dateTo),
    ['Person', 'Type', 'Income (£)', 'Expenses (£)', 'Net (£)'],
  ];
  for (const p of bd.people) {
    rows.push([p.name, p.clientId ? 'Client' : 'Named', p.income, p.expenses, p.income - p.expenses]);
  }
  if (bd.unaccountedShare.income > 0.001 || bd.unaccountedShare.expenses > 0.001) {
    rows.push(['Unaccounted share (owners < 100%)', '', bd.unaccountedShare.income, bd.unaccountedShare.expenses, bd.unaccountedShare.income - bd.unaccountedShare.expenses]);
  }
  if (bd.unallocated.income > 0.001 || bd.unallocated.expenses > 0.001) {
    rows.push(['Unallocated (no matching property)', '', bd.unallocated.income, bd.unallocated.expenses, bd.unallocated.income - bd.unallocated.expenses]);
  }
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

/** Transaction plus the optional "include despite out of range" override the UI sets. */
type IncomeExportRow = LandlordIncomeTransaction & { _forceInclude?: boolean };
type ExpenseExportRow = LandlordExpenseTransaction & { _forceInclude?: boolean };

export interface LandlordExportData {
  income: IncomeExportRow[];
  expenses: ExpenseExportRow[];
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
  /** Client's property register + owners — enables the "By Person" tab. */
  properties?: LandlordProperty[];
  primaryClientId?: string | null;
  primaryClientName?: string;
  /** Drives the finance-cost restriction in the rent computation. Default 'individual'. */
  entityType?: LandlordEntityType;
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
  // inflate the totals. A row the user explicitly included (_forceInclude)
  // counts as in-range even if its date falls outside the window.
  const incIn = (r: IncomeExportRow) => r._forceInclude === true || isInRange(r.Date, data.dateFrom, data.dateTo);
  const expIn = (r: ExpenseExportRow) => r._forceInclude === true || isInRange(r.DueDate, data.dateFrom, data.dateTo);
  const inRangeIncome   = data.income.filter(incIn);
  const outRangeIncome  = data.income.filter(r => !incIn(r));
  const inRangeExpenses = data.expenses.filter(expIn);
  const outRangeExpenses= data.expenses.filter(r => !expIn(r));

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
  const entityType: LandlordEntityType = data.entityType ?? 'individual';
  XLSX.utils.book_append_sheet(wb, buildRentCompSheet(compData, meta, entityType), 'Rent Computation');
  XLSX.utils.book_append_sheet(wb, buildRentCompByPropertySheet(compData, meta, entityType), 'Rent Comp by Property');
  if (data.properties && data.properties.length > 0) {
    const primary = { id: data.primaryClientId ?? null, name: data.primaryClientName ?? data.clientName ?? 'This client' };
    XLSX.utils.book_append_sheet(wb, buildPersonSheet(inRangeIncome, inRangeExpenses, data.adjustments, data.properties, primary, meta), 'By Person');
  }
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
