// Accounts Studio — rule-driven disclosure engine.
//
// One table of note RULES drives everything. Each rule declares which frameworks
// and entity types it applies to, whether it's mandatory / conditional / optional,
// and (for conditional rules) a data trigger evaluated against the trial balance.
// Three views derive from that one table:
//   • buildDisclosures(ctx)  — the SEEDED set (mandatory + triggered-conditional)
//   • addableNotes(ctx, ids) — the "＋ Add note" library (anything applicable & not present)
//   • expectedNotes(ctx)     — what SHOULD be present (used by the missing-note check)
//
// Figures are pulled from the structured statements' ledger groups by keyword, so
// they follow whatever chart of accounts the book uses.

import type { EntityType, DisclosureSection, SectionStatus, NoteLevel } from '@/components/features/accounts-studio/types';
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

// ── Framework tier + entity groups ───────────────────────────────────────────
export type FrameworkTier = 'frs105' | 'frs102-1a' | 'frs102-full' | 'ifrs';

/** Map the engagement's framework string (+ size fallback) to a tier. */
export function frameworkTier(ctx: DisclosureContext): FrameworkTier {
  const f = (ctx.framework || '').toLowerCase();
  if (f.includes('105') || (!f && ctx.size === 'micro')) return 'frs105';
  if (f.includes('ifrs')) return 'ifrs';
  if (f.includes('1a')) return 'frs102-1a';
  if (f.includes('102')) return 'frs102-full';
  // Fall back on the detected size.
  if (ctx.size === 'micro') return 'frs105';
  if (ctx.size === 'small') return 'frs102-1a';
  return 'frs102-full';
}

const COMPANIES: EntityType[] = ['limited_company', 'cic', 'dormant_company'];
const COMPANIES_LLP: EntityType[] = [...COMPANIES, 'llp'];
const PARTNERSHIPS: EntityType[] = ['partnership'];
const PARTNERSHIP_LLP: EntityType[] = ['partnership', 'llp'];
const SOLE: EntityType[] = ['sole_trader'];
const T_MICRO: FrameworkTier[] = ['frs105'];
const T_NONMICRO: FrameworkTier[] = ['frs102-1a', 'frs102-full'];
const T_ALL_FRS: FrameworkTier[] = ['frs105', 'frs102-1a', 'frs102-full'];
const T_SMALL_MICRO: FrameworkTier[] = ['frs105', 'frs102-1a'];

// ── Conditional data triggers (evaluated against the trial balance) ──────────
const material = (n?: number | null) => n != null && Math.abs(n) >= 1;
const titleMatch = (groups: StmtGroup[] | undefined, re: RegExp) =>
  (groups ?? []).some(g => re.test(g.title) || g.lines.some(l => re.test(l.label)));

const tHasFixed = (ctx: DisclosureContext) => material(ctx.statements?.balanceSheet.fixedAssetsTotal);
const tHasDebtors = (ctx: DisclosureContext) => titleMatch(ctx.statements?.balanceSheet.currentAssets, /debtor|receivable|prepay|accrued income/i);
const tHasCreditors = (ctx: DisclosureContext) => material(ctx.statements?.balanceSheet.creditorsWithinTotal) || material(ctx.statements?.balanceSheet.creditorsAfterTotal);
const tHasShareCapital = (ctx: DisclosureContext) => titleMatch(ctx.statements?.balanceSheet.capitalAndReserves, /share capital|called up|ordinary/i);
const tHasReserves = (ctx: DisclosureContext) => material(ctx.statements?.balanceSheet.profitForYear) || titleMatch(ctx.statements?.balanceSheet.capitalAndReserves, /profit and loss|retained|reserve|p&l|accumulated/i);
const tHasTax = (ctx: DisclosureContext) => (ctx.statements?.profitLoss.taxation.length ?? 0) > 0 || titleMatch(ctx.statements?.balanceSheet.creditorsWithin, /\btax\b|corporation|\bvat\b|paye/i);
const tHasDirectorBalance = (ctx: DisclosureContext) => {
  const bs = ctx.statements?.balanceSheet;
  if (!bs) return false;
  return [...bs.creditorsWithin, ...bs.creditorsAfter, ...bs.currentAssets]
    .some(g => `${g.title} ${g.lines.map(l => l.label).join(' ')}`.toLowerCase().includes('director'));
};
const tHasPartnerLoan = (ctx: DisclosureContext) => {
  const bs = ctx.statements?.balanceSheet;
  if (!bs) return false;
  return [...bs.creditorsWithin, ...bs.creditorsAfter, ...bs.currentAssets].some(g => {
    const s = `${g.title} ${g.lines.map(l => l.label).join(' ')}`.toLowerCase();
    return /partner|member/.test(s) && /loan/.test(s);
  });
};

const isLlpEntity = (e: EntityType) => e === 'llp';

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
    ? `<p>The ${officer} who served the ${entity} during the year ${many || isLlp ? 'were' : 'was'} as follows:</p><p>${dirs.join('<br>')}</p>`
    : `<p>The ${officer} who served the ${entity} during the year ${isLlp ? 'are' : 'is'} set out below — please confirm.</p>`;
  return `<h3>${isLlp ? "Members' report" : "Director's report"}</h3>`
    + `<p>The ${officer} present${many || isLlp ? '' : 's'} their annual report and the financial statements for the year then ended.</p>`
    + `<p><strong>Principal activity.</strong> The principal activity of the ${entity} during the financial year is set out below — please confirm.</p>`
    + `<p><strong>${Officer}.</strong></p>${served}`
    + `<p><strong>Statement of ${officer}' responsibilities.</strong> The ${officer} ${isLlp ? 'are' : 'is'} responsible for preparing the report and the financial statements in accordance with applicable law and United Kingdom Generally Accepted Accounting Practice.</p>`
    + `<p>Company law requires the ${officer} to prepare financial statements for each financial year which give a true and fair view of the state of affairs of the ${entity} and of its profit or loss for that period. In preparing these financial statements the ${officer} ${isLlp ? 'are' : 'is'} required to select suitable accounting policies and apply them consistently; make judgements and accounting estimates that are reasonable and prudent; and prepare the financial statements on the going concern basis unless it is inappropriate to presume that the ${entity} will continue in business.</p>`
    + `<p>The ${officer} ${isLlp ? 'are' : 'is'} responsible for keeping adequate accounting records that are sufficient to show and explain the ${entity}'s transactions and disclose with reasonable accuracy at any time the financial position of the ${entity}, and to enable them to ensure that the financial statements comply with the Companies Act 2006. They are also responsible for safeguarding the assets of the ${entity} and hence for taking reasonable steps for the prevention and detection of fraud and other irregularities.</p>`;
}

function accountantsReportHtml(ctx: DisclosureContext): string {
  const e = ctx.entityType;
  const officer = e === 'sole_trader' ? 'proprietor' : e === 'partnership' ? 'partners' : isLlpEntity(e) ? 'members' : 'board of directors';
  const duties = (COMPANIES.includes(e) || isLlpEntity(e)) ? 'fulfil your duties under the Companies Act 2006' : 'fulfil your reporting obligations';
  return `<h3>Accountants' report to the ${officer}</h3>`
    + `<p>In order to assist you to ${duties}, we have prepared for your approval the financial statements which comprise the Income Statement, the Statement of Financial Position and the related notes from the accounting records and the information and explanations you have given to us.</p>`
    + `<p>This report is made solely to the ${officer}, in accordance with the terms of our engagement letter. Our work has been undertaken so that we might state to the ${officer} those matters we have agreed to state to them in this report and for no other purpose.</p>`
    + `<p>We have not been instructed to carry out an audit or a review of the financial statements and consequently we express no opinion on them.</p>`;
}

function balanceSheetStatementsHtml(ctx: DisclosureContext): string {
  const isLlp = isLlpEntity(ctx.entityType);
  const officer = isLlp ? 'members' : 'director';
  const entity = isLlp ? 'LLP' : 'company';
  return `<p>For the financial year the ${entity} was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies.</p>`
    + `<p>${isLlp ? 'Members' : "Director"}' responsibilities:</p>`
    + `<p>1. The members have not required the ${entity} to obtain an audit of its accounts for the year in question in accordance with section 476.</p>`
    + `<p>2. The ${officer} acknowledge${isLlp ? '' : 's'} their responsibilities for complying with the requirements of the Companies Act 2006 with respect to accounting records and the preparation of accounts.</p>`
    + `<p>These financial statements have been prepared in accordance with the provisions applicable to ${isLlp ? 'LLPs subject to the small LLPs regime' : 'companies subject to the small companies regime'}.</p>`;
}

const staticNote = (content: string) => (): { content: string; status: SectionStatus } => ({ content, status: 'needs-review' });

// ── The rule table ───────────────────────────────────────────────────────────
export interface NoteRule {
  id: string;
  title: string;
  requirement: string;
  /** Framework tiers this note belongs to. */
  frameworks: FrameworkTier[];
  /** Entity types this note applies to (undefined = all). */
  entityTypes?: EntityType[];
  /** 'full-only' notes are dropped from filleted filing copies. */
  filing?: 'both' | 'full-only';
  /** How the note is required — a fixed level, or one that varies by context
   *  (e.g. Employees is mandatory for small companies but optional for micro). */
  level: NoteLevel | ((ctx: DisclosureContext) => NoteLevel);
  /** Data trigger for conditional notes (evaluated against the trial balance). */
  trigger?: (ctx: DisclosureContext) => boolean;
  priorYearContent?: string;
  build: (ctx: DisclosureContext) => { content: string; status: SectionStatus };
}

const NOTE_RULES: NoteRule[] = [
  // ── Reports & statutory statements ──
  {
    id: 'policies', title: 'Accounting Policies',
    requirement: 'Basis of preparation and the specific policies applied to material balances.',
    frameworks: ['frs105', 'frs102-1a', 'frs102-full', 'ifrs'], level: 'mandatory',
    build: ctx => frameworkTier(ctx) === 'frs105'
      ? ({
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
    frameworks: T_ALL_FRS, entityTypes: COMPANIES, filing: 'full-only', level: 'mandatory',
    build: ctx => ({ status: 'needs-review', content: directorsReportHtml(ctx, false) }),
  },
  {
    id: 'members-report', title: "Members' Report",
    requirement: "Designated members and members' interests for an LLP.",
    frameworks: T_ALL_FRS, entityTypes: ['llp'], filing: 'full-only', level: 'mandatory',
    build: ctx => ({ status: 'needs-review', content: directorsReportHtml(ctx, true) }),
  },
  {
    id: 'strategic-report', title: 'Strategic Report',
    requirement: 'Fair review of the business and description of principal risks (medium+ companies).',
    frameworks: ['frs102-full'], entityTypes: COMPANIES, filing: 'full-only', level: 'mandatory',
    build: staticNote(`<h3>Strategic report</h3><p>The directors present their strategic report for the year. A fair review of the business, its performance and the principal risks and uncertainties should be set out here.</p>`),
  },
  {
    id: 'accountants-report', title: "Accountants' Report",
    requirement: 'Report of the reporting accountants on the unaudited financial statements.',
    frameworks: T_SMALL_MICRO, entityTypes: [...COMPANIES_LLP, 'partnership', 'sole_trader'], level: 'mandatory',
    build: ctx => ({ status: 'needs-review', content: accountantsReportHtml(ctx) }),
  },
  {
    id: 'balance-sheet-statements', title: 'Balance Sheet Statements',
    requirement: 'Audit-exemption and responsibility statements shown on the balance sheet.',
    frameworks: T_SMALL_MICRO, entityTypes: COMPANIES_LLP, level: 'mandatory',
    build: ctx => ({ status: 'needs-review', content: balanceSheetStatementsHtml(ctx) }),
  },

  // ── Standard notes ──
  {
    id: 'employees', title: 'Employees',
    requirement: 'Average number of employees during the period.',
    // Required for small companies; optional for micro-entities and sole traders.
    frameworks: T_ALL_FRS, level: ctx => (frameworkTier(ctx) === 'frs105' || ctx.entityType === 'sole_trader') ? 'optional' : 'mandatory',
    build: ctx => ({
      status: 'needs-review',
      content: `<h3>Employees</h3><p>The average number of employees during the year was [ ]${ctx.priorYear ? ` (${ctx.priorYear}: [ ])` : ''}.</p>`,
    }),
  },
  {
    id: 'taxation', title: 'Taxation',
    requirement: 'Analysis of the tax charge on the profit for the year.',
    frameworks: T_NONMICRO, entityTypes: COMPANIES, level: 'conditional', trigger: tHasTax,
    build: ctx => {
      const lines = collectLines(ctx.statements?.profitLoss.taxation, []);
      if (lines.length) {
        return { status: 'complete', content: `<h3>Tax on profit on ordinary activities</h3><p>Analysis of the tax charge for the year:</p>${noteTableHtml(lines, ctx.statements!.hasPrior, ctx.priorYear)}` };
      }
      const t = fig(ctx, ctx.statements?.profitLoss.taxation, ['tax', 'corporation']);
      return { status: t ? 'complete' : 'needs-review', content: `<h3>Tax on profit on ordinary activities</h3><p>The tax charge on the profit on ordinary activities for the year was ${t ?? PH}.</p>` };
    },
  },
  {
    id: 'fixed-assets', title: 'Fixed Assets',
    requirement: 'Cost, additions, depreciation and net book value by class of asset.',
    frameworks: T_ALL_FRS, level: 'conditional', trigger: tHasFixed,
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
      return { status: nbv ? 'complete' : 'needs-review', content: `<h3>Tangible fixed assets</h3><p>The net book value of tangible fixed assets at the year end was ${nbv ?? PH}. A full movement note (cost, additions, disposals and depreciation) should be completed for the accounts.</p>` };
    },
  },
  {
    id: 'debtors', title: 'Debtors',
    requirement: 'Amounts falling due within and after more than one year.',
    frameworks: T_NONMICRO, level: 'conditional', trigger: tHasDebtors,
    build: ctx => {
      const lines = collectLines(ctx.statements?.balanceSheet.currentAssets, ['debtor', 'receivable', 'prepay', 'accrued income']);
      if (lines.length) {
        return { status: 'complete', content: `<h3>Debtors</h3><p>Amounts falling due within one year:</p>${noteTableHtml(lines, ctx.statements!.hasPrior, ctx.priorYear)}` };
      }
      const d = fig(ctx, ctx.statements?.balanceSheet.currentAssets, ['debtor', 'receivable', 'prepay']);
      return { status: d ? 'complete' : 'needs-review', content: `<h3>Debtors</h3><p>Debtors — amounts falling due within one year — totalled ${d ?? PH} at the balance sheet date.</p>` };
    },
  },
  {
    id: 'creditors', title: 'Creditors',
    requirement: 'Amounts falling due within and after more than one year, including tax and VAT.',
    frameworks: T_NONMICRO, level: 'conditional', trigger: tHasCreditors,
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
      return { status: c ? 'complete' : 'needs-review', content: `<h3>Creditors</h3><p>Creditors — amounts falling due within one year — totalled ${c ?? PH} at the balance sheet date, including taxation and social security.</p>` };
    },
  },
  {
    id: 'share-capital', title: 'Share Capital',
    requirement: 'Allotted, called up and fully paid share capital.',
    frameworks: T_NONMICRO, entityTypes: COMPANIES, level: 'conditional', trigger: tHasShareCapital,
    build: ctx => {
      const sc = fig(ctx, ctx.statements?.balanceSheet.capitalAndReserves, ['share capital', 'called up', 'ordinary']);
      return { status: sc ? 'complete' : 'needs-review', content: `<h3>Share capital</h3><p>Allotted, called up and fully paid share capital at the year end was ${sc ?? PH}.</p>` };
    },
  },
  {
    id: 'reserves', title: 'Profit and Loss Account',
    requirement: 'Movement on the profit and loss account reserve, including profit and distributions.',
    frameworks: T_NONMICRO, entityTypes: COMPANIES, level: 'conditional', trigger: tHasReserves,
    build: ctx => {
      const pl = ctx.statements?.profitLoss;
      const bs = ctx.statements?.balanceSheet;
      if (!pl || !bs) {
        return { status: 'needs-review', content: `<h3>Profit and loss account</h3><p>The movement on the profit and loss account reserve, including the profit for the year and any dividends, should be set out here.</p>` };
      }
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
      if (bfwd !== null) {
        const dividends = bfwd + profit - cfwd;
        if (Math.abs(dividends) >= 1) rows.push(`<tr><td>Dividends paid</td><td style="text-align:right">(${num0(Math.abs(dividends))})</td></tr>`);
      }
      rows.push(`<tr><td style="font-weight:600;border-top:1px solid #cbd5e1">Balance carried forward</td><td style="text-align:right;font-weight:600;border-top:1px solid #cbd5e1">${num0(cfwd)}</td></tr>`);
      return { status: 'complete', content: `<h3>Profit and loss account</h3><table style="width:100%;border-collapse:collapse;margin-top:6px"><tbody>${rows.join('')}</tbody></table>` };
    },
  },
  {
    id: 'related-parties', title: 'Related Parties',
    requirement: 'Transactions with directors and other related parties, including loan balances.',
    frameworks: T_NONMICRO, level: 'conditional', trigger: tHasDirectorBalance,
    build: staticNote(`<h3>Related party transactions</h3><p>Details of any transactions with directors and other related parties, including any loan balances and the terms on which they arose, should be set out here.</p>`),
  },
  {
    id: 'financial-instruments', title: 'Financial Instruments',
    requirement: 'Basic financial instruments measured at amortised cost.',
    frameworks: T_NONMICRO, level: ctx => ctx.entityType === 'sole_trader' ? 'optional' : 'mandatory',
    build: () => ({ status: 'complete', content: `<h3>Financial instruments</h3><p>The company holds only basic financial instruments, measured at amortised cost.</p>` }),
  },
  {
    id: 'contingencies', title: 'Contingencies',
    requirement: 'Contingent liabilities and assets not recognised in the balance sheet.',
    frameworks: T_NONMICRO, level: ctx => ctx.entityType === 'sole_trader' ? 'optional' : 'mandatory',
    build: () => ({ status: 'complete', content: `<h3>Contingent liabilities</h3><p>There were no contingent liabilities at the balance sheet date.</p>` }),
  },

  // ── Micro-entity footnotes (FRS 105) ──
  {
    id: 'micro-directors', title: "Directors' Advances & Guarantees",
    requirement: 'Advances, credit and guarantees granted to directors (micro-entity footnote).',
    frameworks: T_MICRO, entityTypes: COMPANIES, level: 'mandatory',
    build: staticNote(`<h3>Advances, credit and guarantees granted to directors</h3><p>There were no advances, credits or guarantees granted to the directors during the year — please confirm, or set out the details required by section 413 of the Companies Act 2006.</p>`),
  },
  {
    id: 'micro-commitments', title: 'Financial Commitments',
    requirement: 'Guarantees and other financial commitments (micro-entity footnote).',
    frameworks: T_MICRO, level: 'mandatory',
    build: staticNote(`<h3>Guarantees and other financial commitments</h3><p>The total amount of financial commitments, guarantees and contingencies not included in the balance sheet was £nil — please confirm.</p>`),
  },

  // ── Entity-specific ──
  {
    id: 'charity', title: 'Charity Disclosures',
    requirement: 'SORP-compliant fund accounting, trustees and public benefit statement.',
    frameworks: T_NONMICRO, entityTypes: ['charity'], level: 'mandatory',
    build: staticNote(`<h3>Charity disclosures</h3><p>The accounts are prepared in accordance with the Charities SORP (FRS 102). Funds are analysed between unrestricted, restricted and endowment funds, with a public benefit statement and trustee information to follow.</p>`),
  },
  // ── Traditional partnership ──
  {
    id: 'partnership-tax', title: 'Taxation',
    requirement: 'The partnership is not itself taxed — profits are taxed on the partners/members.',
    frameworks: T_ALL_FRS, entityTypes: PARTNERSHIP_LLP, level: 'mandatory',
    build: ctx => {
      const llp = isLlpEntity(ctx.entityType);
      return { status: 'complete', content: `<h3>Taxation</h3><p>The ${llp ? 'LLP' : 'partnership'} is not itself subject to taxation on its profits. The profits are allocated to the ${llp ? 'members' : 'partners'}, who are individually responsible for income tax and national insurance (or corporation tax, for any corporate ${llp ? 'member' : 'partner'}) on their share.</p>` };
    },
  },
  {
    id: 'appropriation', title: 'Appropriation Account',
    requirement: 'Allocation of the net profit between the partners.',
    frameworks: T_ALL_FRS, entityTypes: PARTNERSHIPS, level: 'mandatory',
    build: staticNote(`<h3>Appropriation of profit</h3><p>The profit for the financial year is allocated between the partners as follows — complete with each partner's share: interest on capital £[ ]; partners' salaries £[ ]; interest on drawings £([ ]); and the balance of profit £[ ] shared in the profit-sharing ratio.</p>`),
  },
  {
    id: 'capital-accounts', title: "Partners' Capital Accounts",
    requirement: "Movement on each partner's capital account.",
    frameworks: T_ALL_FRS, entityTypes: PARTNERSHIPS, level: 'mandatory',
    build: staticNote(`<h3>Partners' capital accounts</h3><p>The movement on the partners' capital accounts is set out below — for each partner: opening capital, capital introduced, capital withdrawn, and closing capital.</p>`),
  },
  {
    id: 'current-accounts', title: "Partners' Current Accounts",
    requirement: "Movement on each partner's current account.",
    frameworks: T_ALL_FRS, entityTypes: PARTNERSHIPS, level: 'mandatory',
    build: staticNote(`<h3>Partners' current accounts</h3><p>The movement on the partners' current accounts is set out below — for each partner: opening balance, profit share, salary, interest on capital, drawings, and closing balance.</p>`),
  },
  {
    id: 'profit-sharing', title: 'Profit-Sharing Ratios',
    requirement: 'The basis on which profits are shared between the partners.',
    frameworks: T_ALL_FRS, entityTypes: PARTNERSHIPS, level: 'mandatory',
    build: staticNote(`<h3>Profit-sharing arrangements</h3><p>Profits and losses are shared between the partners in accordance with the partnership agreement. Set out the profit-sharing ratios, together with any partners' salaries and any interest on capital or drawings.</p>`),
  },
  {
    id: 'partner-loans', title: 'Loans from Partners',
    requirement: 'Loans from (or to) partners/members, with terms and interest.',
    frameworks: T_ALL_FRS, entityTypes: PARTNERSHIP_LLP, level: 'conditional', trigger: tHasPartnerLoan,
    build: ctx => ({ status: 'needs-review', content: `<h3>Loans ${isLlpEntity(ctx.entityType) ? 'from members' : 'from partners'}</h3><p>Set out the amounts, interest rates and repayment terms of any loans ${isLlpEntity(ctx.entityType) ? 'from or to members' : 'from or to partners'}.</p>` }),
  },
  // ── Sole trader ──
  {
    id: 'sole-trader-tax', title: 'Taxation',
    requirement: 'The business is not itself taxed — profits are taxed on the proprietor.',
    frameworks: T_ALL_FRS, entityTypes: SOLE, level: 'mandatory',
    build: staticNote(`<h3>Taxation</h3><p>As a sole trader, the business does not itself pay tax. The profit for the year is taxable on the proprietor personally through Self Assessment, along with their other income.</p>`),
  },
  {
    id: 'capital-account', title: 'Capital Account',
    requirement: "Movement on the proprietor's capital account.",
    frameworks: T_ALL_FRS, entityTypes: SOLE, level: 'mandatory',
    build: staticNote(`<h3>Capital account</h3><p>The movement on the proprietor's capital account is set out below: opening capital, capital introduced, profit for the year, and drawings, giving the closing capital.</p>`),
  },
  {
    id: 'business-description', title: 'Business Description',
    requirement: 'A short description of the business (often appreciated by lenders).',
    frameworks: T_ALL_FRS, entityTypes: SOLE, level: 'optional',
    build: staticNote(`<h3>Business description</h3><p>The principal activity of the business during the year was [ ].</p>`),
  },
  {
    id: 'drawings', title: 'Drawings',
    requirement: 'Drawings taken by the proprietor during the year.',
    frameworks: T_ALL_FRS, entityTypes: SOLE, level: 'optional',
    build: staticNote(`<h3>Drawings</h3><p>Drawings taken by the proprietor during the year were £[ ], analysed between cash £[ ], goods £[ ] and private expenses £[ ].</p>`),
  },
  // ── LLP SORP ──
  {
    id: 'members-interests', title: "Members' Interests",
    requirement: "Members' capital, current accounts, loans and amounts due under the LLP SORP.",
    frameworks: T_ALL_FRS, entityTypes: ['llp'], level: 'mandatory',
    build: staticNote(`<h3>Members' interests</h3><p>Members' interests are analysed between members' capital, members' current accounts, loans and other amounts due to members, in accordance with the LLP SORP. Show the movement (opening, amounts introduced, profit allocated, drawings and closing) for each category.</p>`),
  },
  {
    id: 'members-remuneration', title: "Members' Remuneration",
    requirement: "Members' remuneration charged as an expense and profit attributable to members.",
    frameworks: T_ALL_FRS, entityTypes: ['llp'], level: 'mandatory',
    build: staticNote(`<h3>Members' remuneration</h3><p>Set out the members' remuneration charged as an expense, the profit available for discretionary division among members, and (where required) the amount attributable to the highest-paid member.</p>`),
  },
  {
    id: 'participation-rights', title: "Members' Participation Rights",
    requirement: "Classification of members' interests between equity and liabilities under the LLP SORP.",
    frameworks: T_ALL_FRS, entityTypes: ['llp'], level: 'mandatory',
    build: staticNote(`<h3>Members' participation rights</h3><p>Amounts due to members are classified between equity and liabilities in accordance with the LLP SORP, according to whether the LLP has an unconditional right to avoid delivering cash or other assets. State the basis of classification (equity, liability or hybrid).</p>`),
  },
  {
    id: 'trust', title: 'Trust Disclosures',
    requirement: 'Trustee information, beneficiary classes and trust income treatment.',
    frameworks: T_NONMICRO, entityTypes: ['trust'], level: 'mandatory',
    build: staticNote(`<h3>Trust disclosures</h3><p>Disclosures relating to the trust, its trustees and beneficiaries should be set out here.</p>`),
  },

  // ── Optional / best-practice (never auto-seeded; offered in "＋ Add note") ──
  {
    id: 'going-concern', title: 'Going Concern',
    requirement: 'Basis for the going concern assumption and any material uncertainties.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Going concern</h3><p>Based on the current financial position and forecasts, the directors have a reasonable expectation that the company has adequate resources to continue in operational existence for the foreseeable future. Accordingly the going concern basis has been adopted.</p>`),
  },
  {
    id: 'events', title: 'Events after Year End',
    requirement: 'Adjusting and non-adjusting events between the year end and approval.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Events after the reporting date</h3><p>There were no material events after the reporting date requiring disclosure — please confirm.</p>`),
  },
  {
    id: 'commitments', title: 'Commitments',
    requirement: 'Capital and other financial commitments not provided for.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Commitments</h3><p>Any capital commitments and future minimum lease payments under non-cancellable operating leases should be disclosed here.</p>`),
  },
  {
    id: 'dividends', title: 'Dividends',
    requirement: 'Dividends declared and paid in the period.',
    frameworks: T_NONMICRO, entityTypes: COMPANIES, level: 'optional',
    build: staticNote(`<h3>Dividends</h3><p>Dividends of £[ ] were declared and paid during the year.</p>`),
  },
  {
    id: 'government-grants', title: 'Government Grants',
    requirement: 'Grants recognised and any conditions attaching.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Government grants</h3><p>Government grants of £[ ] were recognised in the period.</p>`),
  },
  {
    id: 'pensions', title: 'Pension Commitments',
    requirement: 'Defined contribution pension costs and outstanding contributions.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Pension commitments</h3><p>The company operates a defined contribution pension scheme. The pension charge for the year was £[ ].</p>`),
  },
  {
    id: 'operating-leases', title: 'Operating Lease Commitments',
    requirement: 'Future minimum lease payments under non-cancellable operating leases.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Operating lease commitments</h3><p>Total future minimum lease payments under non-cancellable operating leases were £[ ].</p>`),
  },
  {
    id: 'audit-exemption', title: 'Audit Exemption',
    requirement: "Directors' statement claiming exemption from audit.",
    frameworks: T_SMALL_MICRO, entityTypes: COMPANIES, level: 'optional',
    build: staticNote(`<h3>Audit exemption</h3><p>For the year in question the company was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies, and the members have not required an audit.</p>`),
  },
  {
    id: 'controlling-party', title: 'Controlling Party',
    requirement: 'Ultimate controlling party, where applicable.',
    frameworks: T_NONMICRO, level: 'optional',
    build: staticNote(`<h3>Controlling party</h3><p>The company was under the control of [ ] throughout the current and previous year.</p>`),
  },
];

// ── Engine ───────────────────────────────────────────────────────────────────
function applicable(rule: NoteRule, ctx: DisclosureContext): boolean {
  return rule.frameworks.includes(frameworkTier(ctx))
    && (!rule.entityTypes || rule.entityTypes.includes(ctx.entityType));
}

/** Resolve a rule's level for this context (a level may be fixed or contextual). */
function resolveLevel(rule: NoteRule, ctx: DisclosureContext): NoteLevel {
  return typeof rule.level === 'function' ? rule.level(ctx) : rule.level;
}

/** The level shown to the user: the true level for a note that belongs to this
 *  framework, else 'optional' for one borrowed from another tier. */
function effectiveLevel(rule: NoteRule, ctx: DisclosureContext): NoteLevel {
  return rule.frameworks.includes(frameworkTier(ctx)) ? resolveLevel(rule, ctx) : 'optional';
}

/** True if a conditional rule's trigger fires (a rule with no trigger always seeds). */
function triggered(rule: NoteRule, ctx: DisclosureContext): boolean {
  return rule.trigger ? rule.trigger(ctx) : true;
}

/** Rules that should be seeded into the accounts: mandatory + triggered-conditional. */
function seededRules(ctx: DisclosureContext): NoteRule[] {
  return NOTE_RULES.filter(r => {
    if (!applicable(r, ctx)) return false;
    const level = resolveLevel(r, ctx);
    return level === 'mandatory' || (level === 'conditional' && triggered(r, ctx));
  });
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toSection(rule: NoteRule, ctx: DisclosureContext): DisclosureSection {
  const { content, status } = rule.build(ctx);
  const label = ctx.statements ? 'Auto-drafted from ledger' : 'Draft';
  return {
    id: rule.id,
    title: rule.title,
    status,
    requirement: rule.requirement,
    content,
    level: effectiveLevel(rule, ctx),
    included: true,
    priorYearContent: rule.priorYearContent,
    history: content ? [{ id: 'v1', label, at: nowStamp(), content }] : [],
  };
}

/** Build the seeded disclosure set for a context. */
export function buildDisclosures(ctx: DisclosureContext): DisclosureSection[] {
  return seededRules(ctx).map(r => toSection(r, ctx));
}

/** The "＋ Add note" library — EVERY note relevant to this entity type that isn't
 *  already present, so nothing is ever a dead-end. Framework governs what's
 *  auto-seeded and what the checklist expects, not what can be added. Notes that
 *  belong to another framework tier are offered as 'optional' (voluntary here). */
export function addableNotes(ctx: DisclosureContext, existingIds: string[]): { id: string; title: string; requirement: string; level: NoteLevel }[] {
  const have = new Set(existingIds);
  return NOTE_RULES
    .filter(r => (!r.entityTypes || r.entityTypes.includes(ctx.entityType)) && !have.has(r.id))
    .map(r => ({
      id: r.id,
      title: r.title,
      requirement: r.requirement,
      level: effectiveLevel(r, ctx),
    }));
}

/** Build a fresh section for a note id (used when the user adds one). */
export function makeNote(id: string, ctx: DisclosureContext): DisclosureSection | null {
  const rule = NOTE_RULES.find(r => r.id === id);
  return rule ? toSection(rule, ctx) : null;
}

/** Notes that SHOULD be present for this context (mandatory + triggered-conditional) —
 *  used by the missing-note check. */
export function expectedNotes(ctx: DisclosureContext): { id: string; title: string; level: NoteLevel }[] {
  return seededRules(ctx).map(r => ({ id: r.id, title: r.title, level: resolveLevel(r, ctx) }));
}

/** The rule metadata for a note id (level, filing…), if known. Pass ctx to
 *  resolve a contextual level (else a fixed level, or 'conditional' as neutral). */
export function noteRuleMeta(id: string, ctx?: DisclosureContext): { level: NoteLevel; filing: 'both' | 'full-only' } | null {
  const r = NOTE_RULES.find(x => x.id === id);
  if (!r) return null;
  const level = typeof r.level === 'function' ? (ctx ? r.level(ctx) : 'conditional') : r.level;
  return { level, filing: r.filing ?? 'both' };
}
