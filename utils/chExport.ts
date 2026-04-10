import * as XLSX from 'xlsx';
import type { CHCompanyData } from '@/types/ch';
import { formatCHAddress } from '@/types/ch';

type Row = (string | number | boolean | null)[];

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function dueSuffix(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = daysUntil(dateStr);
  if (d === null) return '';
  if (d < 0) return ` (${Math.abs(d)}d overdue)`;
  if (d === 0) return ' (due today)';
  return ` (${d}d)`;
}

function autoColWidth(ws: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  const cols: { wch: number }[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let max = 8;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.v) max = Math.min(60, Math.max(max, String(cell.v).length + 2));
    }
    cols.push({ wch: max });
  }
  ws['!cols'] = cols;
}

// ─── Summary sheet ────────────────────────────────────────────────────────────

function buildSummarySheet(companies: CHCompanyData[]): XLSX.WorkSheet {
  const headers: Row = [
    'Company No.', 'Company Name', 'Status', 'Incorporated',
    'Accounts Due', 'Accounts OD?',
    'CS Due', 'CS OD?',
    'Officer IDV Due', 'Officers IDV OD',
    'PSC IDV Due', 'PSCs IDV OD',
    'Active Officers', 'Active PSCs',
  ];

  const rows: Row[] = companies.map(c => [
    c.companyNumber,
    c.companyName || c.error || '',
    c.status,
    c.incorporationDate,
    c.accountsNextDue ? `${c.accountsNextDue}${dueSuffix(c.accountsNextDue)}` : '',
    c.accountsOverdue ? 'YES' : 'No',
    c.csNextDue ? `${c.csNextDue}${dueSuffix(c.csNextDue)}` : '',
    c.csOverdue ? 'YES' : 'No',
    c.nearestOfficerIdvDue ? `${c.nearestOfficerIdvDue}${dueSuffix(c.nearestOfficerIdvDue)}` : 'N/A',
    c.officersIdvOverdueCount,
    c.nearestPscIdvDue ? `${c.nearestPscIdvDue}${dueSuffix(c.nearestPscIdvDue)}` : 'N/A',
    c.pscIdvOverdueCount,
    c.activeOfficerCount,
    c.activePscCount,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  autoColWidth(ws);
  return ws;
}

// ─── Officers sheet ───────────────────────────────────────────────────────────

function buildOfficersSheet(companies: CHCompanyData[]): XLSX.WorkSheet {
  const headers: Row = [
    'Company No.', 'Company Name',
    'Officer Name', 'Role', 'Appointed On', 'DOB (MM/YYYY)',
    'IDV Due', 'IDV Overdue?', 'Address',
  ];

  const rows: Row[] = companies.flatMap(c =>
    c.officers.map(o => [
      c.companyNumber,
      c.companyName,
      o.name,
      o.role,
      o.appointedOn,
      o.dateOfBirth ? `${String(o.dateOfBirth.month).padStart(2, '0')}/${o.dateOfBirth.year}` : '',
      o.idvDueDate ?? 'N/A',
      o.idvOverdue ? 'YES' : 'No',
      formatCHAddress(o.address),
    ])
  );

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  autoColWidth(ws);
  return ws;
}

// ─── PSCs sheet ───────────────────────────────────────────────────────────────

function buildPSCSheet(companies: CHCompanyData[]): XLSX.WorkSheet {
  const headers: Row = [
    'Company No.', 'Company Name',
    'PSC Name', 'Kind', 'Notified On', 'DOB (MM/YYYY)',
    'Nature of Control',
    'IDV Due', 'IDV Overdue?', 'Address',
  ];

  const rows: Row[] = companies.flatMap(c =>
    c.pscs.map(p => [
      c.companyNumber,
      c.companyName,
      p.name,
      p.kind,
      p.notifiedOn,
      p.dateOfBirth ? `${String(p.dateOfBirth.month).padStart(2, '0')}/${p.dateOfBirth.year}` : '',
      p.naturesOfControl.join('; '),
      p.idvDueDate ?? 'N/A',
      p.idvOverdue ? 'YES' : 'No',
      formatCHAddress(p.address),
    ])
  );

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  autoColWidth(ws);
  return ws;
}

// ─── Due Dates sheet ──────────────────────────────────────────────────────────

function buildDueDatesSheet(companies: CHCompanyData[]): XLSX.WorkSheet {
  const headers: Row = [
    'Company No.', 'Company Name', 'Item', 'Due Date', 'Days Until Due', 'Overdue?',
  ];

  const rows: Row[] = companies.flatMap(c => {
    const items: Row[] = [];
    if (c.accountsNextDue) {
      const d = daysUntil(c.accountsNextDue);
      items.push([c.companyNumber, c.companyName, 'Accounts', c.accountsNextDue, d, c.accountsOverdue ? 'YES' : 'No']);
    }
    if (c.csNextDue) {
      const d = daysUntil(c.csNextDue);
      items.push([c.companyNumber, c.companyName, 'Confirmation Statement', c.csNextDue, d, c.csOverdue ? 'YES' : 'No']);
    }
    c.officers.forEach(o => {
      if (o.idvDueDate) {
        const d = daysUntil(o.idvDueDate);
        items.push([c.companyNumber, c.companyName, `Officer IDV — ${o.name}`, o.idvDueDate, d, o.idvOverdue ? 'YES' : 'No']);
      }
    });
    c.pscs.forEach(p => {
      if (p.idvDueDate) {
        const d = daysUntil(p.idvDueDate);
        items.push([c.companyNumber, c.companyName, `PSC IDV — ${p.name}`, p.idvDueDate, d, p.idvOverdue ? 'YES' : 'No']);
      }
    });
    return items;
  });

  // Sort by due date ascending
  rows.sort((a, b) => String(a[3] ?? '').localeCompare(String(b[3] ?? '')));

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  autoColWidth(ws);
  return ws;
}

// ─── Public export ────────────────────────────────────────────────────────────

export function exportCHWorkbook(companies: CHCompanyData[], filename = 'ch_secretarial.xlsx') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(companies), 'Summary');
  XLSX.utils.book_append_sheet(wb, buildDueDatesSheet(companies), 'All Due Dates');
  XLSX.utils.book_append_sheet(wb, buildOfficersSheet(companies), 'Officers');
  XLSX.utils.book_append_sheet(wb, buildPSCSheet(companies), 'PSCs');
  XLSX.writeFile(wb, filename);
}
