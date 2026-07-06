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

const NOTE_DEFS: NoteDef[] = [
  {
    id: 'policies', title: 'Accounting Policies',
    requirement: 'Basis of preparation and the specific policies applied to material balances.',
    applies: () => true,
    build: ctx => ({
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
    build: () => ({
      status: 'needs-review',
      content: `<h3>Directors' report</h3>`
        + `<p>The directors present their report and the financial statements for the year then ended.</p>`
        + `<p><strong>Principal activity.</strong> The principal activity of the company during the year is set out below — please confirm.</p>`
        + `<p><strong>Directors.</strong> The directors who served during the period are listed below — please confirm.</p>`,
    }),
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
    build: () => ({ status: 'needs-review', content: `<h3>Members' report</h3><p>The designated members present their report for the financial year.</p>` }),
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
    id: 'fixed-assets', title: 'Fixed Assets',
    requirement: 'Cost, additions, depreciation and net book value by class of asset.',
    applies: () => true,
    build: ctx => {
      const nbv = fig(ctx, ctx.statements?.balanceSheet.assets, ['fixed asset', 'tangible', 'plant', 'equipment', 'fixtures', 'motor', 'property']);
      return {
        status: nbv ? 'complete' : 'needs-review',
        content: `<h3>Tangible fixed assets</h3><p>The net book value of tangible fixed assets at the year end was ${nbv ?? PH}. A full movement note (cost, additions, disposals and depreciation) should be completed for the accounts.</p>`,
      };
    },
  },
  {
    id: 'debtors', title: 'Debtors',
    requirement: 'Amounts falling due within and after more than one year.',
    applies: () => true,
    build: ctx => {
      const d = fig(ctx, ctx.statements?.balanceSheet.assets, ['debtor', 'receivable', 'prepay']);
      return {
        status: d ? 'complete' : 'needs-review',
        content: `<h3>Debtors</h3><p>Debtors — amounts falling due within one year — totalled ${d ?? PH} at the balance sheet date.</p>`,
      };
    },
  },
  {
    id: 'creditors', title: 'Creditors',
    requirement: 'Amounts falling due within and after more than one year, including tax and VAT.',
    applies: () => true,
    build: ctx => {
      const c = fig(ctx, ctx.statements?.balanceSheet.liabilities, ['creditor', 'payable', 'tax', 'vat', 'loan', 'accrual']);
      return {
        status: c ? 'complete' : 'needs-review',
        content: `<h3>Creditors</h3><p>Creditors — amounts falling due within one year — totalled ${c ?? PH} at the balance sheet date, including taxation and social security.</p>`,
      };
    },
  },
  {
    id: 'related-parties', title: 'Related Parties',
    requirement: 'Transactions with directors and other related parties, including loan balances.',
    applies: () => true,
    build: () => ({
      status: 'needs-review',
      content: `<h3>Related party transactions</h3><p>Details of any transactions with directors and other related parties, including any loan balances and the terms on which they arose, should be set out here.</p>`,
    }),
  },
  {
    id: 'share-capital', title: 'Share Capital',
    requirement: 'Allotted, called up and fully paid share capital.',
    applies: ctx => isCompany(ctx.entityType),
    build: ctx => {
      const sc = fig(ctx, ctx.statements?.balanceSheet.equity, ['share capital', 'called up', 'ordinary']);
      return {
        status: sc ? 'complete' : 'needs-review',
        content: `<h3>Share capital</h3><p>Allotted, called up and fully paid share capital at the year end was ${sc ?? PH}.</p>`,
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
    applies: () => true,
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
