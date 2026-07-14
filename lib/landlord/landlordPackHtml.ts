// Landlord Analysis — build a client-ready Property Income Computation PDF pack
// as HTML, matching the Accounts Studio pack house style (cover + contents with
// live page numbers, then one section per page). Consumed by generatePdfBlob()
// (utils/pdfFromHtml) via its HTML-string path with { hardPageBreaks: true,
// pageNumbers: true }. Inline styles only; keep-together blocks use `.paper`,
// each section is `.paper.force-page-start` + a `data-toc` key that the contents
// page references via `data-toc-fill`.

import type { LandlordIncomeTransaction, LandlordExpenseTransaction, LandlordAdjustment, LandlordProperty } from '@/types';
import { computeRentComputation, buildComparisonRows, type LandlordEntityType, type RentComputation } from '@/utils/landlordComputation';
import { computePersonBreakdown, computePersonMatrix, matrixCell } from '@/utils/landlordAllocation';

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
  comparison?: { current: RentComputation; prior: RentComputation; curLabel: string; priorLabel: string } | null;
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

// ── Landscape matrix pages (property × individual × category) ────────────────
// The full per-person working is too wide for portrait A4, so it's emitted as
// landscape pages, chunked BY COLUMN GROUP so a property's owners are never
// split and no column is ever cut. Every chunk repeats the row headers (the
// category column) and the column headers, so each page stands alone.

/** Data columns per landscape page — a whole property group is kept together. */
const MAX_MATRIX_COLS_PER_PAGE = 8;

interface MatrixGroup { id: string; label: string; cols: Array<{ key: string; name: string; pct: number | null }> }

export function buildLandlordMatrixPages(data: LandlordPackData): string[] {
  if (data.properties.length === 0) return [];

  const periodLine = (data.dateFrom || data.dateTo)
    ? `For the period ${data.dateFrom ? fmtDate(data.dateFrom) : 'the start'} to ${data.dateTo ? fmtDate(data.dateTo) : 'the end'}`
    : 'All dates';

  const inc = [
    ...data.income.map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount, Category: r.Category })),
    ...data.adjustments.filter(a => a.type === 'income').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount, Category: a.category || 'Total rents and other income from property' })),
  ];
  const exp = [
    ...data.expenses.filter(r => !r.CapitalExpense).map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount, Category: r.Category })),
    ...data.adjustments.filter(a => a.type === 'expense').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount, Category: a.category || 'Other allowable property expenses' })),
  ];
  const m = computePersonMatrix(inc, exp, data.properties, { id: data.primaryClientId, name: data.primaryClientName });
  if (m.properties.length === 0) return [];

  const groups: MatrixGroup[] = m.properties.map(p => ({
    id: p.id, label: p.address, cols: p.owners.map(o => ({ key: o.key, name: o.name, pct: o.pct })),
  }));
  if (m.people.length > 0) {
    groups.push({ id: '__total__', label: 'Total', cols: m.people.map(p => ({ key: p.key, name: p.name, pct: null })) });
  }

  const chunks: MatrixGroup[][] = [];
  let cur: MatrixGroup[] = [];
  let n = 0;
  for (const g of groups) {
    if (n > 0 && n + g.cols.length > MAX_MATRIX_COLS_PER_PAGE) { chunks.push(cur); cur = []; n = 0; }
    cur.push(g); n += g.cols.length;
  }
  if (cur.length) chunks.push(cur);

  const value = (groupId: string, key: string, cat: string): number =>
    groupId === '__total__'
      ? m.properties.reduce((s, p) => s + matrixCell(m, p.id, key, cat), 0)
      : matrixCell(m, groupId, key, cat);
  const sumCats = (groupId: string, key: string, cats: string[]) => cats.reduce((s, c) => s + value(groupId, key, c), 0);

  const TH  = 'font-size:10px;font-weight:700;color:#475569;padding:4px 8px;white-space:nowrap;';
  const TD  = 'font-size:11px;color:#334155;padding:3px 8px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;';
  const LBL = 'font-size:11px;color:#334155;padding:3px 8px;text-align:left;';

  return chunks.map((chunk, idx) => {
    const flat = chunk.flatMap(g => g.cols.map(c => ({ g, c })));
    const span = 1 + flat.length;

    const head1 = chunk.map(g =>
      `<th colspan="${g.cols.length}" style="${TH}text-align:center;border-left:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1">${escapeHtml(g.label)}</th>`).join('');

    const head2 = flat.map(({ g, c }, i) => {
      const first = i === 0 || flat[i - 1].g.id !== g.id;
      return `<th style="${TH}text-align:right;border-bottom:1px solid #cbd5e1;${first ? 'border-left:1px solid #cbd5e1;' : ''}">
        <div style="font-weight:600;color:#334155">${escapeHtml(c.name)}</div>
        ${c.pct !== null ? `<div style="font-weight:400;font-size:9px;color:#94a3b8">${c.pct}%</div>` : ''}
      </th>`;
    }).join('');

    const catRows = (cats: string[]) => cats.map(cat => `<tr>
      <td style="${LBL}">${escapeHtml(cat)}</td>
      ${flat.map(({ g, c }) => `<td style="${TD}">${money(value(g.id, c.key, cat))}</td>`).join('')}
    </tr>`).join('');

    const totalRow = (label: string, cats: string[]) => `<tr style="border-top:1px solid #cbd5e1">
      <td style="${LBL}font-weight:700;color:#0f172a">${escapeHtml(label)}</td>
      ${flat.map(({ g, c }) => `<td style="${TD}font-weight:700;color:#0f172a">${money(sumCats(g.id, c.key, cats))}</td>`).join('')}
    </tr>`;

    const sectionRow = (label: string, colour: string) =>
      `<tr><td colspan="${span}" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${colour};padding:9px 8px 2px">${label}</td></tr>`;

    const netRow = `<tr style="border-top:2px solid #94a3b8">
      <td style="${LBL}font-weight:700;color:#0f172a">Net profit / (loss)</td>
      ${flat.map(({ g, c }) => {
        const net = sumCats(g.id, c.key, m.incomeCats) - sumCats(g.id, c.key, m.expenseCats);
        return `<td style="${TD}font-weight:700;color:${net < 0 ? '#dc2626' : '#0f172a'}">${money(net)}</td>`;
      }).join('')}
    </tr>`;

    return `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
        <p style="${H_COMPANY}">${escapeHtml(data.clientName)}</p>
        <h2 style="${H_TITLE}">Income by Person &mdash; full working</h2>
        <p style="${H_PERIOD}">${escapeHtml(periodLine)}${chunks.length > 1 ? ` &middot; Part ${idx + 1} of ${chunks.length}` : ''}</p>
        <div style="border-bottom:1px solid #e2e8f0;margin:0 0 12px"></div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr><th rowspan="2" style="${TH}text-align:left;border-bottom:1px solid #cbd5e1;vertical-align:bottom">Category</th>${head1}</tr>
            <tr>${head2}</tr>
          </thead>
          <tbody>
            ${sectionRow('Income', '#047857')}
            ${m.incomeCats.length ? catRows(m.incomeCats) : `<tr><td colspan="${span}" style="${LBL}color:#94a3b8">No income</td></tr>`}
            ${totalRow('Total income', m.incomeCats)}
            ${sectionRow('Expenses', '#dc2626')}
            ${m.expenseCats.length ? catRows(m.expenseCats) : `<tr><td colspan="${span}" style="${LBL}color:#94a3b8">No expenses</td></tr>`}
            ${totalRow('Total expenses', m.expenseCats)}
            ${netRow}
          </tbody>
        </table>
        <p style="font-size:9px;color:#94a3b8;margin:10px 0 0">Each property&rsquo;s income and expenses are shared out by ownership % (shown under each name). Capital items are excluded.</p>
      </div>`;
  });
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

  // 1b. Prior-year comparison
  if (data.comparison) {
    const cmp = data.comparison;
    const body = buildComparisonRows(cmp.current, cmp.prior).map(r => r.heading
      ? `<tr><td colspan="3" style="padding:12px 0 2px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(r.label)}</td></tr>`
      : `<tr style="${r.rule ? 'border-top:1px solid #cbd5e1;' : ''}">
          <td style="${LBL}${r.bold ? 'font-weight:700;color:#0f172a;' : r.muted ? 'color:#64748b;' : 'color:#334155;'}">${escapeHtml(r.label)}</td>
          <td style="${AMT}${r.bold ? 'font-weight:700;color:#0f172a;' : r.muted ? 'color:#64748b;' : 'color:#334155;'}">${money(r.current)}</td>
          <td style="${AMT}color:#64748b;">${money(r.prior)}</td>
        </tr>`).join('');
    parts.push(section('comparison', 'Prior-year comparison',
      sectionHead(data.clientName, 'Comparison to Prior Year', periodLine) +
      `<table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="font-size:11px;font-weight:700;color:#475569"><th style="text-align:left"></th><th style="${AMT}">${escapeHtml(cmp.curLabel || 'This year')}</th><th style="${AMT}">${escapeHtml(cmp.priorLabel || 'Last year')}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`));
  }

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

  // The individuals who own the portfolio — drives the By-Person section and the
  // signatory page.
  let signatories: Array<{ name: string; clientId: string | null }> = [];

  // The full per-person working is emitted as LANDSCAPE pages at the end of the
  // report (buildLandlordMatrixPages) — too wide for portrait A4. Here we only
  // resolve who the owners are, for the signatory page.
  if (data.properties.length > 0) {
    const inc = data.income.map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount }))
      .concat(data.adjustments.filter(a => a.type === 'income').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount })));
    const exp = data.expenses.filter(r => !r.CapitalExpense).map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount }))
      .concat(data.adjustments.filter(a => a.type === 'expense').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount })));
    const bd = computePersonBreakdown(inc, exp, data.properties, { id: data.primaryClientId, name: data.primaryClientName });
    signatories = bd.people.map(p => ({ name: p.name, clientId: p.clientId }));
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

  // 7. Approval — each individual signs off the computation. Falls back to the
  //    client themselves when no owners have been set up.
  if (signatories.length === 0 && (data.primaryClientName || data.clientName)) {
    signatories = [{ name: data.primaryClientName || data.clientName, clientId: data.primaryClientId ?? null }];
  }
  if (signatories.length > 0) {
    const sigRows = signatories.map(s => `
      <tr>
        <td style="padding:22px 14px 4px 0;font-size:12px;color:#0f172a;vertical-align:bottom;white-space:nowrap">${escapeHtml(s.name)}</td>
        <td style="padding:22px 14px 4px 0;border-bottom:1px solid #94a3b8;width:44%"></td>
        <td style="padding:22px 0 4px 0;border-bottom:1px solid #94a3b8;width:24%"></td>
      </tr>
      <tr>
        <td></td>
        <td style="font-size:10px;color:#94a3b8;padding:2px 14px 8px 0">Signature</td>
        <td style="font-size:10px;color:#94a3b8;padding:2px 0 8px 0">Date</td>
      </tr>`).join('');
    parts.push(section('approval', 'Approval',
      sectionHead(data.clientName, 'Approval', periodLine) +
      `<p style="font-size:12px;color:#334155;line-height:1.6;margin:0 0 6px">I/we approve the property income computation set out in this report for the period stated, and confirm that the income and expenses are complete and correct to the best of my/our knowledge and belief.</p>
       <table style="width:100%;border-collapse:collapse">${sigRows}</table>`));
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
