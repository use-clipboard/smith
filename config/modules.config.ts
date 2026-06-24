// Central Module Registry for Agent Smith
// This is the single source of truth for all available modules.
// Import this in both server and client code — no React imports here.

export type ModuleGroupId =
  | 'bookkeeping'
  | 'accounts_compliance'
  | 'reporting'
  | 'client_engagement'
  | 'practice_ops'
  | 'integrations';

export interface ModuleGroup {
  id: ModuleGroupId;
  label: string;
  description: string;
}

/** Display order + labels for tool groupings. Used by Settings → Tools and the New-Tab launcher. */
export const MODULE_GROUPS: ModuleGroup[] = [
  { id: 'bookkeeping',        label: 'Bookkeeping & data extraction', description: 'Process invoices, receipts and bank statements into clean bookkeeping entries.' },
  { id: 'accounts_compliance', label: 'Accounts & compliance',         description: 'Review final accounts, AML risk, Companies House filings and firm policies.' },
  { id: 'reporting',          label: 'Reporting & analysis',           description: 'Management accounts, KPI analysis and client-ready summaries.' },
  { id: 'client_engagement',  label: 'Client engagement',              description: 'Proposals, email, and meeting notes — how you talk to clients.' },
  { id: 'practice_ops',       label: 'Practice operations',            description: 'Run the firm itself — tasks, HR and recruitment.' },
  { id: 'integrations',       label: 'Integrations',                   description: 'Connect SMITH to Google and other external services.' },
];

export interface ModuleConfig {
  id: string;
  name: string;
  description: string;
  /** Lucide icon name — resolve to component in UI files */
  iconName: string;
  route: string | null;
  /** Core modules are always active; they cannot be disabled */
  alwaysOn: boolean;
  /** Other module IDs that unlock additional features in this module */
  enhancedBy?: string[];
  /** Monthly price in pence (GBP). 0 = included in base plan */
  monthlyPricePence: number;
  category: 'core' | 'tool' | 'integration';
  /** Functional grouping for the Tools settings + new-tab launcher. Core modules don't need one. */
  group?: ModuleGroupId;
}

/** All modules — core and optional */
export const MODULES: ModuleConfig[] = [
  // ─── Core (always on) ────────────────────────────────────────────────────
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Workspace overview with recent clients, activity feed, team panel, and quick launch.',
    iconName: 'LayoutDashboard',
    route: '/dashboard',
    alwaysOn: true,
    monthlyPricePence: 0,
    category: 'core',
  },
  {
    id: 'clients',
    name: 'Clients',
    description: 'Client management, records, relationship mapping and document history. Required by all tools.',
    iconName: 'Users',
    route: '/clients',
    alwaysOn: true,
    monthlyPricePence: 0,
    category: 'core',
  },

  // ─── Optional Tools ───────────────────────────────────────────────────────
  {
    id: 'full-analysis',
    name: 'Capture',
    description: 'Analyse invoices and receipts and produce bookkeeping entries for VT Transaction+, Capium, Xero, QuickBooks, FreeAgent, Sage, or General format.',
    iconName: 'FileSearch',
    route: '/full-analysis',
    alwaysOn: false,
    enhancedBy: ['document-vault', 'google-drive'],
    monthlyPricePence: 2900,
    category: 'tool',
    group: 'bookkeeping',
  },
  {
    id: 'bank-to-csv',
    name: 'Bank to CSV',
    description: 'Extract transactions from bank statement PDFs, images, or spreadsheets into a clean, reviewable CSV.',
    iconName: 'ArrowLeftRight',
    route: '/bank-to-csv',
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'bookkeeping',
  },
  {
    id: 'landlord',
    name: 'Landlord Analysis',
    description: 'Analyse letting agent statements, invoices and receipts for rental property portfolios. Produces a UK property income computation.',
    iconName: 'House',
    route: '/landlord',
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'bookkeeping',
  },
  {
    id: 'final-accounts',
    name: 'Accounts Review',
    description: 'Review P&L, Balance Sheet and Trial Balance documents against UK GAAP. Produces review points with suggested journals, and generates working papers for Sole Traders, Partnerships, and Limited Companies.',
    iconName: 'ClipboardCheck',
    route: '/final-accounts',
    alwaysOn: false,
    monthlyPricePence: 2900,
    category: 'tool',
    group: 'accounts_compliance',
  },
  {
    id: 'performance',
    name: 'Performance Analysis',
    description: 'Analyse management accounts and produce a business performance report with KPI ratios, benchmarks, and commentary. Supports yearly, quarterly, and monthly periods.',
    iconName: 'Gauge',
    route: '/performance',
    alwaysOn: false,
    monthlyPricePence: 2900,
    category: 'tool',
    group: 'reporting',
  },
  {
    id: 'p32',
    name: 'P32 Summary',
    description: "Generate a client-ready email body from a P32 Employer's Payment Record document.",
    iconName: 'Receipt',
    route: '/p32',
    alwaysOn: false,
    monthlyPricePence: 900,
    category: 'tool',
    group: 'reporting',
  },
  {
    id: 'risk-assessment',
    name: 'Risk Assessment',
    description: 'Conduct an AML client risk assessment using a structured questionnaire. Produces a risk rating (Low/Medium/High) and a detailed risk report.',
    iconName: 'ShieldAlert',
    route: '/risk-assessment',
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'accounts_compliance',
  },
  {
    id: 'summarise',
    name: 'Summarise',
    description: 'Summarise documents that are out of date range or not relevant to the current job, for file note purposes.',
    iconName: 'FileText',
    route: '/summarise',
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'bookkeeping',
  },
  {
    id: 'document-vault',
    name: 'Document Vault',
    description: 'Searchable archive of all client documents. AI-powered auto-tagging extracts supplier, date, amount, and document type from every file. Also used by Full Analysis to index source documents.',
    iconName: 'Archive',
    route: '/vault',
    alwaysOn: false,
    enhancedBy: ['google-drive'],
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'bookkeeping',
  },
  {
    id: 'policies',
    name: 'Policies & Procedures',
    description: "A reference section for your firm's internal policies and procedures. No AI involved — static content only.",
    iconName: 'BookOpen',
    route: '/policies',
    alwaysOn: false,
    monthlyPricePence: 900,
    category: 'tool',
    group: 'accounts_compliance',
  },

  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    description: 'AI-powered meeting transcription and minutes. Record meetings via microphone or screen audio, get an instant AI summary, formal minutes, and action items — all saved to the client record and Google Drive.',
    iconName: 'MicVocal',
    route: '/meeting-notes',
    alwaysOn: false,
    enhancedBy: ['google-drive', 'google-calendar'],
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'client_engagement',
  },

  {
    id: 'staff-hire',
    name: 'Staff Hire',
    description: 'AI-powered recruitment tool. Write job postings, evaluate CVs and cover letters, generate interview questions, build scorecards, and rank applicants — all in one place.',
    iconName: 'UserPlus',
    route: '/staff-hire',
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'practice_ops',
  },

  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Full practice management task system — create, assign and track client and internal tasks with workflow flowcharts, step-by-step progress, time tracking, recurring schedules, and email reminders.',
    iconName: 'CheckSquare',
    route: '/tasks',
    alwaysOn: false,
    monthlyPricePence: 9900,
    category: 'tool',
    group: 'practice_ops',
  },

  {
    id: 'mtd-it',
    name: 'MTD IT',
    description: 'Making Tax Digital for Income Tax — quarterly self-assessment prep. Analyse sole-trader, UK rental and foreign rental income/expenses per quarter, produce a client approval pack and export to spreadsheet.',
    iconName: 'CalendarCheck',
    route: '/mtd-it',
    alwaysOn: false,
    enhancedBy: ['google-drive', 'document-vault'],
    monthlyPricePence: 2900,
    category: 'tool',
    group: 'accounts_compliance',
  },

  {
    id: 'ch-secretarial',
    name: 'CH Secretarial Link',
    description: 'Live Companies House data for all your limited company clients — accounts due dates, confirmation statements, officer and PSC IDV deadlines, all in one place.',
    iconName: 'Building2',
    route: '/ch-secretarial',
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'accounts_compliance',
  },

  {
    id: 'email-triage',
    name: 'Email Triage',
    description: 'Connect your Gmail account to triage emails directly in SMITH. Send and receive emails, allocate threads to client timelines, link emails to tasks, and use AI to draft replies.',
    iconName: 'Mail',
    route: '/email',
    alwaysOn: false,
    enhancedBy: ['tasks'],
    monthlyPricePence: 9900,
    category: 'tool',
    group: 'client_engagement',
  },

  {
    id: 'hr',
    name: 'HR',
    description: 'Internal team-management for the firm itself — departments, managers, org chart, holiday requests with manager approval, sickness/absence tracking, AI HR advice, confidential disclosures, and a UK Employment Rights Bill knowledge base.',
    iconName: 'HeartHandshake',
    route: '/hr',
    alwaysOn: false,
    enhancedBy: ['google-calendar'],
    monthlyPricePence: 1900,
    category: 'tool',
    group: 'practice_ops',
  },

  {
    id: 'proposals',
    name: 'Proposals',
    description: 'Prepare and send proposals to prospective clients with a firm-wide service catalogue, package bundles (Bronze/Silver/Gold) and per-service tiers. Prospects accept via a public web link, after which auto-onboarding can graduate them to a client, create an AML record, spin up tasks, and generate a Letter of Engagement.',
    iconName: 'FileSignature',
    route: '/proposals',
    alwaysOn: false,
    enhancedBy: ['tasks'],
    monthlyPricePence: 2900,
    category: 'tool',
    group: 'client_engagement',
  },

  // ─── Integrations ─────────────────────────────────────────────────────────
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Connect Agent Smith to Google Drive to save source documents directly from tools, sync files to the Document Vault, and attach Drive links to exported spreadsheets.',
    iconName: 'HardDrive',
    route: null,
    alwaysOn: false,
    monthlyPricePence: 900,
    category: 'integration',
    group: 'integrations',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Connect team members\' Google Calendars to view shared schedules, schedule client meetings, and send meeting invitations directly from the client record.',
    iconName: 'CalendarDays',
    route: '/calendar',
    alwaysOn: false,
    monthlyPricePence: 900,
    category: 'integration',
    group: 'integrations',
  },
];

/** IDs of all optional module IDs (non-alwaysOn) */
export const OPTIONAL_MODULE_IDS = MODULES
  .filter(m => !m.alwaysOn)
  .map(m => m.id);

/** Pricing for seats (monthly, per seat, in pence) */
export const SEAT_PRICE_PENCE = 900; // £9/seat/month

/** Get a module config by ID */
export function getModule(id: string): ModuleConfig | undefined {
  return MODULES.find(m => m.id === id);
}
