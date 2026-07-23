// Accounts Studio — statutory accounts production types.
//
// Phase-1 note: Accounts Studio currently runs on rich in-memory demo data (no
// migration yet), mirroring how Timesheets shipped in preview. The types below
// describe the full engagement shape so the UI, AI assistant and (later) the
// Supabase persistence layer all agree on one model.

export type StageId =
  | 'import'
  | 'preparation'
  | 'disclosures'
  | 'final-review'
  | 'publish';

export type StageStatus = 'complete' | 'active' | 'upcoming';

export type EntityType =
  | 'sole_trader'
  | 'partnership'
  | 'llp'
  | 'limited_company'
  | 'cic'
  | 'charity'
  | 'trust'
  | 'dormant_company';

export type CompanySize = 'micro' | 'small' | 'medium' | 'large';

export type ImportSourceId =
  | 'bookkeeping'
  | 'manual'
  | 'capture'
  | 'xero'
  | 'quickbooks'
  | 'sage'
  | 'freeagent'
  | 'vt'
  | 'capium'
  | 'clipboard'
  | 'csv'
  | 'scan'
  | 'excel'
  | 'prior-year';

/** Status shared by disclosure sections (the drafting/editing state). */
export type SectionStatus = 'complete' | 'needs-review' | 'missing' | 'draft';

/** How a disclosure is required by the framework + data (the rule-engine tier). */
export type NoteLevel = 'mandatory' | 'conditional' | 'optional';

export interface DisclosureVersion {
  id: string;
  label: string;      // e.g. "AI draft", "Edited by George M.", "Prior year wording"
  at: string;         // dd-mm-yyyy HH:mm
  content: string;    // HTML
}

export interface DisclosureSection {
  id: string;
  title: string;
  status: SectionStatus;
  /** Short one-line requirement summary shown under the title. */
  requirement: string;
  /** Current working HTML content. */
  content: string;
  /** Prior-year wording, used by "Use prior year wording". */
  priorYearContent?: string;
  history: DisclosureVersion[];
  /** Only show this section for these entity types (empty = always). */
  entityTypes?: EntityType[];
  /** Whether the note is included in the accounts. Defaults to true (undefined). */
  included?: boolean;
  /** Rule-engine classification: mandatory / conditional / optional (for the badge). */
  level?: NoteLevel;
}

// ── Imported ledger data (Stage 1 → real trial balance + statements) ─────────
import type { FinancialStatements } from '@/lib/accounts-studio/statements';
export type { FinancialStatements };

export interface TrialBalanceRow {
  name: string;
  ledger: string | null;
  accountType: string;
  debit: number;
  credit: number;
}

/** Where/when the trial balance was pulled from. */
export interface ImportInfo {
  bookId: string;
  bookName: string;
  from: string;              // yyyy-mm-dd (period start)
  to: string;                // yyyy-mm-dd (period end)
  priorFrom: string | null;  // yyyy-mm-dd (prior period start)
  priorTo: string | null;    // yyyy-mm-dd (prior period end)
  importedAt: string;        // dd-mm-yyyy HH:mm
}

export type ValidationStatus = 'pass' | 'warn' | 'fail' | 'running';

export interface ValidationCheck {
  id: string;
  label: string;
  status: ValidationStatus;
  detail: string;
}

export interface PreparationStep {
  id: string;
  label: string;
}

export interface OutputDoc {
  id: string;
  title: string;
  description: string;
  format: 'PDF' | 'iXBRL' | 'ZIP' | 'DOCX';
}

export interface ReviewSummary {
  status: 'not-started' | 'in-progress' | 'complete';
  reviewPoints: number;
  serious: number;
  journalsApproved: number;
  workingPapers: boolean;
  outputId?: string | null;
}

/** A partner / LLP member's figures for the appropriation and capital/current
 *  account schedules (Phase 2 Layer 3 — partnership & LLP accounts). */
export interface PartnerRecord {
  id: string;
  name: string;
  /** Profit-share ratio (as a number — treated proportionally; e.g. 50 / 60). */
  profitShare: number;
  openingCapital: number;
  capitalIntroduced: number;
  capitalWithdrawn: number;
  openingCurrent: number;
  /** Appropriation before the residual split. */
  salary: number;
  interestOnCapital: number;
  /** Current-account drawings during the year. */
  drawings: number;
}

export interface Engagement {
  id: string;
  clientId: string | null;
  clientRef: string | null;
  companyName: string;
  companyNumber: string;
  /** Companies House details (populated by the CH lookup). */
  registeredOffice?: string | null;
  incorporationDate?: string | null; // dd-mm-yyyy
  sicCodes?: string[];
  directors?: string[];
  /** Partners / LLP members and their figures (partnership & LLP engagements). */
  partners?: PartnerRecord[];
  /** The director who signs the report and balance sheet (defaults to the first). */
  signatory?: string | null;
  /** True once real CH data has been pulled onto this engagement. */
  chLinked?: boolean;
  entityType: EntityType;
  size: CompanySize;
  framework: string;         // e.g. "FRS 102 Section 1A"
  periodStart: string;       // dd-mm-yyyy
  periodEnd: string;         // dd-mm-yyyy
  comparativePeriod: string; // dd-mm-yyyy — end of prior year
  dormant: boolean;
  microEligible: boolean;
  /** Average number of employees during the period — a required Companies House
   *  iXBRL fact and the Employees note. Entered on Notes & Disclosures. */
  averageEmployees?: number | null;
  /** Prior-period average employees (comparative in the Employees note + iXBRL).
   *  Auto-filled from last year's engagement when one exists for the client. */
  averageEmployeesPrior?: number | null;
  /** Structured values behind specific disclosure notes (note id → field → value),
   *  e.g. depreciation rates per asset class on the accounting policies note.
   *  See lib/accounts-studio/noteInputs.ts. */
  disclosureData?: Record<string, Record<string, string>>;
  /** Show prior-year comparative columns. Defaults to true (undefined) when a
   *  prior year exists. Set false to prepare the accounts without comparatives. */
  showComparatives?: boolean;
  /** Mark these as amended accounts (adds "Amended" to the cover/titles). */
  amended?: boolean;
  preparedBy: string;
  reviewedBy: string;
  source: ImportSourceId | null;
  accountsDue: string;       // dd-mm-yyyy
  chDeadline: string;        // dd-mm-yyyy
  stageStatus: Record<StageId, StageStatus>;
  review: ReviewSummary;
  disclosures: DisclosureSection[];
  validations: ValidationCheck[];
  published: boolean;
  /** Real imported ledger data (populated by Stage 1 from a bookkeeping book). */
  importInfo?: ImportInfo | null;
  trialBalance?: TrialBalanceRow[] | null;
  statements?: FinancialStatements | null;
  /** True once disclosures have been seeded from a real import (so a re-import
   *  never clobbers notes the user has since edited). */
  disclosuresSeeded?: boolean;
  /** outputs.id of the audit row written when the accounts were published. */
  publishedOutputId?: string | null;
  // ── Client approval + submission lifecycle (accounts_studio_approvals) ──────
  /** Furthest point reached in the chain. Undefined = not yet sent (use stages). */
  approvalStatus?: 'sent' | 'approved' | 'rejected' | 'submitted';
  sentAt?: string;          // ISO — when last sent to the client
  approvedAt?: string;      // ISO — when the client approved
  approvedByName?: string;  // the client's typed-name signature
  rejectedAt?: string;      // ISO — when the client requested changes
  changesNote?: string;     // the client's requested-changes note
  submittedAt?: string;     // ISO — when marked submitted to Companies House
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}
