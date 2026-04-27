// All TypeScript types for Agent Smith

// ─── Module System ────────────────────────────────────────────────────────────

/** Re-export for convenience — use this in components that need module types */
export type { ModuleConfig } from '@/config/modules.config';

export type AppMode =
  | 'selection'
  | 'full_analysis'
  | 'bank_to_csv'
  | 'landlord_analysis'
  | 'final_accounts_review'
  | 'performance_analysis'
  | 'p32_summary'
  | 'ask_smith'
  | 'risk_assessment'
  | 'summarise'
  | 'policies_and_procedures';

export type TargetSoftware = 'vt' | 'capium' | 'xero' | 'quickbooks' | 'freeagent' | 'sage' | 'general';
export type View = 'valid' | 'flagged';
export type AppState = 'idle' | 'loading' | 'success' | 'error';

export interface LedgerAccount {
  name: string;
  code?: string;
}

export interface LedgerValidation {
  status: 'perfect' | 'suggestion' | 'no-match' | 'unvalidated';
  originalAiSuggestion: { name: string };
  suggestedLedger?: LedgerAccount;
}

export interface BaseTransaction {
  fileName: string;
  pageNumber: number;
  ledgerValidation?: LedgerValidation;
  driveLink?: string;
}

export interface VTTransaction extends BaseTransaction {
  type: string;
  refNo: string;
  date: string;
  primaryAccount: string;
  details: string;
  total: number;
  vat: number;
  analysis: number;
  analysisAccount: string;
  entryDetails: string;
  transactionNotes: string;
}

export interface CapiumTransaction extends BaseTransaction {
  contactname: string;
  contacttype: string;
  reference: string;
  description: string;
  accountname: string;
  accountcode: string;
  invoicedate: string;
  vatname: string;
  vatamount: number;
  isvatincluded: string;
  amount: number;
  netAmount: number;
  paydate?: string;
  payaccountname?: string;
  payaccountcode?: string;
}

export interface XeroTransaction extends BaseTransaction {
  contactName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  description: string;
  quantity: number;
  unitAmount: number;
  grossAmount: number;
  accountCode: string;
  accountName: string;
  taxType: string;
}

export interface GeneralTransaction extends BaseTransaction {
  date: string;
  supplier: string;
  invoiceNumber: string;
  description: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  currency: string;
  documentType: string;
  category: string;
  notes: string;
}

export interface QuickBooksTransaction extends BaseTransaction {
  invoiceNo: string;
  supplier: string;
  invoiceDate: string;
  dueDate: string;
  description: string;
  quantity: number;
  unitAmount: number;
  vatAmount: number;
  grossAmount: number;
  taxCode: string;
  accountCode: string;
  accountName: string;
}

export interface FreeAgentTransaction extends BaseTransaction {
  date: string;
  amount: number; // negative = money out, positive = money in
  description: string;
}

export interface SageTransaction extends BaseTransaction {
  TYPE: string;
  ACCOUNT_REF: string;
  NOMINAL_CODE: string;
  DATE: string;
  REFERENCE: string;
  DETAILS: string;
  NET_AMOUNT: number;
  TAX_CODE: string;
  TAX_AMOUNT: number;
  EXCHANGE_RATE: number;
}

export type Transaction = VTTransaction | CapiumTransaction | XeroTransaction | QuickBooksTransaction | FreeAgentTransaction | SageTransaction | GeneralTransaction;

export interface FlaggedEntry {
  fileName: string;
  reason: string;
  duplicateOf?: string;
  pageNumber?: number;
  date?: string;
  supplier?: string;
  amount?: number;
  description?: string;
  transactionData?: Transaction;
  PropertyAddress?: string;
}

export interface BankCsvTransaction {
  Date: string;
  Description: string;
  'Money In'?: number | null;
  'Money Out'?: number | null;
  Balance?: number | null;
}

export interface OutOfRangeDocument {
  fileName: string;
  detectedDate: string;
  entityName: string;
  detailedCategory: string;
  totalNetAmount?: number;
  totalVatAmount?: number;
  totalGrossAmount: number;
}

export interface LandlordIncomeTransaction {
  fileName: string;
  Date: string;
  PropertyAddress: string;
  Description: string;
  Category: string;
  Amount: number;
}

export interface LandlordExpenseTransaction {
  fileName: string;
  DueDate: string;
  Description: string;
  Category: string;
  Amount: number;
  Supplier: string;
  TenantPayable: boolean;
  CapitalExpense: boolean;
  PropertyAddress: string;
}

export interface JournalEntry {
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
}

export interface ReviewPoint {
  area: string;
  issue: string;
  explanation: string;
  severity: 'Serious' | 'Minor';
  suggestedJournal?: JournalEntry | null;
}

export interface WorkingPaperTableRow {
  [key: string]: string;
}

export interface WorkingPaper {
  title: string;
  /** Plain-text serialised version — used for PDF export */
  content: string;
  /** Structured table data — present for table-based sections */
  table?: {
    columns: string[];
    rows: WorkingPaperTableRow[];
  };
  /** Free-text notes field shown below table sections */
  notes?: string;
}

export interface PerformanceReport {
  html: string;
  chartData: Array<{ label: string; company: number; benchmark: number }>;
}

export interface RiskAssessmentReport {
  overallRiskLevel: 'Low' | 'Medium' | 'High';
  riskJustification: string;
  summaryOfAnswers: Array<{
    questionId: string;
    question: string;
    answer: string;
    userComment: string;
  }>;
  suggestedControls: string;
  trainingSuggestions: string;
}

export interface ExportStatus {
  active: boolean;
  message: string;
  progress: number;
}

export interface Summary {
  fileName: string;
  summary: string;
  flagReason?: string;
}

// ─── Document Vault ───────────────────────────────────────────────────────────

export type VaultTaggingStatus = 'untagged' | 'pending' | 'tagged' | 'failed' | 'manually_reviewed';
export type VaultSource = 'google_drive' | 'agent_smith_tool';
export type VaultDocumentType =
  | 'invoice' | 'credit_note' | 'bank_statement' | 'receipt'
  | 'hmrc_letter' | 'tax_return' | 'p60' | 'p45' | 'p11d' | 'p32'
  | 'payslip' | 'accounts' | 'management_accounts' | 'trial_balance'
  | 'contract' | 'letter' | 'report' | 'utility_bill' | 'insurance'
  | 'mortgage' | 'lease' | 'correspondence' | 'other';

export interface VaultDocument {
  id: string;
  firm_id: string;
  user_id: string | null;
  client_id: string | null;

  google_drive_file_id: string;
  google_drive_url: string | null;
  file_name: string;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  google_drive_folder_path: string | null;

  tag_supplier_name: string | null;
  tag_client_code: string | null;
  tag_client_name: string | null;
  tag_document_date: string | null;
  tag_amount: number | null;
  tag_currency: string;
  tag_document_type: VaultDocumentType | null;
  tag_tax_year: string | null;
  tag_accounting_period: string | null;
  tag_hmrc_reference: string | null;
  tag_vat_number: string | null;
  tag_additional: Record<string, unknown> | null;
  tag_summary: string | null;
  tag_confidence: 'high' | 'medium' | 'low' | null;
  tags_array: string[] | null;

  tagging_status: VaultTaggingStatus;
  tagging_error: string | null;
  manually_edited: boolean;

  source: VaultSource;
  source_tool: string | null;

  drive_created_at: string | null;
  drive_modified_at: string | null;
  indexed_at: string;
  tagged_at: string | null;
  created_at: string;
  updated_at: string;

  // Joined fields (not in DB, populated by API)
  client_name?: string | null;
  client_ref?: string | null;
}

export interface VaultSyncState {
  id: string;
  firm_id: string;
  user_id: string;
  last_sync_at: string | null;
  last_sync_status: 'success' | 'partial' | 'failed' | null;
  total_files_indexed: number;
  last_page_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultTaggerResult {
  supplier_name: string | null;
  client_code: string | null;
  client_name: string | null;
  document_date: string | null;
  amount: number | null;
  currency: string | null;
  document_type: VaultDocumentType | null;
  tax_year: string | null;
  accounting_period: string | null;
  hmrc_reference: string | null;
  vat_number: string | null;
  vat_amount: number | null;
  net_amount: number | null;
  invoice_number: string | null;
  account_number: string | null;
  sort_code: string | null;
  property_address: string | null;
  period_from: string | null;
  period_to: string | null;
  summary: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  additional: Record<string, unknown> | null;
}

export interface VaultDocumentFilters {
  client_id?: string;
  document_type?: string[];
  tax_year?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  tagging_status?: VaultTaggingStatus;
  source?: VaultSource;
  page?: number;
  per_page?: number;
}

// ─── Instant Messaging ────────────────────────────────────────────────────────

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  avatar_url?: string | null;
  role: string;
  isOnline?: boolean;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: 'text' | 'nudge';
  edited_at: string | null;
  created_at: string;
  sender?: TeamMember;
  reactions?: MessageReaction[];
}

export interface Conversation {
  id: string;
  firm_id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_at: string;
  otherMember?: TeamMember;
  lastMessage?: ChatMessage;
  unreadCount?: number;
}

// ─── Landlord Adjustments ─────────────────────────────────────────────────────

export interface LandlordAdjustment {
  _id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  propertyAddress: string; // '' = Non Allocated
}

// ─── Batch Scan Results ───────────────────────────────────────────────────────

export interface DocumentScanResult {
  fileName: string;
  status: 'success' | 'failed';
  validTransactions: unknown[];
  flaggedEntries: unknown[];
  errorMessage?: string;
  errorCode?: string;
}

export interface ScanProgressState {
  current: number;
  total: number;
  fileName: string;
}

// ─── Staff Hire ───────────────────────────────────────────────────────────────

export type EmploymentType = 'full_time' | 'part_time' | 'contract';
export type LocationType = 'in_office' | 'remote' | 'hybrid';
export type ApplicantStage =
  | 'applied'
  | 'shortlisted'
  | 'interview_scheduled'
  | 'interviewed'
  | 'offered'
  | 'hired'
  | 'rejected';
export type JobStatus = 'draft' | 'active' | 'closed';

export interface JobRequirement {
  label: string;
  category: string; // e.g. 'Software', 'Qualification', 'Experience', 'Skill'
  mandatory: boolean;
  notes?: string;
}

export interface JobPosting {
  id: string;
  firm_id: string;
  created_by: string | null;
  title: string;
  employment_type: EmploymentType;
  location_type: LocationType;
  location: string | null;
  salary_from: number | null;
  salary_to: number | null;
  salary_display: string | null;
  benefits: string | null;
  experience_years_min: number | null;
  requirements: JobRequirement[];
  description: string | null;
  generated_posting: string | null;
  status: JobStatus;
  applicant_count: number;
  created_at: string;
  updated_at: string;
}

export interface JobApplicant {
  id: string;
  job_id: string;
  firm_id: string;
  added_by: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  stage: ApplicantStage;
  cv_storage_path: string | null;
  cv_filename: string | null;
  cover_letter_storage_path: string | null;
  cover_letter_filename: string | null;
  ai_evaluation: ApplicantEvaluation | null;
  ai_score: number | null;
  ai_summary: string | null;
  ranking_position: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicantEvaluation {
  overallScore: number; // 0–100
  summary: string;
  strengths: string[];
  weaknesses: string[];
  mandatoryRequirementsMet: { requirement: string; met: boolean; notes: string }[];
  preferredRequirementsMet: { requirement: string; met: boolean; notes: string }[];
  experienceAssessment: string;
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
  recommendationReason: string;
}

export interface InterviewQuestion {
  question: string;
  category: 'technical' | 'behavioural' | 'situational' | 'cultural_fit' | 'experience';
  rationale: string;
  followUp?: string;
}

export interface ApplicantQuestions {
  id: string;
  applicant_id: string;
  job_id: string;
  firm_id: string;
  questions: InterviewQuestion[];
  generated_at: string;
}

export interface ScorecardCriterion {
  category: string;
  criterion: string;
  description: string;
  weight: number;   // 1–5 importance weighting
  score: number | null; // 1–5 score, null = not yet rated
  notes: string;
}

export interface ApplicantScorecard {
  id: string;
  applicant_id: string;
  firm_id: string;
  criteria: ScorecardCriterion[];
  overall_score: number | null;
  recommendation: string | null;
  interviewer_notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicantRankResult {
  applicantId: string;
  rank: number;
  overallScore: number;
  hiringRecommendation: 'hire' | 'consider' | 'reject';
  comparativeSummary: string;
}

export interface StaffHireAccessUser {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  has_access: boolean;
}

// ─── Legacy AppState2 ─────────────────────────────────────────────────────────

export interface AppState2 {
  appState: AppState;
  clientName: string;
  clientAddress: string;
  isVatRegistered: boolean;
  documentFiles: File[];
  pastTransactionsFile: File | null;
  ledgersFile: File | null;
  targetSoftware: TargetSoftware;
  transactionHistory: Transaction[][];
  historyIndex: number;
  flaggedEntries: FlaggedEntry[];
  ledgerAccounts: LedgerAccount[];
  currentView: View;
}
