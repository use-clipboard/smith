// Central Module Registry for Agent Smith
// This is the single source of truth for all available modules.
// Import this in both server and client code — no React imports here.

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
    name: 'Full Analysis',
    description: 'Analyse invoices and receipts and produce bookkeeping entries for VT Transaction+, Capium, Xero, QuickBooks, FreeAgent, Sage, or General format.',
    iconName: 'FileSearch',
    route: '/full-analysis',
    alwaysOn: false,
    enhancedBy: ['document-vault', 'google-drive'],
    monthlyPricePence: 2900,
    category: 'tool',
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
  },
  {
    id: 'performance',
    name: 'Performance Analysis',
    description: 'Analyse management accounts and produce a business performance report with KPI ratios, benchmarks, and commentary. Supports yearly, quarterly, and monthly periods.',
    iconName: 'TrendingUp',
    route: '/performance',
    alwaysOn: false,
    monthlyPricePence: 2900,
    category: 'tool',
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
  },
  {
    id: 'summarise',
    name: 'Summarise',
    description: 'Summarise documents that are out of date range or not relevant to the current job, for file note purposes.',
    iconName: 'FileText',
    route: '/summarise',
    alwaysOn: false,
    monthlyPricePence: 900,
    category: 'tool',
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
  },

  // ─── Integrations ─────────────────────────────────────────────────────────
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Connect Agent Smith to Google Drive to save source documents directly from tools, sync files to the Document Vault, and attach Drive links to exported spreadsheets.',
    iconName: 'HardDrive',
    route: null,
    alwaysOn: false,
    monthlyPricePence: 1900,
    category: 'integration',
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
