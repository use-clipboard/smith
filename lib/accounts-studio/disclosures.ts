// Accounts Studio — generate disclosure notes driven by real data.
//
// One builder used in two places:
//   • at engagement creation, with statements = null → note SHELLS with
//     placeholders (no fabricated figures);
//   • after a trial balance is imported → notes with the client's REAL numbers
//     baked in, and the correct set selected for the entity + size + framework.
//
// Figures are pulled from the structured statements' balance-sheet ledger
// groups by keyword, so they follow whatever chart of accounts the book uses.

import type { EntityType, DisclosureSection, SectionStatus } from '@/components/features/accounts-studio/types';
import type { FinancialStatements, StmtGroup, StudioSize } from '@/lib/accounts-studio/statements';

export interface DisclosureContext {
  entityType: EntityType;
  size: StudioSize;
  framework: string;
  statements: FinancialStatements | null;
  /** Prior-year label for comparatives, e.g. "2025". Empty when none. */
  priorYear: string;
  /** Director/member names from Companies House, when linked. */
  directors?: string[];
}

// ── Figure helpers ───────────────────────────────────────────────────────────
function whole(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
}

/** Sum the ledger groups whose title matches any keyword. Null if none match. */
function findGroup(groups: StmtGroup[], keywords: string[]): { current: number; prior: number | null } | null {
  const hits = groups.filter(g => keywords.some(k => g.title.toLowerCase().includes(k)));
  if (!hits.length) return null;
  const current = hits.reduce((s, g) => s + g.total, 0);
  const anyPrior = hits.some(g => g.totalPrior !== null);
  const prior = anyPrior ? hits.reduce((s, g) => s + (g.totalPrior ?? 0), 0) : null;
  return { current, prior };
}

/** "£X (2025: £Y)" for a real figure, or a "£[ ]" placeholder pre-import. */
function fig(ctx: DisclosureContext, groups: StmtGroup[] | undefined, keywords: string[], sign: 1 | -1 = 1): string | null {
  if (!ctx.statements || !groups) return null; // caller decides placeholder
  const g = findGroup(groups, keywords);
  if (!g) return null;
  const cur = whole(sign * g.current);
  if (g.prior !== null && ctx.priorYear) return `${cur} (${ctx.priorYear}: ${whole(sign * g.prior)})`;
  return cur;
}

const PH = '£[ ]'; // placeholder shown before import / when not derivable

// ── Note tables (sub-analysis with comparatives) ─────────────────────────────
interface NoteLine { label: string; current: number; prior: number | null }
/** Collect individual account lines from BS groups whose group/line matches a keyword (empty = all). */
function collectLines(groups: StmtGroup[] | undefined, keywords: string[]): NoteLine[] {
  const out: NoteLine[] = [];
  for (const g of groups ?? []) {
    for (const l of g.lines) {
      const s = `${g.title} ${l.label}`.toLowerCase();
      if (keywords.length === 0 || keywords.some(k => s.includes(k))) out.push({ label: l.label, current: l.current, prior: l.prior });
    }
  }
  return out;
}
const num0 = (n: number) => Math.round(n).toLocaleString('en-GB');
/** A note sub-analysis table (Account | £ | prior £) with a Total row. */
function noteTableHtml(lines: NoteLine[], hasPrior: boolean, priorYear: string): string {
  const total = lines.reduce((s, l) => s + l.current, 0);
  const totalPrior = hasPrior ? lines.reduce((s, l) => s + (l.prior ?? 0), 0) : 0;
  const head = `<tr><td></td><td style="text-align:right;font-weight:600">£</td>${hasPrior ? `<td style="text-align:right;font-weight:600">${priorYear || 'Prior'} £</td>` : ''}</tr>`;
  const body = lines.map(l => `<tr><td>${l.label}</td><td style="text-align:right">${num0(l.current)}</td>${hasPrior ? `<td style="text-align:right;color:#64748b">${num0(l.prior ?? 0)}</td>` : ''}</tr>`).join('');
  const foot = `<tr><td style="font-weight:600;border-top:1px solid #cbd5e1">Total</td><td style="text-align:right;font-weight:600;border-top:1px solid #cbd5e1">${num0(total)}</td>${hasPrior ? `<td style="text-align:right;font-weight:600;border-top:1px solid #cbd5e1;color:#64748b">${num0(totalPrior)}</td>` : ''}</tr>`;
  return `<table style="width:100%;border-collapse:collapse;margin-top:6px"><tbody>${head}${body}${foot}</tbody></table>`;
}

// ── Optional notes library (user can add these via "＋ Add note") ────────────
export interface OptionalNoteTemplate { id: string; title: string; requirement: string; content: string }
export const OPTIONAL_NOTES: OptionalNoteTemplate[] = [
  // Report sections — auto-seeded into new engagements; offered here so they can
  // also be added to older engagements created before they existed.
  {
    id: 'directors-report', title: "Directors' Report",
    requirement: 'Principal activity, directors and statement of responsibilities.',
    content: `<h3>Director's report</h3><p>The director presents their annual report and the financial statements for the year then ended.</p><p><strong>Principal activity.</strong> The principal activity of the company during the financial year is set out below — please confirm.</p><p><strong>Director.</strong> The director who served the company during the year is set out below — please confirm.</p><p><strong>Statement of director's responsibilities.</strong> The director is responsible for preparing the report and the financial statements in accordance with applicable law and United Kingdom Generally Accepted Accounting Practice.</p><p>Company law requires the director to prepare financial statements for each financial year which give a true and fair view of the state of affairs of the company and of its profit or loss for that period. In preparing these financial statements the director is required to select suitable accounting policies and apply them consistently; make judgements and accounting estimates that are reasonable and prudent; and prepare the financial statements on the going concern basis unless it is inappropriate to presume that the company will continue in business.</p><p>The director is responsible for keeping adequate accounting records that are sufficient to show and explain the company's transactions and disclose with reasonable accuracy at any time the financial position of the company, and to enable them to ensure that the financial statements comply with the Companies Act 2006. They are also responsible for safeguarding the assets of the company and hence for taking reasonable steps for the prevention and detection of fraud and other irregularities.</p>`,
  },
  {
    id: 'accountants-report', title: "Accountants' Report",
    requirement: 'Report of the reporting accountants on the unaudited financial statements.',
    content: `<h3>Accountants' report to the board of directors</h3><p>In order to assist you to fulfil your duties under the Companies Act 2006, we have prepared for your approval the financial statements which comprise the Income Statement, the Statement of Financial Position and the related notes from the accounting records and the information and explanations you have given to us.</p><p>This report is made solely to the board of directors, in accordance with the terms of our engagement letter. Our work has been undertaken so that we might state to them those matters we have agreed to state to them in this report and for no other purpose.</p><p>We have not been instructed to carry out an audit or a review of the financial statements and consequently we express no opinion on them.</p>`,
  },
  {
    id: 'balance-sheet-statements', title: 'Balance Sheet Statements',
    requirement: 'Audit-exemption and responsibility statements shown on the balance sheet.',
    content: `<p>For the financial year the company was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies.</p><p>Director's responsibilities:</p><p>1. The members have not required the company to obtain an audit of its accounts for the year in question in accordance with section 476.</p><p>2. The director acknowledges their responsibilities for complying with the requirements of the Companies Act 2006 with respect to accounting records and the preparation of accounts.</p><p>These financial statements have been prepared in accordance with the provisions applicable to companies subject to the small companies regime.</p>`,
  },
  // Standard notes that are auto-seeded into new engagements — offered here so
  // an older engagement missing one can add it (the picker hides any already present).
  { id: 'employees', title: 'Employees', requirement: 'Average number of employees during the period.', content: `<h3>Employees</h3><p>The average number of persons employed by the company during the year was [ ] (prior year: [ ]).</p>` },
  { id: 'taxation', title: 'Taxation', requirement: 'Tax charge on the profit for the year.', content: `<h3>Tax on profit on ordinary activities</h3><p>The tax charge on the profit on ordinary activities for the year was £[ ].</p>` },
  { id: 'reserves', title: 'Profit and Loss Account', requirement: 'Movement on the profit and loss account reserve.', content: `<h3>Profit and loss account</h3><p>Balance brought forward £[ ]; profit for the financial year £[ ]; dividends paid £[ ]; balance carried forward £[ ].</p>` },
  { id: 'going-concern', title: 'Going Concern', requirement: 'Basis for the going concern assumption.', content: `<h3>Going concern</h3><p>Based on the current financial position and forecasts, the directors have a reasonable expectation that the company has adequate resources to continue in operational existence for the foreseeable future. Accordingly the going concern basis has been adopted.</p>` },
  { id: 'dividends', title: 'Dividends', requirement: 'Dividends declared and paid in the period.', content: `<h3>Dividends</h3><p>Dividends of £[ ] were declared and paid during the year.</p>` },
  { id: 'government-grants', title: 'Government Grants', requirement: 'Grants recognised and any conditions attaching.', content: `<h3>Government grants</h3><p>Government grants of £[ ] were recognised in the period.</p>` },
  { id: 'pensions', title: 'Pension Commitments', requirement: 'Defined contribution pension costs and outstanding contributions.', content: `<h3>Pension commitments</h3><p>The company operates a defined contribution pension scheme. The pension charge for the year was £[ ].</p>` },
  { id: 'operating-leases', title: 'Operating Lease Commitments', requirement: 'Future minimum lease payments under non-cancellable operating leases.', content: `<h3>Operating lease commitments</h3><p>Total future minimum lease payments under non-cancellable operating leases were £[ ].</p>` },
  { id: 'post-bs-events', title: 'Events after the Reporting Date', requirement: 'Adjusting and non-adjusting events after the balance sheet date.', content: `<h3>Events after the reporting date</h3><p>There were no material events after the reporting date requiring disclosure — please confirm.</p>` },
  { id: 'audit-exemption', title: 'Audit Exemption', requirement: "Directors' statement claiming exemption from audit.", content: `<h3>Audit exemption</h3><p>For the year in question the company was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies, and the members have not required an audit.</p>` },
  { id: 'controlling-party', title: 'Controlling Party', requirement: 'Ultimate controlling party, where applicable.', content: `<h3>Controlling party</h3><p>The company was under the control of [ ] throughout the current and previous year.</p>` },
];

/** Turn an optional-note template into a fresh disclosure section. */
export function makeOptionalNote(t: OptionalNoteTemplate): DisclosureSection {
  return {
    id: t.id, title: t.title, status: 'needs-review', requirement: t.requirement,
    content: t.content, history: [{ id: 'v1', label: 'Added', at: nowStamp(), content: t.content }],
    included: true,
  };
}

// ── Note definitions ─────────────────────────────────────────────────────────
interface NoteDef {
  id: string;
  title: string;
  requirement: string;
  priorYearContent?: string;
  applies: (ctx: DisclosureContext) => boolean;
  build: (ctx: DisclosureContext) => { content: string; status: SectionStatus };
}

const isCompany = (e: EntityType) => e === 'limited_company' || e === 'cic' || e === 'dormant_company';
const isMicro = (ctx: DisclosureContext) => ctx.size === 'micro';

// ── Report prose (seeded as editable sections) ───────────────────────────────
// The full statutory wording lives here (not in the PDF builder) so the user can
// edit every word in the Notes & Disclosures step. Entity-aware (director vs
// member, company vs LLP).

function directorsReportHtml(ctx: DisclosureContext, isLlp: boolean): string {
  const officer = isLlp ? 'members' : 'director';
  const Officer = isLlp ? 'Members' : 'Director';
  const entity = isLlp ? 'LLP' : 'company';
  const dirs = (ctx.directors ?? []).filter(Boolean);
  const many = dirs.length > 1;
  const served = dirs.length
    ? `<p>The ${officer}${many ? '' : ''} who served the ${entity} during the year ${many || isLlp ? 'were' : 'was'} as follows:</p><p>${dirs.join('<br>')}</p>`
    : `<p>The ${officer} who served the ${entity} during the year ${isLlp ? 'are' : 'is'} set out below — please confirm.</p>`;
  return `<h3>${isLlp ? "Members' report" : "Director's report"}</h3>`
    + `<p>The ${officer} present${many || isLlp ? '' : 's'} ${isLlp ? 'their' : 'their'} annual report and the financial statements for the year then ended.</p>`
    + `<p><strong>Principal activity.</strong> The principal activity of the ${entity} during the financial year is set out below — please confirm.</p>`
    + `<p><strong>${Officer}${isLlp ? '' : ''}.</strong></p>${served}`
    + `<p><strong>Statement of ${officer}' responsibilities.</strong> The ${officer} ${isLlp ? 'are' : 'is'} responsible for preparing the report and the financial statements in accordance with applicable law and United Kingdom Generally Accepted Accounting Practice.</p>`
    + `<p>Company law requires the ${officer} to prepare financial statements for each financial year which give a true and fair view of the state of affairs of the ${entity} and of its profit or loss for that period. In preparing these financial statements the ${officer} ${isLlp ? 'are' : 'is'} required to select suitable accounting policies and apply them consistently; make judgements and accounting estimates that are reasonable and prudent; and prepare the financial statements on the going concern basis unless it is inappropriate to presume that the ${entity} will continue in business.</p>`
    + `<p>The ${officer} ${isLlp ? 'are' : 'is'} responsible for keeping adequate accounting records that are sufficient to show and explain the ${entity}'s transactions and disclose with reasonable accuracy at any time the financial position of the ${entity}, and to enable them to ensure that the financial statements comply with the Companies Act 2006. They are also responsible for safeguarding the assets of the ${entity} and hence for taking reasonable steps for the prevention and detection of fraud and other irregularities.</p>`;
}

function accountantsReportHtml(ctx: DisclosureContext): string {
  const isLlp = ctx.entityType === 'llp';
  const officer = isLlp ? 'members' : 'board of directors';
  return `<h3>Accountants' report to the ${officer}</h3>`
    + `<p>In order to assist you to fulfil your duties under the Companies Act 2006, we have prepared for your approval the financial statements which comprise the Income Statement, the Statement of Financial Position and the related notes from the accounting records and the information and explanations you have given to us.</p>`
    + `<p>This report is made solely to the ${officer}, in accordance with the terms of our engagement letter. Our work has been undertaken so that we might state to the ${officer} those matters we have agreed to state to them in this report and for no other purpose.</p>`
    + `<p>We have not been instructed to carry out an audit or a review of the financial statements and consequently we express no opinion on them.</p>`;
}

function balanceSheetStatementsHtml(ctx: DisclosureContext): string {
  const isLlp = ctx.entityType === 'llp';
  const officer = isLlp ? 'members' : 'director';
  const entity = isLlp ? 'LLP' : 'company';
  return `<p>For the financial year the ${entity} was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies.</p>`
    + `<p>${isLlp ? 'Members' : "Director"}' responsibilities:</p>`
    + `<p>1. The members have not required the ${entity} to obtain an audit of its accounts for the year in question in accordance with section 476.</p>`
    + `<p>2. The ${officer} acknowledge${isLlp ? '' : 's'} their responsibilities for complying with the requirements of the Companies Act 2006 with respect to accounting records and the preparation of accounts.</p>`
    + `<p>These financial statements have been prepared in accordance with the provisions applicable to ${isLlp ? 'LLPs subject to the small LLPs regime' : 'companies subject to the small companies regime'}.</p>`;
}

const NOTE_DEFS: NoteDef[] = [
  {
    id: 'policies', title: 'Accounting Policies',
    requirement: 'Basis of preparation and the specific policies applied to material balances.',
    applies: () => true,
    build: ctx => isMicro(ctx)
      ? ({
          // Micro-entity accounts need only a basis-of-preparation statement.
          status: 'complete',
          content: `<h3>Basis of preparation</h3><p>These financial statements have been prepared in accordance with the micro-entity provisions of FRS 105 "The Financial Reporting Standard applicable to the Micro-entities Regime" and the Companies Act 2006, under the historical cost convention.</p>`,
        })
      : ({
          status: 'complete',
          content: `<h3>Accounting policies</h3>`
            + `<p><strong>Basis of preparation.</strong> These financial statements have been prepared in accordance with ${ctx.framework} and the Companies Act 2006, under the historical cost convention.</p>`
            + `<p><strong>Turnover.</strong> Turnover represents amounts receivable for goods and services net of VAT and trade discounts, recognised in the period in which the goods or services are provided.</p>`
            + `<p><strong>Tangible fixed assets.</strong> Tangible fixed assets are stated at cost less accumulated depreciation. Depreciation is provided to write off the cost less estimated residual value of each asset over its expected useful life.</p>`,
        }),
  },
  {
    id: 'directors-report', title: "Directors' Report",
    requirement: 'Principal activity, results, dividends and directors who served in the period.',
    applies: ctx => isCompany(ctx.entityType),
    build: ctx => ({ status: 'needs-review', content: directorsReportHtml(ctx, false) }),
  },
  {
    id: 'accountants-report', title: "Accountants' Report",
    requirement: 'Report of the reporting accountants on the unaudited financial statements.',
    applies: ctx => isCompany(ctx.entityType) || ctx.entityType === 'llp',
    build: ctx => ({ status: 'needs-review', content: accountantsReportHtml(ctx) }),
  },
  {
    id: 'balance-sheet-statements', title: 'Balance Sheet Statements',
    requirement: 'Audit-exemption and responsibility statements shown on the balance sheet.',
    applies: ctx => isCompany(ctx.entityType) || ctx.entityType === 'llp',
    build: ctx => ({ status: 'needs-review', content: balanceSheetStatementsHtml(ctx) }),
  },
  {
    id: 'strategic-report', title: 'Strategic Report',
    requirement: 'Fair review of the business and description of principal risks (medium+ companies).',
    applies: ctx => isCompany(ctx.entityType) && (ctx.size === 'medium' || ctx.size === 'large'),
    build: () => ({
      status: 'needs-review',
      content: `<h3>Strategic report</h3><p>The directors present their strategic report for the year. A fair review of the business, its performance and the principal risks and uncertainties should be set out here.</p>`,
    }),
  },
  {
    id: 'members-report', title: "Members' Report",
    requirement: "Designated members and members' interests for an LLP.",
    applies: ctx => ctx.entityType === 'llp',
    build: ctx => ({ status: 'needs-review', content: directorsReportHtml(ctx, true) }),
  },
  {
    id: 'employees', title: 'Employees',
    requirement: 'Average monthly number of employees during the period.',
    applies: ctx => !isMicro(ctx),
    build: ctx => ({
      status: 'needs-review',
      content: `<h3>Employees</h3><p>The average monthly number of employees during the year was ${PH}${ctx.priorYear ? ` (${ctx.priorYear}: ${PH})` : ''}.</p>`,
    }),
  },
  {
    id: 'taxation', title: 'Taxation',
    requirement: 'Analysis of the tax charge on the profit for the year.',
    applies: ctx => !isMicro(ctx),
    build: ctx => {
      const lines = collectLines(ctx.statements?.profitLoss.taxation, []);
      if (lines.length) {
        return {
          status: 'complete',
          content: `<h3>Tax on profit on ordinary activities</h3><p>Analysis of the tax charge for the year:</p>${noteTableHtml(lines, ctx.statements!.hasPrior, ctx.priorYear)}`,
        };
      }
      const t = fig(ctx, ctx.statements?.profitLoss.taxation, ['tax', 'corporation']);
      return {
        status: t ? 'complete' : 'needs-review',
        content: `<h3>Tax on profit on ordinary activities</h3><p>The tax charge on the profit on ordinary activities for the year was ${t ?? PH}.</p>`,
      };
    },
  },
  {
    id: 'fixed-assets', title: 'Fixed Assets',
    requirement: 'Cost, additions, depreciation and net book value by class of asset.',
    applies: ctx => !isMicro(ctx),
    build: ctx => {
      const lines = collectLines(ctx.statements?.balanceSheet.fixedAssets, []);
      if (lines.length) {
        return {
          status: 'complete',
          content: `<h3>Fixed assets</h3><p>Net book value by class of asset:</p>${noteTableHtml(lines, ctx.statements!.hasPrior, ctx.priorYear)}`
            + `<p style="font-size:12px;color:#64748b;margin-top:8px">A full movement schedule (cost, additions, disposals and depreciation charge) should be completed before filing.</p>`,
        };
      }
      const nbv = fig(ctx, ctx.statements?.balanceSheet.fixedAssets, ['fixed asset', 'tangible', 'plant', 'equipment', 'fixtures', 'motor', 'property']);
      return {
        status: nbv ? 'complete' : 'needs-review',
        content: `<h3>Tangible fixed assets</h3><p>The net book value of tangible fixed assets at the year end was ${nbv ?? PH}. A full movement note (cost, additions, disposals and depreciation) should be completed for the accounts.</p>`,
      };
    },
  },
  {
    id: 'debtors', title: 'Debtors',
    requirement: 'Amounts falling due within and after more than one year.',
    applies: ctx => !isMicro(ctx),
    build: ctx => {
      const lines = collectLines(ctx.statements?.balanceSheet.currentAssets, ['debtor', 'receivable', 'prepay', 'accrued income']);
      if (lines.length) {
        return {
          status: 'complete',
          content: `<h3>Debtors</h3><p>Amounts falling due within one year:</p>${noteTableHtml(lines, ctx.statements!.hasPrior, ctx.priorYear)}`,
        };
      }
      const d = fig(ctx, ctx.statements?.balanceSheet.currentAssets, ['debtor', 'receivable', 'prepay']);
      return {
        status: d ? 'complete' : 'needs-review',
        content: `<h3>Debtors</h3><p>Debtors — amounts falling due within one year — totalled ${d ?? PH} at the balance sheet date.</p>`,
      };
    },
  },
  {
    id: 'creditors', title: 'Creditors',
    requirement: 'Amounts falling due within and after more than one year, including tax and VAT.',
    applies: ctx => !isMicro(ctx),
    build: ctx => {
      const within = collectLines(ctx.statements?.balanceSheet.creditorsWithin, []);
      const after = collectLines(ctx.statements?.balanceSheet.creditorsAfter, []);
      if (within.length || after.length) {
        const hasPrior = ctx.statements!.hasPrior;
        let html = `<h3>Creditors</h3>`;
        if (within.length) html += `<p>Amounts falling due within one year:</p>${noteTableHtml(within, hasPrior, ctx.priorYear)}`;
        if (after.length) html += `<p style="margin-top:10px">Amounts falling due after more than one year:</p>${noteTableHtml(after, hasPrior, ctx.priorYear)}`;
        return { status: 'complete', content: html };
      }
      const c = fig(ctx, ctx.statements?.balanceSheet.creditorsWithin, ['creditor', 'payable', 'tax', 'vat', 'loan', 'accrual']);
      return {
        status: c ? 'complete' : 'needs-review',
        content: `<h3>Creditors</h3><p>Creditors — amounts falling due within one year — totalled ${c ?? PH} at the balance sheet date, including taxation and social security.</p>`,
      };
    },
  },
  {
    id: 'related-parties', title: 'Related Parties',
    requirement: 'Transactions with directors and other related parties, including loan balances.',
    applies: ctx => !isMicro(ctx),
    build: () => ({
      status: 'needs-review',
      content: `<h3>Related party transactions</h3><p>Details of any transactions with directors and other related parties, including any loan balances and the terms on which they arose, should be set out here.</p>`,
    }),
  },
  {
    // Micro-entity footnote (FRS 105) — advances, credit and guarantees to directors.
    id: 'micro-directors', title: "Directors' Advances & Guarantees",
    requirement: 'Advances, credit and guarantees granted to directors (micro-entity footnote).',
    applies: ctx => isMicro(ctx) && isCompany(ctx.entityType),
    build: () => ({
      status: 'needs-review',
      content: `<h3>Advances, credit and guarantees granted to directors</h3><p>There were no advances, credits or guarantees granted to the directors during the year — please confirm, or set out the details required by section 413 of the Companies Act 2006.</p>`,
    }),
  },
  {
    // Micro-entity footnote (FRS 105) — guarantees and other financial commitments.
    id: 'micro-commitments', title: 'Financial Commitments',
    requirement: 'Guarantees and other financial commitments (micro-entity footnote).',
    applies: ctx => isMicro(ctx),
    build: () => ({
      status: 'needs-review',
      content: `<h3>Guarantees and other financial commitments</h3><p>The total amount of financial commitments, guarantees and contingencies not included in the balance sheet was £nil — please confirm.</p>`,
    }),
  },
  {
    id: 'share-capital', title: 'Share Capital',
    requirement: 'Allotted, called up and fully paid share capital.',
    applies: ctx => isCompany(ctx.entityType) && !isMicro(ctx),
    build: ctx => {
      const sc = fig(ctx, ctx.statements?.balanceSheet.capitalAndReserves, ['share capital', 'called up', 'ordinary']);
      return {
        status: sc ? 'complete' : 'needs-review',
        content: `<h3>Share capital</h3><p>Allotted, called up and fully paid share capital at the year end was ${sc ?? PH}.</p>`,
      };
    },
  },
  {
    id: 'reserves', title: 'Profit and Loss Account',
    requirement: 'Movement on the profit and loss account reserve, including profit and distributions.',
    applies: ctx => isCompany(ctx.entityType) && !isMicro(ctx),
    build: ctx => {
      const pl = ctx.statements?.profitLoss;
      const bs = ctx.statements?.balanceSheet;
      if (!pl || !bs) {
        return { status: 'needs-review', content: `<h3>Profit and loss account</h3><p>The movement on the profit and loss account reserve, including the profit for the year and any dividends, should be set out here.</p>` };
      }
      // Closing reserve = any retained-earnings ledger from the trial balance +
      // the year's profit. This mirrors the balance sheet's single P&L-account
      // line, so the note's carried-forward figure agrees with the statement.
      const hasPrior = ctx.statements!.hasPrior;
      const retained = findGroup(bs.capitalAndReserves, ['profit and loss', 'retained', 'p&l', 'accumulated']);
      const retCur = retained ? retained.current : 0;
      const retPrior = retained && retained.prior !== null ? retained.prior : 0;
      const profit = bs.profitForYear;
      const cfwd = retCur + profit;
      const bfwd = hasPrior ? retPrior + (bs.profitForYearPrior ?? 0) : null;
      const rows: string[] = [];
      if (bfwd !== null) rows.push(`<tr><td>Balance brought forward</td><td style="text-align:right">${num0(bfwd)}</td></tr>`);
      rows.push(`<tr><td>Profit for the financial year</td><td style="text-align:right">${num0(profit)}</td></tr>`);
      // Distributions reconstructed as the balancing figure when both ends known.
      if (bfwd !== null) {
        const dividends = bfwd + profit - cfwd;
        if (Math.abs(dividends) >= 1) rows.push(`<tr><td>Dividends paid</td><td style="text-align:right">(${num0(Math.abs(dividends))})</td></tr>`);
      }
      rows.push(`<tr><td style="font-weight:600;border-top:1px solid #cbd5e1">Balance carried forward</td><td style="text-align:right;font-weight:600;border-top:1px solid #cbd5e1">${num0(cfwd)}</td></tr>`);
      return {
        status: 'complete',
        content: `<h3>Profit and loss account</h3><table style="width:100%;border-collapse:collapse;margin-top:6px"><tbody>${rows.join('')}</tbody></table>`,
      };
    },
  },
  {
    id: 'going-concern', title: 'Going Concern',
    requirement: 'Basis for the going concern assumption and any material uncertainties.',
    applies: ctx => !isMicro(ctx),
    build: () => ({
      status: 'complete',
      content: `<h3>Going concern</h3><p>Based on the current financial position and forecasts, the directors have a reasonable expectation that the company has adequate resources to continue in operational existence for the foreseeable future. Accordingly the going concern basis has been adopted.</p>`,
    }),
  },
  {
    id: 'financial-instruments', title: 'Financial Instruments',
    requirement: 'Basic financial instruments measured at amortised cost.',
    applies: ctx => !isMicro(ctx),
    build: () => ({ status: 'complete', content: `<h3>Financial instruments</h3><p>The company holds only basic financial instruments, measured at amortised cost.</p>` }),
  },
  {
    id: 'commitments', title: 'Commitments',
    requirement: 'Capital and other financial commitments not provided for.',
    applies: ctx => !isMicro(ctx),
    build: () => ({ status: 'needs-review', content: `<h3>Commitments</h3><p>Any capital commitments and future minimum lease payments under non-cancellable operating leases should be disclosed here.</p>` }),
  },
  {
    id: 'contingencies', title: 'Contingencies',
    requirement: 'Contingent liabilities and assets not recognised in the balance sheet.',
    applies: ctx => !isMicro(ctx),
    build: () => ({ status: 'complete', content: `<h3>Contingent liabilities</h3><p>There were no contingent liabilities at the balance sheet date.</p>` }),
  },
  {
    id: 'events', title: 'Events after Year End',
    requirement: 'Adjusting and non-adjusting events between the year end and approval.',
    applies: ctx => !isMicro(ctx),
    build: () => ({ status: 'missing', content: '' }),
  },
  {
    id: 'charity', title: 'Charity Disclosures',
    requirement: 'SORP-compliant fund accounting, trustees and public benefit statement.',
    applies: ctx => ctx.entityType === 'charity',
    build: () => ({ status: 'needs-review', content: `<h3>Charity disclosures</h3><p>The accounts are prepared in accordance with the Charities SORP (FRS 102). Funds are analysed between unrestricted, restricted and endowment funds, with a public benefit statement and trustee information to follow.</p>` }),
  },
  {
    id: 'llp', title: 'LLP Disclosures',
    requirement: "Members' remuneration, capital and division of profits under the LLP SORP.",
    applies: ctx => ctx.entityType === 'llp',
    build: () => ({ status: 'needs-review', content: `<h3>LLP disclosures</h3><p>Members' remuneration and the division of profits are presented in accordance with the LLP SORP.</p>` }),
  },
  {
    id: 'trust', title: 'Trust Disclosures',
    requirement: 'Trustee information, beneficiary classes and trust income treatment.',
    applies: ctx => ctx.entityType === 'trust',
    build: () => ({ status: 'needs-review', content: `<h3>Trust disclosures</h3><p>Disclosures relating to the trust, its trustees and beneficiaries should be set out here.</p>` }),
  },
];

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Build the disclosure set for a context. */
export function buildDisclosures(ctx: DisclosureContext): DisclosureSection[] {
  const label = ctx.statements ? 'Auto-drafted from ledger' : 'Draft';
  return NOTE_DEFS.filter(def => def.applies(ctx)).map(def => {
    const { content, status } = def.build(ctx);
    return {
      id: def.id,
      title: def.title,
      status,
      requirement: def.requirement,
      content,
      priorYearContent: def.priorYearContent,
      history: content ? [{ id: 'v1', label, at: nowStamp(), content }] : [],
    };
  });
}
