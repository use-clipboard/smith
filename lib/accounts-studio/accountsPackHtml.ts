// Accounts Studio — build the full statutory-accounts PDF pack as HTML.
//
// Consumed by generatePdfBlob() (utils/pdfFromHtml) via its HTML-string path,
// so it uses inline styles only and wraps keep-together blocks in `.paper`
// (the string path runs avoidSplit('.paper, …') to stop blocks splitting across
// a page break). The pack is a real deliverable built from the engagement's
// imported statements + drafted disclosures — no placeholders.

import type { Engagement } from '@/components/features/accounts-studio/types';
import type { FinancialStatements, StmtGroup } from '@/lib/accounts-studio/statements';

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v) < 0.005) return '—';
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
}

const AMT = 'text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding:3px 0 3px 18px;';
const LBL = 'padding:3px 0;';

function row(label: string, current: number | null, prior: number | null, hasPrior: boolean, opts: { bold?: boolean; rule?: boolean; muted?: boolean } = {}): string {
  const weight = opts.bold ? 'font-weight:700;' : '';
  const colour = opts.muted ? 'color:#64748b;' : opts.bold ? 'color:#0f172a;' : 'color:#334155;';
  const borderTop = opts.rule ? 'border-top:1px solid #cbd5e1;' : '';
  const cur = current === null ? '' : money(current);
  const pri = prior === null ? '' : money(prior);
  return `<tr style="${borderTop}">
    <td style="${LBL}${weight}${colour}">${label}</td>
    <td style="${AMT}${weight}${colour}">${cur}</td>
    ${hasPrior ? `<td style="${AMT}${weight}color:#64748b;">${pri}</td>` : ''}
  </tr>`;
}

function groupRows(groups: StmtGroup[], hasPrior: boolean, sign: 1 | -1): string {
  return groups.map(g => row(
    g.title,
    sign * g.total,
    g.totalPrior === null ? null : sign * g.totalPrior,
    hasPrior,
  )).join('');
}

function statementsHtml(
  s: FinancialStatements, periodLabel: string, asAt: string, priorLabel: string,
  opts: { filleted?: boolean; filletNote?: string } = {},
): string {
  const { profitLoss: pl, balanceSheet: bs, hasPrior } = s;
  const head = `<thead><tr style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8">
    <th style="text-align:left;padding-bottom:4px"></th>
    <th style="${AMT}padding-bottom:4px">£</th>
    ${hasPrior ? `<th style="${AMT}padding-bottom:4px">${priorLabel}</th>` : ''}
  </tr></thead>`;

  const pnl = `
    <div class="paper" style="margin-bottom:26px">
      <h2 style="font-size:15px;margin:0 0 2px">Profit and Loss Account</h2>
      <p style="margin:0 0 10px;color:#64748b;font-size:11px">${periodLabel}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">${head}<tbody>
        ${groupRows(pl.turnover, hasPrior, 1)}
        ${row('Turnover', pl.turnoverTotal, pl.turnoverTotalPrior, hasPrior, { bold: true, rule: true })}
        ${pl.costOfSales.length ? groupRows(pl.costOfSales, hasPrior, -1) + row('Gross profit', pl.grossProfit, pl.grossProfitPrior, hasPrior, { bold: true, rule: true }) : ''}
        ${groupRows(pl.expenses, hasPrior, -1)}
        ${pl.expenses.length ? row('Operating profit', pl.operatingProfit, pl.operatingProfitPrior, hasPrior, { bold: true, rule: true }) : ''}
        ${groupRows(pl.taxation, hasPrior, -1)}
        ${row('Profit for the financial year', pl.netProfit, pl.netProfitPrior, hasPrior, { bold: true, rule: true })}
      </tbody></table>
    </div>`;

  const balance = `
    <div class="paper" style="margin-bottom:26px">
      <h2 style="font-size:15px;margin:0 0 2px">Balance Sheet</h2>
      <p style="margin:0 0 10px;color:#64748b;font-size:11px">As at ${asAt}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">${head}<tbody>
        ${bs.fixedAssets.length ? row('Fixed assets', null, null, hasPrior, { muted: true }) + groupRows(bs.fixedAssets, hasPrior, 1) + row('', bs.fixedAssetsTotal, bs.fixedAssetsTotalPrior, hasPrior, { bold: true, rule: true }) : ''}
        ${row('Current assets', null, null, hasPrior, { muted: true })}
        ${groupRows(bs.currentAssets, hasPrior, 1)}
        ${row('', bs.currentAssetsTotal, bs.currentAssetsTotalPrior, hasPrior, {})}
        ${bs.creditorsWithin.length ? row('Creditors: amounts falling due within one year', null, null, hasPrior, { muted: true }) + groupRows(bs.creditorsWithin, hasPrior, -1) : ''}
        ${row('Net current assets', bs.netCurrentAssets, bs.netCurrentAssetsPrior, hasPrior, { bold: true, rule: true })}
        ${row('Total assets less current liabilities', bs.totalAssetsLessCurrent, bs.totalAssetsLessCurrentPrior, hasPrior, { bold: true })}
        ${bs.creditorsAfter.length ? row('Creditors: amounts falling due after more than one year', null, null, hasPrior, { muted: true }) + groupRows(bs.creditorsAfter, hasPrior, -1) : ''}
        ${bs.provisions.length ? row('Provisions for liabilities', null, null, hasPrior, { muted: true }) + groupRows(bs.provisions, hasPrior, -1) : ''}
        ${row('Net assets', bs.netAssets, bs.netAssetsPrior, hasPrior, { bold: true, rule: true })}
        ${row('Capital and reserves', null, null, hasPrior, { muted: true })}
        ${groupRows(bs.capitalAndReserves, hasPrior, 1)}
        ${row('Profit for the financial year', bs.profitForYear, bs.profitForYearPrior, hasPrior, { muted: true })}
        ${row('Total equity', bs.totalEquity, bs.totalEquityPrior, hasPrior, { bold: true, rule: true })}
      </tbody></table>
      ${opts.filletNote ? `<p style="margin-top:16px;font-size:11px;color:#475569;line-height:1.5">${opts.filletNote}</p>` : ''}
    </div>`;

  // Filleted accounts omit the profit and loss account.
  return opts.filleted ? balance : pnl + balance;
}

/**
 * Statutory-accounts pack HTML for the engagement.
 * `filleted` produces the Companies House filing version: balance sheet + notes
 * only (no P&L), directors'/strategic/members' reports omitted, plus the s444
 * (small companies regime) filing statement.
 */
export function buildAccountsPackHtml(e: Engagement, opts: { filleted?: boolean; firmName?: string | null; firmLogoUrl?: string | null } = {}): string {
  const filleted = !!opts.filleted;
  const firmName = opts.firmName?.trim() || '';
  const logo = opts.firmLogoUrl || '';
  const info = e.importInfo;
  const asAt = e.periodEnd;
  const periodLabel = info ? `For the period ${uk(info.from)} to ${uk(info.to)}` : `For the year ended ${e.periodEnd}`;
  const priorLabel = e.comparativePeriod ? `${e.comparativePeriod.slice(-4)}` : 'Prior';

  // Filleted accounts don't file the directors' / strategic / members' reports.
  const excludeNotes = filleted ? new Set(['directors-report', 'strategic-report', 'members-report']) : new Set<string>();
  const notes = e.disclosures
    .filter(s => s.content && s.content.trim() && !excludeNotes.has(s.id))
    .map((s, i) => `<div class="paper" style="margin-bottom:20px">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin:0 0 2px">Note ${i + 1}</p>
      <div style="font-size:12.5px;line-height:1.55;color:#1e293b">${s.content}</div>
    </div>`).join('');

  const statements = e.statements
    ? statementsHtml(e.statements, periodLabel, asAt, priorLabel, { filleted, filletNote: filleted ? filletStatement(e.entityType) : undefined })
    : '<p class="paper" style="color:#94a3b8">No financial statements imported.</p>';

  const kicker = filleted ? 'Filleted Accounts' : 'Statutory Accounts';
  const filingLine = filleted
    ? `<p style="margin:12px 0 0;color:#6366f1;font-size:12px;font-weight:600">Prepared for filing with the Registrar of Companies under the small ${e.entityType === 'llp' ? 'LLPs' : 'companies'} regime</p>`
    : '';

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <!-- Cover — sized to fill the first A4 page -->
    <div class="paper" style="min-height:1040px;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:0 40px">
      ${logo ? `<img src="${logo}" alt="" crossorigin="anonymous" style="max-height:64px;max-width:240px;object-fit:contain;margin:0 auto 26px" />` : ''}
      <p style="font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#6366f1;margin:0 0 18px;font-weight:700">${kicker}</p>
      <h1 style="font-size:30px;margin:0 0 10px">${escapeHtml(e.companyName)}</h1>
      ${e.companyNumber ? `<p style="margin:0 0 4px;color:#64748b;font-size:13px">Company registration number ${escapeHtml(e.companyNumber)}</p>` : ''}
      <p style="margin:18px 0 4px;color:#334155;font-size:15px">Financial statements for the year ended ${escapeHtml(e.periodEnd)}</p>
      <p style="margin:0;color:#94a3b8;font-size:12px">${escapeHtml(e.framework)}</p>
      ${filingLine}
      ${e.registeredOffice ? `<p style="margin:20px 0 0;color:#94a3b8;font-size:11px">Registered office: ${escapeHtml(e.registeredOffice)}</p>` : ''}
      ${e.incorporationDate ? `<p style="margin:2px 0 0;color:#cbd5e1;font-size:11px">Incorporated ${escapeHtml(e.incorporationDate)}</p>` : ''}
      <div style="margin-top:40px;font-size:11px;color:#94a3b8">
        ${firmName ? `<div style="color:#475569;font-size:13px;font-weight:600;margin-bottom:6px">${escapeHtml(firmName)}</div>` : ''}
        Prepared by ${escapeHtml(e.preparedBy)}${e.reviewedBy ? ` · Reviewed by ${escapeHtml(e.reviewedBy)}` : ''}
      </div>
    </div>

    <!-- Statements -->
    <div class="force-page-start">${statements}</div>

    <!-- Notes -->
    ${notes ? `<div class="force-page-start"><h2 style="font-size:15px;margin:0 0 12px">Notes to the Financial Statements</h2>${notes}</div>` : ''}

    <!-- Approval -->
    <div class="paper force-page-start" style="margin-top:24px;border-top:2px solid #e2e8f0;padding-top:16px">
      <h2 style="font-size:14px;margin:0 0 8px">Approval</h2>
      <p style="font-size:12.5px;color:#334155;line-height:1.6">
        These financial statements were approved by the ${boardWord(e.entityType)} and authorised for issue.
      </p>
      <div style="margin-top:36px;display:flex;gap:60px">
        <div style="flex:1"><div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:11px;color:#64748b">Signed on behalf of the ${boardWord(e.entityType)}</div></div>
        <div style="width:160px"><div style="border-top:1px solid #94a3b8;padding-top:6px;font-size:11px;color:#64748b">Date</div></div>
      </div>
      <p style="margin-top:28px;color:#cbd5e1;font-size:10px">${firmName ? escapeHtml(firmName) + ' · ' : ''}Prepared using SMITH Accounts Studio</p>
    </div>
  </div>`;
}

/** The filing/exemption statement shown on a filleted balance sheet. */
function filletStatement(entityType: string): string {
  if (entityType === 'llp') {
    return 'These financial statements have been prepared in accordance with the provisions applicable to LLPs subject to the small LLPs regime. In accordance with the Limited Liability Partnerships (Accounts and Audit) (Application of Companies Act 2006) Regulations 2008, the profit and loss account has not been delivered to the Registrar of Companies.';
  }
  return 'These financial statements have been prepared and delivered in accordance with the provisions applicable to companies subject to the small companies regime. As permitted by section 444 of the Companies Act 2006, the profit and loss account and the directors&apos; report have not been delivered to the Registrar of Companies.';
}

function boardWord(entity: string): string {
  if (entity === 'llp') return 'members';
  if (entity === 'charity' || entity === 'trust') return 'trustees';
  if (entity === 'sole_trader') return 'proprietor';
  if (entity === 'partnership') return 'partners';
  return 'board';
}

function uk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
