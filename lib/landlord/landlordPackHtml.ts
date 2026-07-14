// Landlord Analysis — build a client-ready Property Income Computation PDF pack
// as HTML, matching the Accounts Studio pack house style (cover + contents with
// live page numbers, then one section per page). Consumed by generatePdfBlob()
// (utils/pdfFromHtml) via its HTML-string path with { hardPageBreaks: true,
// pageNumbers: true }. Inline styles only; keep-together blocks use `.paper`,
// each section is `.paper.force-page-start` + a `data-toc` key that the contents
// page references via `data-toc-fill`.

import type { LandlordIncomeTransaction, LandlordExpenseTransaction, LandlordAdjustment, LandlordProperty } from '@/types';
import { computeRentComputation, type LandlordEntityType, type RentComputation } from '@/utils/landlordComputation';
import { computePersonBreakdown } from '@/utils/landlordAllocation';

export interface LandlordPackData {
  clientName: string;
  clientCode: string;
  dateFrom: string;   // ISO yyyy-mm-dd (may be '')
  dateTo: string;     // ISO yyyy-mm-dd (may be '')
  firmName: string | null;
  logoUrl: string | null;
  income: LandlordIncomeTransaction[];     // in-range, non-flagged
  expenses: LandlordExpenseTransaction[];  // in-range, non-flagged
  adjustments: LandlordAdjustment[];
  properties: LandlordProperty[];
  primaryClientId: string | null;
  primaryClientName: string;
  entityType: LandlordEntityType;
  useAllowance: boolean;
  broughtForwardLoss: number;
  notes: string;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function money(n: number | null): string {
  if (n === null || n === undefined) return '';
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v) < 0.005) return '—';
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return (y && m && d) ? `${d}-${m}-${y}` : iso;
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function normalizeAddr(a: string): string {
  return (!a || a === 'No Address') ? 'Non Allocated' : a;
}

// ── Style constants (mirror the Accounts Studio pack) ────────────────────────

const H_COMPANY = 'font-size:13px;font-weight:700;color:#0f172a;margin:0;text-align:center';
const H_TITLE = 'font-size:17px;font-weight:700;color:#0f172a;margin:6px 0 2px;text-align:center';
const H_PERIOD = 'font-size:11.5px;color:#64748b;margin:0 0 4px;text-align:center';
const AMT = 'text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding:3px 0 3px 18px;';
const LBL = 'padding:3px 0;';

function sectionHead(clientName: string, title: string, periodLine: string, sub?: string): string {
  return `
    ${sub ? `<p style="font-size:11px;color:#475569;margin:0 0 2px;text-align:center">${escapeHtml(sub)}</p>` : ''}
    <p style="${H_COMPANY}">${escapeHtml(clientName)}</p>
    <h2 style="${H_TITLE}">${escapeHtml(title)}</h2>
    <p style="${H_PERIOD}">${escapeHtml(periodLine)}</p>
    <div style="border-bottom:1px solid #e2e8f0;margin:0 0 16px"></div>`;
}

interface Part { key: string; label: string; html: string }
function section(key: string, label: string, inner: string): Part {
  return { key, label, html: `<div class="paper force-page-start" data-toc="${key}" style="margin-bottom:0">${inner}</div>` };
}

function amtRow(label: string, value: number | null, opts: { bold?: boolean; rule?: boolean; muted?: boolean; indent?: boolean } = {}): string {
  const weight = opts.bold ? 'font-weight:700;' : '';
  const colour = opts.muted ? 'color:#64748b;' : opts.bold ? 'color:#0f172a;' : 'color:#334155;';
  const borderTop = opts.rule ? 'border-top:1px solid #cbd5e1;' : '';
  const pad = opts.indent ? 'padding-left:16px;' : '';
  return `<tr style="${borderTop}">
    <td style="${LBL}${pad}${weight}${colour}">${escapeHtml(label)}</td>
    <td style="${AMT}${weight}${colour}">${money(value)}</td>
  </tr>`;
}

// ── Computation block (shared: whole-portfolio + per-property) ────────────────

function computationTable(c: RentComputation, showLosses: boolean): string {
  const rows: string[] = [];
  rows.push(amtRow('Total rents and other income from property', c.incomeTotal));
  for (const a of c.incomeAdjustments) rows.push(amtRow(a.description, a.amount, { indent: true, muted: true }));
  rows.push(amtRow('Total income', c.totalIncome, { bold: true, rule: true }));
  rows.push(`<tr><td colspan="2" style="padding-top:8px"></td></tr>`);
  for (const e of c.expenseCategories) rows.push(amtRow(e.category, e.amount));
  if (c.expenseCategories.length === 0) rows.push(amtRow('No expenses', 0, { muted: true }));
  rows.push(amtRow(c.allowanceUsed ? 'Total deduction' : 'Total expenses', c.totalExpenses, { bold: true, rule: true }));
  rows.push(`<tr><td colspan="2" style="padding-top:8px"></td></tr>`);
  rows.push(amtRow(c.netProfit >= 0 ? 'Net rental profit' : 'Net rental loss', c.netProfit, { bold: true, rule: true }));

  if (showLosses && (c.broughtForwardLoss > 0 || c.netProfit < 0)) {
    if (c.broughtForwardLoss > 0) rows.push(amtRow('Losses brought forward', c.broughtForwardLoss, { muted: true }));
    if (c.lossOffset > 0) rows.push(amtRow('Loss set against this year’s profit', -c.lossOffset, { muted: true }));
    if (c.netProfit >= 0) rows.push(amtRow('Taxable profit after losses', c.taxableProfit, { bold: true }));
    if (c.lossCarriedForward > 0) rows.push(amtRow('Losses carried forward', c.lossCarriedForward, { muted: true }));
  }

  let extra = '';
  if (c.restricted && !c.allowanceUsed && c.financeCosts > 0) {
    extra += `<p style="font-size:11.5px;font-weight:700;color:#b45309;margin:16px 0 4px">Finance costs (not deducted above)</p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        ${amtRow('Residential finance costs', c.financeCosts)}
        ${amtRow('Basic-rate tax reduction (20%, estimate)', c.financeReducer)}
        ${c.unrelievedFinanceCosts > 0.001 ? amtRow('Unrelieved finance costs carried forward', c.unrelievedFinanceCosts, { muted: true }) : ''}
      </table>
      <p style="font-size:10.5px;color:#94a3b8;margin:6px 0 0;line-height:1.5">For individuals, residential finance costs aren’t deducted from profit — they give a 20% tax reducer (capped at 20% of property profits). The final figure also depends on the client’s total income, so treat this as an estimate.</p>`;
  }
  if (c.capitalExpenses > 0) {
    extra += `<p style="font-size:11.5px;font-weight:700;color:#475569;margin:16px 0 4px">Capital items (not deducted)</p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        ${amtRow('Capital expenditure / improvements', c.capitalExpenses)}
      </table>
      <p style="font-size:10.5px;color:#94a3b8;margin:6px 0 0;line-height:1.5">Capital improvements aren’t deducted from rental profit — they add to the property’s base cost for CGT. Replacement of domestic items is an allowable expense.</p>`;
  }

  return `<table style="width:100%;border-collapse:collapse;font-size:12.5px">
    <thead><tr style="font-size:11px;color:#94a3b8"><th style="text-align:left"></th><th style="${AMT}">£</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>${extra}`;
}

// ── Schedules ────────────────────────────────────────────────────────────────

function incomeSchedule(income: LandlordIncomeTransaction[]): string {
  const th = 'text-align:left;font-size:11px;font-weight:700;color:#475569;padding:0 8px 4px 0;border-bottom:1px solid #cbd5e1';
  const td = 'font-size:11.5px;color:#334155;padding:3px 8px 3px 0;vertical-align:top';
  const rows = income.map(r => `<tr>
    <td style="${td};white-space:nowrap">${fmtDate(r.Date)}</td>
    <td style="${td}">${escapeHtml(r.PropertyAddress || 'Non Allocated')}</td>
    <td style="${td}">${escapeHtml(r.Description)}</td>
    <td style="${td}${AMT}">${money(r.Amount)}</td>
  </tr>`).join('');
  const total = income.reduce((s, r) => s + (r.Amount || 0), 0);
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr><th style="${th}">Date</th><th style="${th}">Property</th><th style="${th}">Description</th><th style="${th};text-align:right">Amount £</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" style="${td};color:#94a3b8">No income.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="3" style="${td};font-weight:700;border-top:1px solid #cbd5e1">Total</td><td style="${td}${AMT};font-weight:700;border-top:1px solid #cbd5e1">${money(total)}</td></tr></tfoot>
  </table>`;
}

function expenseSchedule(expenses: LandlordExpenseTransaction[]): string {
  const th = 'text-align:left;font-size:11px;font-weight:700;color:#475569;padding:0 8px 4px 0;border-bottom:1px solid #cbd5e1';
  const td = 'font-size:11.5px;color:#334155;padding:3px 8px 3px 0;vertical-align:top';
  const rows = expenses.map(r => `<tr>
    <td style="${td};white-space:nowrap">${fmtDate(r.DueDate)}</td>
    <td style="${td}">${escapeHtml(r.Supplier)}</td>
    <td style="${td}">${escapeHtml(r.Description)}</td>
    <td style="${td}">${escapeHtml(r.Category)}</td>
    <td style="${td}">${escapeHtml(r.PropertyAddress || 'Non Allocated')}</td>
    <td style="${td};text-align:center">${r.CapitalExpense ? 'Capital' : ''}</td>
    <td style="${td}${AMT}">${money(r.Amount)}</td>
  </tr>`).join('');
  const total = expenses.reduce((s, r) => s + (r.Amount || 0), 0);
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr><th style="${th}">Date</th><th style="${th}">Supplier</th><th style="${th}">Description</th><th style="${th}">Category</th><th style="${th}">Property</th><th style="${th}"></th><th style="${th};text-align:right">Amount £</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" style="${td};color:#94a3b8">No expenses.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="6" style="${td};font-weight:700;border-top:1px solid #cbd5e1">Total</td><td style="${td}${AMT};font-weight:700;border-top:1px solid #cbd5e1">${money(total)}</td></tr></tfoot>
  </table>`;
}

// ── Public builder ───────────────────────────────────────────────────────────

export function buildLandlordPackHtml(data: LandlordPackData): string {
  const opts = { entityType: data.entityType, useAllowance: data.useAllowance, broughtForwardLoss: data.broughtForwardLoss };
  const periodLine = (data.dateFrom || data.dateTo)
    ? `For the period ${data.dateFrom ? fmtDate(data.dateFrom) : 'the start'} to ${data.dateTo ? fmtDate(data.dateTo) : 'the end'}`
    : 'All dates';

  // Properties present in the data (ordered, Non Allocated last).
  const addrSet = new Set([
    ...data.income.map(r => normalizeAddr(r.PropertyAddress)),
    ...data.expenses.map(r => normalizeAddr(r.PropertyAddress)),
  ]);
  const propList = Array.from(addrSet).filter(a => a !== 'Non Allocated').sort((a, b) => a.localeCompare(b));
  if (addrSet.has('Non Allocated')) propList.push('Non Allocated');

  const parts: Part[] = [];

  // 1. Rent computation (whole portfolio)
  const cAll = computeRentComputation(data.income, data.expenses, data.adjustments, opts);
  parts.push(section('rent-comp', 'Property income computation',
    sectionHead(data.clientName, 'Property Income Computation', periodLine, data.entityType === 'company' ? 'Limited company' : 'Individual landlord') +
    computationTable(cAll, true)));

  // 2. By property
  if (propList.length > 1) {
    const blocks = propList.map(prop => {
      const pi = data.income.filter(r => normalizeAddr(r.PropertyAddress) === prop);
      const pe = data.expenses.filter(r => normalizeAddr(r.PropertyAddress) === prop);
      const pa = data.adjustments.filter(a => (a.propertyAddress || 'Non Allocated') === prop);
      const c = computeRentComputation(pi, pe, pa, { entityType: data.entityType });
      return `<div class="paper" style="margin-bottom:20px">
        <p style="font-size:13px;font-weight:700;color:#0f172a;margin:0 0 6px">${escapeHtml(prop)}</p>
        ${computationTable(c, false)}
      </div>`;
    }).join('');
    parts.push(section('rent-comp-property', 'Computation by property',
      sectionHead(data.clientName, 'Computation by Property', periodLine) + blocks));
  }

  // 3. By person (needs the register)
  if (data.properties.length > 0) {
    const inc = data.income.map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount }))
      .concat(data.adjustments.filter(a => a.type === 'income').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount })));
    const exp = data.expenses.filter(r => !r.CapitalExpense).map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount }))
      .concat(data.adjustments.filter(a => a.type === 'expense').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount })));
    const bd = computePersonBreakdown(inc, exp, data.properties, { id: data.primaryClientId, name: data.primaryClientName });
    const th = 'text-align:left;font-size:11px;font-weight:700;color:#475569;padding:0 8px 4px 0;border-bottom:1px solid #cbd5e1';
    const td = 'font-size:12px;color:#334155;padding:4px 8px 4px 0';
    const personRows = bd.people.map(p => `<tr>
      <td style="${td}">${escapeHtml(p.name)} <span style="font-size:10px;color:#94a3b8">${p.clientId ? '(client)' : '(named)'}</span></td>
      <td style="${td}${AMT}">${money(p.income)}</td>
      <td style="${td}${AMT}">${money(p.expenses)}</td>
      <td style="${td}${AMT};font-weight:700">${money(p.income - p.expenses)}</td>
    </tr>`).join('');
    const extraRows = [
      (bd.unaccountedShare.income > 0.001 || bd.unaccountedShare.expenses > 0.001)
        ? `<tr><td style="${td};color:#64748b;font-style:italic">Unaccounted share (owners &lt; 100%)</td><td style="${td}${AMT};color:#64748b">${money(bd.unaccountedShare.income)}</td><td style="${td}${AMT};color:#64748b">${money(bd.unaccountedShare.expenses)}</td><td style="${td}${AMT};color:#64748b">${money(bd.unaccountedShare.income - bd.unaccountedShare.expenses)}</td></tr>` : '',
      (bd.unallocated.income > 0.001 || bd.unallocated.expenses > 0.001)
        ? `<tr><td style="${td};color:#b45309;font-style:italic">Unallocated (no matching property)</td><td style="${td}${AMT};color:#b45309">${money(bd.unallocated.income)}</td><td style="${td}${AMT};color:#b45309">${money(bd.unallocated.expenses)}</td><td style="${td}${AMT};color:#b45309">${money(bd.unallocated.income - bd.unallocated.expenses)}</td></tr>` : '',
    ].join('');
    parts.push(section('by-person', 'Income by person',
      sectionHead(data.clientName, 'Income by Person', periodLine) +
      `<table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">Person</th><th style="${th};text-align:right">Income £</th><th style="${th};text-align:right">Expenses £</th><th style="${th};text-align:right">Net £</th></tr></thead>
        <tbody>${personRows || `<tr><td colspan="4" style="${td};color:#94a3b8">No allocated income or expenses.</td></tr>`}${extraRows}</tbody>
      </table>
      <p style="font-size:10.5px;color:#94a3b8;margin:8px 0 0;line-height:1.5">Each property’s income and expenses are shared out by ownership %. Client-linked owners feed the self-assessment computation.</p>`));
  }

  // 4. Income schedule
  parts.push(section('income-schedule', 'Income schedule',
    sectionHead(data.clientName, 'Income Schedule', periodLine) + incomeSchedule(data.income)));

  // 5. Expenses schedule
  parts.push(section('expense-schedule', 'Expenses schedule',
    sectionHead(data.clientName, 'Expenses Schedule', periodLine) + expenseSchedule(data.expenses)));

  // 6. Notes
  if (data.notes.trim()) {
    parts.push(section('notes', 'Notes',
      sectionHead(data.clientName, 'Notes', periodLine) +
      `<div style="font-size:12px;color:#334155;line-height:1.6;white-space:pre-wrap">${escapeHtml(data.notes)}</div>`));
  }

  // ── Cover ──
  const cover = `
    <div class="paper" style="min-height:1000px;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:0 48px">
      ${data.logoUrl ? `<img src="${data.logoUrl}" alt="" crossorigin="anonymous" style="max-height:64px;max-width:240px;object-fit:contain;margin:0 auto 30px" />` : ''}
      ${data.clientCode ? `<p style="font-size:12px;color:#64748b;margin:0 0 14px">Client Code: ${escapeHtml(data.clientCode)}</p>` : ''}
      <h1 style="font-size:30px;margin:0 0 16px;color:#0f172a">${escapeHtml(data.clientName || 'Property Income')}</h1>
      <p style="font-size:14px;color:#334155;margin:0 0 30px">Property Income Computation</p>
      <p style="font-size:12.5px;color:#334155;margin:0">${escapeHtml(periodLine)}</p>
      ${data.firmName ? `<p style="font-size:12px;color:#64748b;margin:30px 0 0">Prepared by ${escapeHtml(data.firmName)}</p>` : ''}
    </div>`;

  // ── Contents ──
  const contentsRows = parts.map(p => `<tr>
      <td style="padding:6px 0;font-size:12.5px;color:#0f172a">${escapeHtml(p.label)}</td>
      <td style="padding:6px 0;text-align:right;font-size:12.5px;color:#334155;width:48px" data-toc-fill="${p.key}"></td>
    </tr>`).join('');
  const contents = `
    <div class="paper force-page-start">
      ${sectionHead(data.clientName, 'Contents', periodLine)}
      <table style="width:100%;border-collapse:collapse">${contentsRows}</table>
    </div>`;

  const body = parts.map(p => p.html).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">${cover}${contents}${body}</div>`;
}
