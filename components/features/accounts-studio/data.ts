import {
  Landmark, BookCopy, Cloud, Calculator, ReceiptText, Wallet, Table2,
  ClipboardPaste, FileSpreadsheet, Files,
} from 'lucide-react';
import type {
  Engagement, StageId, ImportSourceId, DisclosureSection, ValidationCheck,
  OutputDoc, EntityType, CompanySize, PreparationStep,
} from './types';

export const STAGES: { id: StageId; label: string; blurb: string }[] = [
  { id: 'import',       label: 'Import Data',        blurb: 'Bring in the ledger or trial balance' },
  { id: 'preparation',  label: 'AI Preparation',     blurb: 'SMITH builds the statutory accounts' },
  { id: 'review',       label: 'Accounts Review',    blurb: 'Validate the numbers' },
  { id: 'disclosures',  label: 'Notes & Disclosures', blurb: 'Draft and finalise disclosures' },
  { id: 'final-review', label: 'Final Review',        blurb: 'Compliance validation' },
  { id: 'publish',      label: 'Approve & Publish',   blurb: 'File and archive' },
];

export const ENTITY_LABELS: Record<EntityType, string> = {
  sole_trader: 'Sole Trader',
  partnership: 'Partnership',
  llp: 'LLP',
  limited_company: 'Limited Company',
  cic: 'Community Interest Company',
  charity: 'Charity',
  trust: 'Trust',
  dormant_company: 'Dormant Company',
};

export const SIZE_LABELS: Record<CompanySize, string> = {
  micro: 'Micro-entity',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

// ─── Stage 1: import sources ─────────────────────────────────────────────────
// `enabled` sources work now; the rest are shown as "Soon" while we build the
// connectors/parsers.
export const IMPORT_SOURCES: {
  id: ImportSourceId; name: string; sub: string; icon: typeof Landmark; native?: boolean; enabled: boolean;
}[] = [
  { id: 'bookkeeping', name: 'SMITH Bookkeeping', sub: 'Live trial balance',      icon: BookCopy,          native: true, enabled: true },
  { id: 'clipboard',   name: 'Clipboard',         sub: 'Paste a trial balance',   icon: ClipboardPaste,                  enabled: true },
  { id: 'csv',         name: 'CSV',               sub: 'Upload a file',           icon: FileSpreadsheet,                 enabled: true },
  { id: 'excel',       name: 'Excel',             sub: 'Upload a workbook',       icon: Files,                           enabled: true },
  { id: 'xero',        name: 'Xero',              sub: 'Connected ledger',        icon: Cloud,                           enabled: false },
  { id: 'quickbooks',  name: 'QuickBooks',        sub: 'Connected ledger',        icon: Calculator,                      enabled: false },
  { id: 'sage',        name: 'Sage',              sub: 'Connected ledger',        icon: ReceiptText,                     enabled: false },
  { id: 'freeagent',   name: 'FreeAgent',         sub: 'Connected ledger',        icon: Wallet,                          enabled: false },
  { id: 'vt',          name: 'VT Transaction+',   sub: 'Import file',             icon: Table2,                          enabled: false },
];

/** Animated messages shown while importing (Stage 1). */
export const IMPORT_STEPS: string[] = [
  'Reading ledger',
  'Detecting company',
  'Detecting framework',
  'Matching prior year',
  'Preparing statutory accounts',
];

/** AI preparation checklist (Stage 2). */
export const PREPARATION_STEPS: PreparationStep[] = [
  { id: 'entity',    label: 'Entity detected' },
  { id: 'framework', label: 'Framework selected' },
  { id: 'tb',        label: 'Trial balance mapped' },
  { id: 'comps',     label: 'Comparatives identified' },
  { id: 'fs',        label: 'Financial statements built' },
  { id: 'soce',      label: 'Statement of changes in equity prepared' },
  { id: 'notes',     label: 'Notes generated' },
  { id: 'policies',  label: 'Accounting policies drafted' },
  { id: 'directors', label: "Directors' report drafted" },
  { id: 'validate',  label: 'Companies House validation' },
];

// ─── Stage 4: disclosure section templates ───────────────────────────────────
function draftHistory(content: string): DisclosureSection['history'] {
  return [{ id: 'v1', label: 'AI draft', at: '03-07-2026 09:12', content }];
}

export const DISCLOSURE_TEMPLATE: DisclosureSection[] = [
  {
    id: 'policies', title: 'Accounting Policies', status: 'complete',
    requirement: 'Basis of preparation and the specific policies applied to material balances.',
    content: `<h3>Accounting policies</h3><p><strong>Basis of preparation.</strong> These financial statements have been prepared in accordance with FRS 102 Section 1A "The Financial Reporting Standard applicable in the UK and Republic of Ireland" and the Companies Act 2006, under the historical cost convention.</p><p><strong>Turnover.</strong> Turnover represents amounts receivable for services net of VAT and trade discounts, recognised in the period in which the service is provided.</p><p><strong>Tangible fixed assets.</strong> Depreciation is provided to write off the cost less estimated residual value of each asset over its expected useful life.</p>`,
    priorYearContent: `<h3>Accounting policies</h3><p><strong>Basis of preparation.</strong> These financial statements have been prepared in accordance with FRS 102 Section 1A and the Companies Act 2006, under the historical cost convention.</p>`,
    history: draftHistory('<p>AI draft of accounting policies.</p>'),
  },
  {
    id: 'directors-report', title: "Directors' Report", status: 'needs-review',
    requirement: 'Principal activity, results, dividends and directors who served in the period.',
    content: `<h3>Directors' report</h3><p>The directors present their report and the financial statements for the year ended 31 March 2026.</p><p><strong>Principal activity.</strong> The principal activity of the company continued to be the provision of accountancy and taxation services.</p><p><strong>Business review.</strong> The results for the year and the state of affairs of the company are set out in the financial statements.</p><p><strong>Directors.</strong> The directors who served during the period were G Marneros and C Marneros.</p>`,
    priorYearContent: `<h3>Directors' report</h3><p>The directors present their report and the financial statements for the year ended 31 March 2025.</p><p><strong>Principal activity.</strong> The principal activity of the company continued to be the provision of accountancy services.</p>`,
    history: draftHistory("<p>AI draft of the directors' report.</p>"),
    entityTypes: ['limited_company', 'cic', 'dormant_company'],
  },
  {
    id: 'strategic-report', title: 'Strategic Report', status: 'complete',
    requirement: 'Fair review of the business and description of principal risks (medium+ companies).',
    content: `<h3>Strategic report</h3><p>The company delivered steady growth in the year, supported by continued demand for compliance and advisory services. The directors monitor gross margin, staff utilisation and cash conversion as the principal performance indicators.</p>`,
    history: draftHistory('<p>AI draft of the strategic report.</p>'),
    entityTypes: ['limited_company', 'cic'],
  },
  {
    id: 'members-report', title: "Members' Report", status: 'draft',
    requirement: "Designated members and members' interests for an LLP.",
    content: `<h3>Members' report</h3><p>The designated members present their report for the financial year.</p>`,
    history: draftHistory("<p>AI draft of the members' report.</p>"),
    entityTypes: ['llp'],
  },
  {
    id: 'employees', title: 'Employees', status: 'complete',
    requirement: 'Average monthly number of employees during the period.',
    content: `<h3>Employees</h3><p>The average monthly number of employees during the year was 16 (2025: 14).</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'fixed-assets', title: 'Fixed Assets', status: 'complete',
    requirement: 'Cost, additions, depreciation and net book value by class of asset.',
    content: `<h3>Tangible fixed assets</h3><p>Additions in the year comprised office and computer equipment. Net book value at the year end was £48,200 (2025: £41,750).</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'debtors', title: 'Debtors', status: 'needs-review',
    requirement: 'Amounts falling due within and after more than one year.',
    content: `<h3>Debtors</h3><p>Trade debtors £126,400 (2025: £98,900). Other debtors and prepayments £14,100 (2025: £11,300).</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'creditors', title: 'Creditors', status: 'complete',
    requirement: 'Amounts falling due within and after more than one year, including tax and VAT.',
    content: `<h3>Creditors</h3><p>Trade creditors £22,700 (2025: £19,400). Taxation and social security £41,900. Other creditors £8,200.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'related-parties', title: 'Related Parties', status: 'needs-review',
    requirement: 'Transactions with directors and other related parties, including loan balances.',
    content: `<h3>Related party transactions</h3><p>The directors' loan account was overdrawn by £6,295 at the year end. Interest has been charged at the official rate.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'share-capital', title: 'Share Capital', status: 'complete',
    requirement: 'Allotted, called up and fully paid share capital.',
    content: `<h3>Share capital</h3><p>100 ordinary shares of £1 each, allotted, called up and fully paid.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
    entityTypes: ['limited_company', 'cic', 'dormant_company'],
  },
  {
    id: 'going-concern', title: 'Going Concern', status: 'complete',
    requirement: 'Basis for the going concern assumption and any material uncertainties.',
    content: `<h3>Going concern</h3><p>Based on the current financial position and cash flow forecasts, the directors have a reasonable expectation that the company has adequate resources to continue in operational existence for the foreseeable future. Accordingly the going concern basis has been adopted.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'events', title: 'Events after Year End', status: 'missing',
    requirement: 'Adjusting and non-adjusting events between the year end and approval.',
    content: '',
    history: [],
  },
  {
    id: 'financial-instruments', title: 'Financial Instruments', status: 'complete',
    requirement: 'Basic financial instruments measured at amortised cost.',
    content: `<h3>Financial instruments</h3><p>The company holds only basic financial instruments, measured at amortised cost.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'commitments', title: 'Commitments', status: 'draft',
    requirement: 'Capital and other financial commitments not provided for.',
    content: `<h3>Commitments</h3><p>Total future minimum lease payments under non-cancellable operating leases were £36,000.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'contingencies', title: 'Contingencies', status: 'complete',
    requirement: 'Contingent liabilities and assets not recognised in the balance sheet.',
    content: `<h3>Contingent liabilities</h3><p>There were no contingent liabilities at the balance sheet date.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
  },
  {
    id: 'charity', title: 'Charity Disclosures', status: 'draft',
    requirement: 'SORP-compliant fund accounting, trustees and public benefit statement.',
    content: `<h3>Charity disclosures</h3><p>The accounts are prepared in accordance with the Charities SORP (FRS 102). Funds are analysed between unrestricted, restricted and endowment funds.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
    entityTypes: ['charity'],
  },
  {
    id: 'llp', title: 'LLP Disclosures', status: 'draft',
    requirement: "Members' remuneration, capital and division of profits under the LLP SORP.",
    content: `<h3>LLP disclosures</h3><p>Members' remuneration and the division of profits are presented in accordance with the LLP SORP.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
    entityTypes: ['llp'],
  },
  {
    id: 'trust', title: 'Trust Disclosures', status: 'draft',
    requirement: 'Trustee information, beneficiary classes and trust income treatment.',
    content: `<h3>Trust disclosures</h3><p>Disclosures relating to the trust, its trustees and beneficiaries.</p>`,
    history: draftHistory('<p>AI draft.</p>'),
    entityTypes: ['trust'],
  },
];

// ─── Stage 5: compliance validation checks ───────────────────────────────────
export const VALIDATION_TEMPLATE: ValidationCheck[] = [
  { id: 'ch',          label: 'Companies House validation', status: 'pass', detail: 'iXBRL accounts pass all filing rules — no validation errors.' },
  { id: 'ixbrl',       label: 'iXBRL tagging',              status: 'pass', detail: 'All mandatory facts tagged against the FRC taxonomy.' },
  { id: 'disclosure',  label: 'Disclosure completeness',   status: 'warn', detail: '13 of 14 required disclosures complete — Events after Year End needs review.' },
  { id: 'signatures',  label: 'Required signatures',        status: 'warn', detail: "Directors' report awaiting signature before filing." },
  { id: 'reports',     label: 'Required reports',           status: 'pass', detail: "Directors' report and balance sheet statements present." },
  { id: 'comparatives',label: 'Comparative figures',       status: 'pass', detail: 'Prior year figures reconcile to the 2025 filed accounts.' },
  { id: 'policies',    label: 'Accounting policy consistency', status: 'pass', detail: 'Policies consistent with prior year; no unexplained changes.' },
  { id: 'framework',   label: 'Framework compliance',       status: 'pass', detail: 'FRS 102 Section 1A small-company exemptions correctly applied.' },
  { id: 'deadlines',   label: 'Filing deadlines',           status: 'pass', detail: 'Companies House deadline 31-12-2026 — 181 days remaining.' },
];

// ─── Stage 6: output documents ───────────────────────────────────────────────
export const OUTPUT_DOCS: OutputDoc[] = [
  { id: 'statutory',  title: 'Statutory Accounts',        description: 'Full signed financial statements', format: 'PDF' },
  { id: 'ixbrl',      title: 'iXBRL Accounts',            description: 'FRC-tagged for online filing',      format: 'iXBRL' },
  { id: 'ch-package', title: 'Companies House Package',   description: 'Ready-to-submit filing bundle',     format: 'ZIP' },
  { id: 'ct',         title: 'Corporation Tax Accounts',  description: 'Accounts for the CT600',            format: 'iXBRL' },
  { id: 'approval',   title: 'Client Approval Pack',      description: 'For e-signature approval',          format: 'PDF' },
  { id: 'rep-letter', title: 'Director Representation Letter', description: 'Management representations',   format: 'DOCX' },
  { id: 'management', title: 'Management Copy',           description: 'Internal working copy',             format: 'PDF' },
];

// ─── Engagement factory ──────────────────────────────────────────────────────
const ALL_STAGES: StageId[] = ['import', 'preparation', 'review', 'disclosures', 'final-review', 'publish'];

export function freshStageStatus(active: StageId): Engagement['stageStatus'] {
  const activeIdx = ALL_STAGES.indexOf(active);
  const map = {} as Engagement['stageStatus'];
  ALL_STAGES.forEach((s, i) => {
    map[s] = i < activeIdx ? 'complete' : i === activeIdx ? 'active' : 'upcoming';
  });
  return map;
}

/** Disclosure sections relevant to a given entity type. */
export function disclosuresForEntity(entity: EntityType): DisclosureSection[] {
  return DISCLOSURE_TEMPLATE
    .filter(s => !s.entityTypes || s.entityTypes.includes(entity))
    .map(s => ({ ...s, history: [...s.history] }));
}

/** Best-effort map a client's stored business_type to an Accounts Studio entity. */
export function entityFromBusinessType(bt?: string | null): EntityType {
  const v = (bt ?? '').toLowerCase();
  if (v.includes('sole')) return 'sole_trader';
  if (v.includes('partnership')) return 'partnership';
  if (v.includes('llp')) return 'llp';
  if (v.includes('community interest') || v === 'cic') return 'cic';
  if (v.includes('charity')) return 'charity';
  if (v.includes('trust')) return 'trust';
  if (v.includes('dormant')) return 'dormant_company';
  return 'limited_company';
}

interface NewEngagementInput {
  clientId: string | null;
  clientRef: string | null;
  companyName: string;
  entityType?: EntityType;
}

/**
 * Build a fresh engagement for a newly-selected client. Detection fields are
 * seeded with sensible demo defaults (a real build would derive them from the
 * imported ledger + Companies House).
 */
export function buildEngagement({ clientId, clientRef, companyName, entityType = 'limited_company' }: NewEngagementInput): Engagement {
  return {
    id: `eng-${clientId ?? 'demo'}-${clientRef ?? '0000'}`,
    clientId,
    clientRef,
    companyName,
    companyNumber: '12345678',
    entityType,
    size: 'small',
    framework: 'FRS 102 Section 1A',
    periodStart: '01-04-2025',
    periodEnd: '31-03-2026',
    comparativePeriod: '31-03-2025',
    dormant: false,
    microEligible: false,
    preparedBy: 'George Marneros',
    reviewedBy: 'Christos Marneros',
    source: null,
    accountsDue: '30-09-2026',
    chDeadline: '31-12-2026',
    stageStatus: freshStageStatus('import'),
    review: { status: 'not-started', reviewPoints: 0, serious: 0, journalsApproved: 0, workingPapers: false },
    disclosures: disclosuresForEntity(entityType),
    validations: VALIDATION_TEMPLATE.map(v => ({ ...v })),
    published: false,
  };
}

/** The Acme Ltd sample used on the dashboard + when opening a demo engagement. */
export function demoEngagement(): Engagement {
  const e = buildEngagement({ clientId: null, clientRef: 'ACME01', companyName: 'Acme Ltd' });
  e.id = 'eng-demo-acme';
  e.source = 'bookkeeping';
  e.stageStatus = { import: 'complete', preparation: 'complete', review: 'complete', disclosures: 'active', 'final-review': 'upcoming', publish: 'upcoming' };
  e.review = { status: 'complete', reviewPoints: 17, serious: 4, journalsApproved: 3, workingPapers: true, outputId: null };
  return e;
}

// ─── History list ──────────────────────────────────────────────────────────
export type EngagementStatusTone = 'draft' | 'progress' | 'ready' | 'filed';

export interface AccountsHistoryItem {
  id: string;
  engagement: Engagement;
  /** dd-mm-yyyy HH:mm — last edited. */
  date: string;
  /** Prepared by the current user — drives the "Mine" filter (demo). */
  mine: boolean;
}

/** Derive a headline status for the history list from stage progress. */
export function engagementStatus(e: Engagement): { label: string; tone: EngagementStatusTone } {
  if (e.published) return { label: 'Filed', tone: 'filed' };
  const stages: StageId[] = ['import', 'preparation', 'review', 'disclosures', 'final-review', 'publish'];
  const allButPublishDone = stages.slice(0, 5).every(s => e.stageStatus[s] === 'complete');
  if (allButPublishDone) return { label: 'Ready to file', tone: 'ready' };
  const started = stages.some(s => e.stageStatus[s] === 'complete');
  return started ? { label: 'In progress', tone: 'progress' } : { label: 'Draft', tone: 'draft' };
}

/** How many of the six stages are complete. */
export function stageProgress(e: Engagement): number {
  return (['import', 'preparation', 'review', 'disclosures', 'final-review', 'publish'] as StageId[])
    .filter(s => e.stageStatus[s] === 'complete').length;
}

function makeHistoryItem(
  opts: {
    id: string; company: string; ref: string; entity: EntityType;
    framework: string; periodEnd: string; comparativePeriod: string;
    preparedBy: string; date: string; mine: boolean;
    stageStatus: Engagement['stageStatus']; published: boolean;
    review: Engagement['review'];
  },
): AccountsHistoryItem {
  const e = buildEngagement({ clientId: null, clientRef: opts.ref, companyName: opts.company, entityType: opts.entity });
  e.id = opts.id;
  e.framework = opts.framework;
  e.periodEnd = opts.periodEnd;
  e.periodStart = shiftYearStart(opts.periodEnd);
  e.comparativePeriod = opts.comparativePeriod;
  e.preparedBy = opts.preparedBy;
  e.source = 'bookkeeping';
  e.stageStatus = opts.stageStatus;
  e.published = opts.published;
  e.review = opts.review;
  return { id: opts.id, engagement: e, date: opts.date, mine: opts.mine };
}

/** dd-mm-yyyy one year + one day before a period end (for the period start). */
function shiftYearStart(periodEnd: string): string {
  const [d, m, y] = periodEnd.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y - 1}`;
}

const DONE = 'complete' as const;
const reviewDone = (rp: number, ser: number, jn: number): Engagement['review'] =>
  ({ status: 'complete', reviewPoints: rp, serious: ser, journalsApproved: jn, workingPapers: true, outputId: null });

/** Demo history — a spread of statuses so the list looks lived-in. */
export function demoHistory(): AccountsHistoryItem[] {
  return [
    {
      id: 'eng-demo-acme',
      engagement: demoEngagement(),
      date: '03-07-2026 09:12',
      mine: true,
    },
    makeHistoryItem({
      id: 'eng-fusion', company: 'Fusion Hair Design Studio Ltd', ref: 'F173', entity: 'limited_company',
      framework: 'FRS 105 (Micro-entity)', periodEnd: '30-04-2026', comparativePeriod: '30-04-2025',
      preparedBy: 'Christos Marneros', date: '01-07-2026 16:07', mine: true,
      stageStatus: { import: DONE, preparation: DONE, review: DONE, disclosures: DONE, 'final-review': DONE, publish: 'active' },
      published: false, review: reviewDone(6, 0, 2),
    }),
    makeHistoryItem({
      id: 'eng-cherry', company: 'Cherry Tree Fencing Ltd', ref: 'C368', entity: 'limited_company',
      framework: 'FRS 102 Section 1A', periodEnd: '31-12-2025', comparativePeriod: '31-12-2024',
      preparedBy: 'George Marneros', date: '18-06-2026 11:36', mine: false,
      stageStatus: { import: DONE, preparation: DONE, review: DONE, disclosures: DONE, 'final-review': DONE, publish: DONE },
      published: true, review: reviewDone(12, 1, 5),
    }),
    makeHistoryItem({
      id: 'eng-bigfryer', company: 'Big Fryer Limited', ref: 'B1235', entity: 'limited_company',
      framework: 'FRS 102 Section 1A', periodEnd: '31-03-2026', comparativePeriod: '31-03-2025',
      preparedBy: 'Christos Marneros', date: '16-06-2026 21:00', mine: true,
      stageStatus: { import: DONE, preparation: DONE, review: 'active', disclosures: 'upcoming', 'final-review': 'upcoming', publish: 'upcoming' },
      published: false, review: { status: 'in-progress', reviewPoints: 0, serious: 0, journalsApproved: 0, workingPapers: false },
    }),
    makeHistoryItem({
      id: 'eng-meadow', company: 'Meadow View LLP', ref: 'M204', entity: 'llp',
      framework: 'FRS 102 Section 1A (LLP SORP)', periodEnd: '31-03-2026', comparativePeriod: '31-03-2025',
      preparedBy: 'George Marneros', date: '11-06-2026 10:22', mine: false,
      stageStatus: { import: DONE, preparation: DONE, review: DONE, disclosures: 'active', 'final-review': 'upcoming', publish: 'upcoming' },
      published: false, review: reviewDone(9, 2, 3),
    }),
    makeHistoryItem({
      id: 'eng-social', company: 'Social Storie Ltd', ref: 'S486', entity: 'limited_company',
      framework: 'FRS 102 Section 1A', periodEnd: '30-09-2025', comparativePeriod: '30-09-2024',
      preparedBy: 'Christos Marneros', date: '27-05-2026 16:04', mine: true,
      stageStatus: { import: DONE, preparation: DONE, review: DONE, disclosures: DONE, 'final-review': DONE, publish: DONE },
      published: true, review: reviewDone(11, 0, 4),
    }),
    makeHistoryItem({
      id: 'eng-oak', company: 'Oak & Stone Joinery', ref: 'O091', entity: 'sole_trader',
      framework: 'FRS 105', periodEnd: '05-04-2026', comparativePeriod: '05-04-2025',
      preparedBy: 'George Marneros', date: '20-05-2026 09:48', mine: false,
      stageStatus: { import: DONE, preparation: 'active', review: 'upcoming', disclosures: 'upcoming', 'final-review': 'upcoming', publish: 'upcoming' },
      published: false, review: { status: 'not-started', reviewPoints: 0, serious: 0, journalsApproved: 0, workingPapers: false },
    }),
  ];
}
