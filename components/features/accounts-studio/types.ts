// Accounts Studio — statutory accounts production types.
//
// Phase-1 note: Accounts Studio currently runs on rich in-memory demo data (no
// migration yet), mirroring how Timesheets shipped in preview. The types below
// describe the full engagement shape so the UI, AI assistant and (later) the
// Supabase persistence layer all agree on one model.

export type StageId =
  | 'import'
  | 'preparation'
  | 'review'
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
  | 'capture'
  | 'xero'
  | 'quickbooks'
  | 'sage'
  | 'freeagent'
  | 'vt'
  | 'clipboard'
  | 'csv'
  | 'excel'
  | 'prior-year';

/** Status shared by disclosure sections. */
export type SectionStatus = 'complete' | 'needs-review' | 'missing' | 'draft';

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
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}
