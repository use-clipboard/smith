// Accounts Studio — build the full statutory-accounts PDF pack as HTML.
//
// Consumed by generatePdfBlob() (utils/pdfFromHtml) via its HTML-string path
// with { hardPageBreaks: true, pageNumbers: true }. Structure follows the
// standard UK small-company layout (Capium-style): a cover, a contents page
// with live page numbers, then Company Information, the Director's Report, the
// Accountants' Report, the Income Statement, the Statement of Financial
// Position, the Notes, and (full only) a Detailed Income Statement — each
// starting on a fresh page. Inline styles only; keep-together blocks use
// `.paper`, and each section wrapper is `.paper.force-page-start` + a
// `data-toc` key that the contents page references via `data-toc-fill`.

import type { Engagement } from '@/components/features/accounts-studio/types';
import type { FinancialStatements, ProfitLoss, StmtGroup } from '@/lib/accounts-studio/statements';

export interface AccountsPackOptions {
  filleted?: boolean;
  firmName?: string | null;
  firmLogoUrl?: string | null;
  /** Firm house-style Accountant Details block (HTML) — Settings → Accounts Studio. */
  accountantDetails?: string | null;
  /** Firm house-style Accountants' Report wording (HTML). */
  accountantsReport?: string | null;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function money(n: number | null): string {
  if (n === null) return '';
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v) < 0.005) return '—';
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** dd-mm-yyyy → "31 December 2024" (falls back to the raw string). */
function longDate(dmy: string): string {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec((dmy || '').trim());
  if (!m) return dmy || '';
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return dmy;
  return `${parseInt(m[1], 10)} ${MONTHS[mi]} ${m[3]}`;
}

/** dd-mm-yyyy → "2024" (year label for the amount columns). */
function yearOf(dmy: string): string {
  const m = /(\d{4})$/.exec((dmy || '').trim());
  return m ? m[1] : '';
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

const AMT = 'text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding:3px 0 3px 18px;';
const LBL = 'padding:3px 0;';

const NOTE_TD = 'text-align:center;font-size:11px;color:#64748b;padding:3px 6px;white-space:nowrap;';

function row(label: string, current: number | null, prior: number | null, hasPrior: boolean, opts: { bold?: boolean; rule?: boolean; muted?: boolean; indent?: boolean; notesCol?: boolean; noteRef?: string } = {}): string {
  const weight = opts.bold ? 'font-weight:700;' : '';
  const colour = opts.muted ? 'color:#64748b;' : opts.bold ? 'color:#0f172a;' : 'color:#334155;';
  const borderTop = opts.rule ? 'border-top:1px solid #cbd5e1;' : '';
  const pad = opts.indent ? 'padding-left:16px;' : '';
  const noteTd = opts.notesCol ? `<td style="${NOTE_TD}">${opts.noteRef ?? ''}</td>` : '';
  return `<tr style="${borderTop}">
    <td style="${LBL}${pad}${weight}${colour}">${label}</td>
    ${noteTd}
    <td style="${AMT}${weight}${colour}">${money(current)}</td>
    ${hasPrior ? `<td style="${AMT}${weight}color:#64748b;">${money(prior)}</td>` : ''}
  </tr>`;
}

function groupRows(groups: StmtGroup[], hasPrior: boolean, sign: 1 | -1, notesCol = false): string {
  return groups.map(g => row(g.title, sign * g.total, g.totalPrior === null ? null : sign * g.totalPrior, hasPrior, { notesCol })).join('');
}

function amountHead(hasPrior: boolean, curYear: string, priorYear: string, notesCol = false): string {
  const noteTh = notesCol ? '<th style="text-align:center;font-size:11px;font-weight:700;color:#475569;padding-bottom:4px">Notes</th>' : '';
  const noteTh2 = notesCol ? '<th></th>' : '';
  return `<thead><tr style="font-size:11px;font-weight:700;color:#475569">
    <th style="text-align:left;padding-bottom:4px"></th>
    ${noteTh}
    <th style="${AMT}padding-bottom:4px">${curYear || '£'}</th>
    ${hasPrior ? `<th style="${AMT}padding-bottom:4px">${priorYear}</th>` : ''}
  </tr>
  <tr style="font-size:11px;color:#94a3b8"><th style="text-align:left"></th>${noteTh2}<th style="${AMT}">£</th>${hasPrior ? `<th style="${AMT}">£</th>` : ''}</tr></thead>`;
}

// ── Section chrome ───────────────────────────────────────────────────────────

const H_COMPANY = 'font-size:13px;font-weight:700;color:#0f172a;margin:0;text-align:center';
const H_TITLE = 'font-size:17px;font-weight:700;color:#0f172a;margin:6px 0 2px;text-align:center';
const H_PERIOD = 'font-size:11.5px;color:#64748b;margin:0 0 4px;text-align:center';

function sectionHead(companyName: string, title: string, periodLine: string, regNo?: string): string {
  return `
    ${regNo ? `<p style="font-size:11px;color:#475569;margin:0 0 2px;text-align:center">Registered Number: ${escapeHtml(regNo)}</p>` : ''}
    <p style="${H_COMPANY}">${escapeHtml(companyName)}</p>
    <h2 style="${H_TITLE}">${escapeHtml(title)}</h2>
    <p style="${H_PERIOD}">${escapeHtml(periodLine)}</p>
    <div style="border-bottom:1px solid #e2e8f0;margin:0 0 16px"></div>`;
}

interface Part { key: string; label: string; html: string }

function section(key: string, label: string, inner: string): Part {
  return { key, label, html: `<div class="paper force-page-start" data-toc="${key}" style="margin-bottom:0">${inner}</div>` };
}

// ── Statement blocks ─────────────────────────────────────────────────────────

function incomeStatement(pl: ProfitLoss, hasPrior: boolean, curYear: string, priorYear: string, noteNo: (id: string) => string): string {
  const taxTotal = pl.taxation.reduce((t, g) => t + g.total, 0);
  const taxTotalPrior = hasPrior ? pl.taxation.reduce((t, g) => t + (g.totalPrior ?? 0), 0) : null;
  const beforeTax = pl.netProfit + taxTotal;
  const beforeTaxPrior = hasPrior && pl.netProfitPrior != null ? pl.netProfitPrior + (taxTotalPrior ?? 0) : null;
  const hasTax = pl.taxation.length > 0 || Math.abs(taxTotal) >= 0.005;
  return `<table style="width:100%;border-collapse:collapse;font-size:12.5px">${amountHead(hasPrior, curYear, priorYear, true)}<tbody>
    ${groupRows(pl.turnover, hasPrior, 1, true)}
    ${row('Turnover', pl.turnoverTotal, pl.turnoverTotalPrior, hasPrior, { bold: true, rule: true, notesCol: true })}
    ${pl.costOfSales.length ? groupRows(pl.costOfSales, hasPrior, -1, true) + row('Gross profit', pl.grossProfit, pl.grossProfitPrior, hasPrior, { bold: true, rule: true, notesCol: true }) : ''}
    ${groupRows(pl.expenses, hasPrior, -1, true)}
    ${pl.expenses.length ? row('Operating profit', pl.operatingProfit, pl.operatingProfitPrior, hasPrior, { bold: true, rule: true, notesCol: true }) : ''}
    ${hasTax ? row('Profit/(loss) on ordinary activities before taxation', beforeTax, beforeTaxPrior, hasPrior, { bold: true, notesCol: true }) : ''}
    ${hasTax ? row('Tax on profit on ordinary activities', -taxTotal, taxTotalPrior === null ? null : -taxTotalPrior, hasPrior, { notesCol: true, noteRef: noteNo('taxation') }) : ''}
    ${row('Profit/(loss) for the financial year', pl.netProfit, pl.netProfitPrior, hasPrior, { bold: true, rule: true, notesCol: true })}
  </tbody></table>`;
}

/** True for a retained-earnings / P&L reserve equity ledger (not share capital,
 *  share premium or revaluation reserve — those stay as their own lines). */
function isRetainedGroup(title: string): boolean {
  const t = title.toLowerCase();
  return t.includes('profit and loss') || t.includes('retained') || t.includes('p&l') || t.includes('accumulated');
}

function balanceSheet(bs: FinancialStatements['balanceSheet'], hasPrior: boolean, curYear: string, priorYear: string, noteNo: (id: string) => string): string {
  // Fold any retained-earnings ledger from the trial balance into a single
  // "Profit and loss account" reserve line together with the year's profit, so
  // the balance sheet never shows two P&L-account lines. Other equity (share
  // capital, share premium, revaluation reserve) keeps its own line.
  const otherCapital = bs.capitalAndReserves.filter(g => !isRetainedGroup(g.title));
  const reserveGroups = bs.capitalAndReserves.filter(g => isRetainedGroup(g.title));
  const reserveCur = reserveGroups.reduce((s, g) => s + g.total, 0) + bs.profitForYear;
  const reservePrior = hasPrior ? reserveGroups.reduce((s, g) => s + (g.totalPrior ?? 0), 0) + (bs.profitForYearPrior ?? 0) : null;

  return `<table style="width:100%;border-collapse:collapse;font-size:12.5px">${amountHead(hasPrior, curYear, priorYear, true)}<tbody>
    ${bs.fixedAssets.length ? row('Fixed assets', null, null, hasPrior, { muted: true, notesCol: true, noteRef: noteNo('fixed-assets') }) + groupRows(bs.fixedAssets, hasPrior, 1, true) + row('', bs.fixedAssetsTotal, bs.fixedAssetsTotalPrior, hasPrior, { bold: true, rule: true, notesCol: true }) : ''}
    ${row('Current assets', null, null, hasPrior, { muted: true, notesCol: true, noteRef: noteNo('debtors') })}
    ${groupRows(bs.currentAssets, hasPrior, 1, true)}
    ${row('', bs.currentAssetsTotal, bs.currentAssetsTotalPrior, hasPrior, { notesCol: true })}
    ${bs.creditorsWithin.length ? row('Creditors: amounts falling due within one year', null, null, hasPrior, { muted: true, notesCol: true, noteRef: noteNo('creditors') }) + groupRows(bs.creditorsWithin, hasPrior, -1, true) : ''}
    ${row('Net current assets', bs.netCurrentAssets, bs.netCurrentAssetsPrior, hasPrior, { bold: true, rule: true, notesCol: true })}
    ${row('Total assets less current liabilities', bs.totalAssetsLessCurrent, bs.totalAssetsLessCurrentPrior, hasPrior, { bold: true, notesCol: true })}
    ${bs.creditorsAfter.length ? row('Creditors: amounts falling due after more than one year', null, null, hasPrior, { muted: true, notesCol: true, noteRef: noteNo('creditors') }) + groupRows(bs.creditorsAfter, hasPrior, -1, true) : ''}
    ${bs.provisions.length ? row('Provisions for liabilities', null, null, hasPrior, { muted: true, notesCol: true }) + groupRows(bs.provisions, hasPrior, -1, true) : ''}
    ${row('Net assets', bs.netAssets, bs.netAssetsPrior, hasPrior, { bold: true, rule: true, notesCol: true })}
    ${row('Capital and reserves', null, null, hasPrior, { muted: true, notesCol: true, noteRef: noteNo('share-capital') })}
    ${groupRows(otherCapital, hasPrior, 1, true)}
    ${row('Profit and loss account', reserveCur, reservePrior, hasPrior, { notesCol: true, noteRef: noteNo('reserves') })}
    ${row('Total equity', bs.totalEquity, bs.totalEquityPrior, hasPrior, { bold: true, rule: true, notesCol: true })}
  </tbody></table>`;
}

/** Per-category breakdown of the P&L (full accounts only). */
function detailedIncomeStatement(pl: ProfitLoss, hasPrior: boolean, curYear: string, priorYear: string): string {
  const block = (heading: string, groups: StmtGroup[], sign: 1 | -1, subtotal: number, subtotalPrior: number | null): string => {
    if (!groups.length) return '';
    // Show raw (positive) line values; the subtotal carries the sign.
    const rawLines = groups.flatMap(g => g.lines.map(l => row(l.label, l.current, l.prior, hasPrior, { indent: true })));
    return `<tr><td style="${LBL}font-weight:700;color:#0f172a">${heading}</td><td></td>${hasPrior ? '<td></td>' : ''}</tr>
      ${rawLines.join('')}
      ${row('', sign * subtotal, subtotalPrior === null ? null : sign * subtotalPrior, hasPrior, { bold: true, rule: true })}`;
  };
  return `<table style="width:100%;border-collapse:collapse;font-size:12.5px">${amountHead(hasPrior, curYear, priorYear)}<tbody>
    ${block('Turnover', pl.turnover, 1, pl.turnoverTotal, pl.turnoverTotalPrior)}
    ${pl.costOfSales.length ? block('Cost of sales', pl.costOfSales, -1, pl.costOfSales.reduce((t, g) => t + g.total, 0), hasPrior ? pl.costOfSales.reduce((t, g) => t + (g.totalPrior ?? 0), 0) : null) + row('Gross profit', pl.grossProfit, pl.grossProfitPrior, hasPrior, { bold: true }) : ''}
    ${block('Administrative expenses', pl.expenses, -1, pl.expenses.reduce((t, g) => t + g.total, 0), hasPrior ? pl.expenses.reduce((t, g) => t + (g.totalPrior ?? 0), 0) : null)}
    ${pl.expenses.length ? row('Operating profit', pl.operatingProfit, pl.operatingProfitPrior, hasPrior, { bold: true, rule: true }) : ''}
    ${pl.taxation.length ? block('Tax on profit', pl.taxation, -1, pl.taxation.reduce((t, g) => t + g.total, 0), hasPrior ? pl.taxation.reduce((t, g) => t + (g.totalPrior ?? 0), 0) : null) : ''}
    ${row('Profit/(loss) for the financial year', pl.netProfit, pl.netProfitPrior, hasPrior, { bold: true, rule: true })}
  </tbody></table>`;
}

/** The director/member who signs — the chosen signatory, else the first. */
function signatoryName(e: Engagement): string {
  const dirs = (e.directors ?? []).filter(Boolean);
  return (e.signatory && e.signatory.trim()) || dirs[0] || e.preparedBy || '';
}

// ── Section-specific bodies ──────────────────────────────────────────────────

function companyInfoBody(e: Engagement, accountantDetails: string, firmName: string): string {
  const dirs = (e.directors ?? []).filter(Boolean);
  const dirLabel = dirs.length > 1 ? 'Directors' : 'Director';
  const dirValue = dirs.length ? dirs.map(escapeHtml).join('<br>') : '—';
  const acct = accountantDetails.trim() || (firmName ? escapeHtml(firmName) : '—');
  const infoRow = (label: string, value: string) =>
    `<tr><td style="padding:6px 24px 6px 0;color:#64748b;font-size:12px;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:6px 0;color:#0f172a;font-size:12.5px;line-height:1.5">${value}</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse">
    ${infoRow(dirLabel, dirValue)}
    ${infoRow('Registered Number', e.companyNumber ? escapeHtml(e.companyNumber) : '—')}
    ${e.registeredOffice ? infoRow('Registered Office', escapeHtml(e.registeredOffice).replace(/, /g, '<br>')) : ''}
    ${infoRow('Accountants', acct)}
  </table>`;
}

function directorsReportBody(e: Engagement, isLlp: boolean): string {
  const reportId = isLlp ? 'members-report' : 'directors-report';
  const disc = e.disclosures.find(s => s.id === reportId && s.included !== false && s.content && s.content.trim());
  const officer = isLlp ? 'member' : 'director';
  const dir = signatoryName(e);

  const body = disc
    ? `<div style="font-size:12.5px;line-height:1.6;color:#1e293b">${disc.content}</div>`
    : `<div style="font-size:12.5px;line-height:1.6;color:#1e293b">
        <p style="margin:0 0 10px">The ${officer} presents ${isLlp ? 'their' : 'his/her/their'} annual report and the financial statements for the year ended ${longDate(e.periodEnd)}.</p>
        <p style="font-weight:700;margin:14px 0 4px">${isLlp ? 'Members' : 'Director'}</p>
        <p style="margin:0 0 10px">The ${officer}${(e.directors ?? []).length > 1 ? 's who served' : ' who served'} the ${isLlp ? 'LLP' : 'company'} during the year ${(e.directors ?? []).length > 1 ? 'were' : 'was'} as follows:</p>
        <p style="margin:0 0 10px">${((e.directors ?? []).filter(Boolean).map(escapeHtml).join('<br>')) || '—'}</p>
        <p style="font-weight:700;margin:14px 0 4px">Statement of ${officer}'s responsibilities</p>
        <p style="margin:0 0 10px">The ${officer} is responsible for preparing the report and the financial statements in accordance with applicable law and United Kingdom Generally Accepted Accounting Practice.</p>
        <p style="margin:0 0 10px">Company law requires the ${officer} to prepare financial statements for each financial year which give a true and fair view of the state of affairs of the ${isLlp ? 'LLP' : 'company'} and of its profit or loss for that period. In preparing these financial statements the ${officer} is required to select suitable accounting policies and apply them consistently; make judgements and estimates that are reasonable and prudent; and prepare the financial statements on the going concern basis unless it is inappropriate to presume that the ${isLlp ? 'LLP' : 'company'} will continue in business.</p>
        <p style="margin:0 0 10px">The ${officer} is responsible for keeping adequate accounting records that are sufficient to show and explain the ${isLlp ? 'LLP' : 'company'}'s transactions and disclose with reasonable accuracy at any time the financial position of the ${isLlp ? 'LLP' : 'company'}, and to enable them to ensure that the financial statements comply with the Companies Act 2006. They are also responsible for safeguarding the assets of the ${isLlp ? 'LLP' : 'company'} and hence for taking reasonable steps for the prevention and detection of fraud and other irregularities.</p>
      </div>`;

  const signature = `
    <div class="paper" style="margin-top:34px">
      <p style="font-size:12.5px;color:#334155;margin:0 0 30px">${isLlp ? 'On behalf of the members.' : 'On behalf of the board.'}</p>
      <div style="border-top:1px solid #94a3b8;width:240px;padding-top:6px;font-size:12px;color:#0f172a">${escapeHtml(dir)}</div>
      <p style="font-size:11.5px;color:#64748b;margin:2px 0 0">${isLlp ? 'Member' : 'Director'}</p>
      <p style="font-size:11.5px;color:#64748b;margin:14px 0 0">Date approved: ______________________</p>
    </div>`;

  return body + signature;
}

function accountantsReportBody(e: Engagement, accountantsReport: string, accountantDetails: string, firmName: string): string {
  const disc = e.disclosures.find(s => (s.id === 'accountants-report' || s.id === 'firm-accountants-report') && s.included !== false && s.content && s.content.trim());
  const custom = (disc?.content && disc.content.trim()) || (accountantsReport && accountantsReport.trim());
  const isLlp = e.entityType === 'llp';
  const officer = isLlp ? 'members' : 'director';

  const bodyHtml = custom
    ? `<div style="font-size:12.5px;line-height:1.6;color:#1e293b">${custom}</div>`
    : `<div style="font-size:12.5px;line-height:1.6;color:#1e293b">
        <p style="margin:0 0 10px">In order to assist you to fulfil your duties under the Companies Act 2006, we have prepared for your approval the financial statements of ${escapeHtml(e.companyName)} for the year ended ${longDate(e.periodEnd)}, which comprise the Income Statement, the Statement of Financial Position and the related notes, from the accounting records and the information and explanations you have given to us.</p>
        <p style="margin:0 0 10px">This report is made solely to the ${officer} of ${escapeHtml(e.companyName)}, in accordance with the terms of our engagement letter. Our work has been undertaken so that we might state to the ${officer} those matters we have agreed to state to them in this report and for no other purpose.</p>
        <p style="margin:0 0 10px">We have not been instructed to carry out an audit or a review of the financial statements and consequently express no opinion on them.</p>
      </div>`;

  const acct = accountantDetails.trim() || (firmName ? `<p style="margin:0">${escapeHtml(firmName)}</p>` : '');
  const sign = acct
    ? `<div class="paper" style="margin-top:30px;font-size:12px;color:#334155;line-height:1.5">
        <div style="border-top:1px solid #94a3b8;width:240px;padding-top:6px;margin-bottom:8px"></div>
        ${acct}
        <p style="margin:14px 0 0;color:#64748b">Date: ______________________</p>
      </div>`
    : '';
  return bodyHtml + sign;
}

function sofpFooter(e: Engagement): string {
  const isLlp = e.entityType === 'llp';
  const officer = isLlp ? 'members' : 'director';
  const dir = signatoryName(e);
  // The audit-exemption / responsibility statements are an editable section
  // ('balance-sheet-statements'); fall back to standard wording if absent.
  const disc = e.disclosures.find(s => s.id === 'balance-sheet-statements' && s.included !== false && s.content && s.content.trim());
  const statements = disc
    ? disc.content
    : `<p style="margin:0 0 8px">For the financial year the ${isLlp ? 'LLP' : 'company'} was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies.</p>
       <p style="margin:0 0 4px;font-weight:600;color:#334155">${isLlp ? 'Members' : "Director"}'s responsibilities:</p>
       <p style="margin:0 0 4px">1. The members have not required the ${isLlp ? 'LLP' : 'company'} to obtain an audit of its accounts for the year in question in accordance with section 476.</p>
       <p style="margin:0 0 8px">2. The ${officer} acknowledge${isLlp ? '' : 's'} their responsibilities for complying with the requirements of the Companies Act 2006 with respect to accounting records and the preparation of accounts.</p>
       <p style="margin:0 0 14px">These financial statements have been prepared in accordance with the provisions applicable to ${isLlp ? 'LLPs subject to the small LLPs regime' : 'companies subject to the small companies regime'}.</p>`;
  return `<div class="paper" style="margin-top:20px;font-size:11.5px;line-height:1.55;color:#475569">
    ${statements}
    <p style="margin:14px 0 26px">The financial statements were approved by the ${officer} and were signed by:</p>
    <div style="border-top:1px solid #94a3b8;width:240px;padding-top:6px;color:#0f172a">${escapeHtml(dir)}</div>
    <p style="margin:2px 0 0;color:#64748b">${isLlp ? 'Member' : 'Director'}</p>
  </div>`;
}

/** The disclosures that become numbered notes, in order (shared so statement
 *  note references and the Notes page agree on numbering). */
function renderedNoteList(e: Engagement, excludeIds: Set<string>): Engagement['disclosures'] {
  return e.disclosures.filter(s => s.included !== false && s.content && s.content.trim() && !excludeIds.has(s.id));
}

function notesBody(e: Engagement, excludeIds: Set<string>): { html: string; hasNotes: boolean } {
  const notes = renderedNoteList(e, excludeIds);
  if (!notes.length) return { html: '', hasNotes: false };
  const genInfo = `<div class="paper" style="margin-bottom:16px">
    <p style="font-size:12.5px;font-weight:700;color:#0f172a;margin:0 0 4px">General Information</p>
    <p style="font-size:12px;line-height:1.55;color:#475569;margin:0">${escapeHtml(e.companyName)} is ${e.entityType === 'llp' ? 'a limited liability partnership' : 'a private company, limited by shares'}, registered in the United Kingdom${e.companyNumber ? `, registration number ${escapeHtml(e.companyNumber)}` : ''}${e.registeredOffice ? `, registered office ${escapeHtml(e.registeredOffice)}` : ''}. The presentation currency is £ sterling.</p>
  </div>`;
  const body = notes.map((s, i) => `<div class="paper" style="margin-bottom:16px">
    <p style="font-size:12.5px;font-weight:700;color:#0f172a;margin:0 0 3px">${i + 1}. ${escapeHtml(s.title)}</p>
    <div style="font-size:12px;line-height:1.55;color:#1e293b">${s.content}</div>
  </div>`).join('');
  return { html: genInfo + body, hasNotes: true };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function buildAccountsPackHtml(e: Engagement, opts: AccountsPackOptions = {}): string {
  const filleted = !!opts.filleted;
  const firmName = opts.firmName?.trim() || '';
  const logo = opts.firmLogoUrl || '';
  const accountantDetails = opts.accountantDetails || '';
  const accountantsReport = opts.accountantsReport || '';

  const isLlp = e.entityType === 'llp';
  const s = e.statements;
  const hasPrior = !!s?.hasPrior;
  const curYear = yearOf(e.periodEnd);
  const priorYear = e.comparativePeriod ? yearOf(e.comparativePeriod) : '';
  const periodLine = `For the year ended ${longDate(e.periodEnd)}`;

  // Notes that appear on the Notes page — used both to number the notes and to
  // resolve statement note references (id → "3"). Kept in one place so the
  // Income Statement / SoFP references always match the printed note numbers.
  const excludeIds = new Set(['directors-report', 'strategic-report', 'members-report', 'accountants-report', 'firm-accountants-report', 'firm-accountant-details', 'firm-governing-body', 'balance-sheet-statements']);
  const noteList = renderedNoteList(e, excludeIds);
  const noteNo = (id: string): string => {
    const i = noteList.findIndex(n => n.id === id);
    return i >= 0 ? String(i + 1) : '';
  };

  const parts: Part[] = [];

  // 1. Company Information
  parts.push(section('company-info', 'Company information',
    sectionHead(e.companyName, 'Company Information', periodLine) + companyInfoBody(e, accountantDetails, firmName)));

  // 2. Director's / Members' Report (omitted from filleted filing copy)
  if (!filleted) {
    parts.push(section('directors-report', isLlp ? "Members' report" : "Director's report",
      sectionHead(e.companyName, isLlp ? "Members' Report" : "Director's Report", periodLine) + directorsReportBody(e, isLlp)));
  }

  // 3. Accountants' Report
  parts.push(section('accountants-report', "Accountants' report",
    sectionHead(e.companyName, "Accountants' Report", periodLine) + accountantsReportBody(e, accountantsReport, accountantDetails, firmName)));

  // 4. Income Statement (omitted from filleted filing copy)
  if (!filleted) {
    parts.push(section('income-statement', 'Income statement',
      sectionHead(e.companyName, 'Income Statement', periodLine) +
      (s ? incomeStatement(s.profitLoss, hasPrior, curYear, priorYear, noteNo) : '<p style="color:#94a3b8">No financial statements imported.</p>')));
  }

  // 5. Statement of Financial Position
  parts.push(section('sofp', 'Statement of financial position',
    sectionHead(e.companyName, 'Statement of Financial Position', `As at ${longDate(e.periodEnd)}`, e.companyNumber || undefined) +
    (s ? balanceSheet(s.balanceSheet, hasPrior, curYear, priorYear, noteNo) + sofpFooter(e) : '<p style="color:#94a3b8">No financial statements imported.</p>')));

  // 6. Notes to the Financial Statements
  const notes = notesBody(e, excludeIds);
  if (notes.hasNotes) {
    parts.push(section('notes', 'Notes to the financial statements',
      sectionHead(e.companyName, 'Notes to the Financial Statements', periodLine) + notes.html));
  }

  // 7. Detailed Income Statement (full accounts only)
  if (!filleted && s) {
    parts.push(section('detailed-income', 'Detailed Income Statement',
      sectionHead(e.companyName, 'Detailed Income Statement', periodLine) +
      detailedIncomeStatement(s.profitLoss, hasPrior, curYear, priorYear)));
  }

  // ── Cover ──
  const kicker = filleted ? 'Filleted Accounts for Filing' : 'Report of the Director and Unaudited Financial Statements';
  const cover = `
    <div class="paper" style="min-height:1000px;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:0 48px">
      ${logo ? `<img src="${logo}" alt="" crossorigin="anonymous" style="max-height:64px;max-width:240px;object-fit:contain;margin:0 auto 30px" />` : ''}
      ${e.companyNumber ? `<p style="font-size:12px;color:#64748b;margin:0 0 14px">Registered Number: ${escapeHtml(e.companyNumber)}</p>` : ''}
      <h1 style="font-size:30px;margin:0 0 16px;color:#0f172a">${escapeHtml(e.companyName)}</h1>
      <p style="font-size:14px;color:#334155;margin:0 0 30px">${kicker}</p>
      <p style="font-size:13px;font-weight:700;color:#475569;margin:0 0 4px">Period of accounts</p>
      <p style="font-size:12.5px;color:#334155;margin:0">Start date: ${longDate(e.periodStart)}</p>
      <p style="font-size:12.5px;color:#334155;margin:2px 0 0">End date: ${longDate(e.periodEnd)}</p>
      <p style="font-size:11px;color:#94a3b8;margin:24px 0 0">${escapeHtml(e.framework)}</p>
      ${firmName ? `<div style="margin-top:40px;color:#475569;font-size:13px;font-weight:600">${escapeHtml(firmName)}</div>` : ''}
    </div>`;

  // ── Contents ──
  const contentsRows = parts.map(p => `<tr>
      <td style="padding:6px 0;font-size:12.5px;color:#0f172a">${escapeHtml(p.label)}</td>
      <td style="padding:6px 0;text-align:right;font-size:12.5px;color:#334155;width:48px" data-toc-fill="${p.key}"></td>
    </tr>`).join('');
  const contents = `
    <div class="paper force-page-start">
      ${sectionHead(e.companyName, 'Contents Page', periodLine)}
      <table style="width:100%;border-collapse:collapse">${contentsRows}</table>
    </div>`;

  const body = parts.map(p => p.html).join('');

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">${cover}${contents}${body}</div>`;
}
