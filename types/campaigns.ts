// Campaigns module — shared types (client + server safe; no imports).

// ── Audience rule tree ────────────────────────────────────────────────────────
export type RuleCombinator = 'and' | 'or';

export type RuleOperator =
  | 'eq' | 'neq'
  | 'contains' | 'not_contains'
  | 'is_true' | 'is_false'
  | 'is_empty' | 'is_not_empty'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'within_days';

export interface AudienceRule {
  id: string;
  kind: 'rule';
  field: string;                 // FieldDef.id
  operator: RuleOperator;
  value?: string | number | boolean | null;
}

export interface AudienceGroup {
  id: string;
  kind: 'group';
  combinator: RuleCombinator;
  negate?: boolean;              // NOT — inverts the whole group's result
  children: AudienceNode[];
}

export type AudienceNode = AudienceRule | AudienceGroup;

export function isGroup(n: AudienceNode): n is AudienceGroup {
  return n.kind === 'group';
}

// ── Field registry ────────────────────────────────────────────────────────────
export type FieldType = 'text' | 'select' | 'boolean' | 'number' | 'date_year_end';
export type FieldGroup = 'Client' | 'Companies House' | 'Tasks' | 'Compliance' | 'Billing' | 'Engagement';

export interface FieldOption { value: string; label: string }

export interface FieldDef {
  id: string;
  label: string;
  group: FieldGroup;
  type: FieldType;
  /** Operators offered in the UI for this field. */
  operators: RuleOperator[];
  /** For select fields: static options. Dynamic options (e.g. account managers) are merged in by the UI. */
  options?: FieldOption[];
  /** Hint shown under the value input. */
  hint?: string;
}

// ── Persisted records ─────────────────────────────────────────────────────────
export type AudienceSource = 'dynamic' | 'static' | 'manual' | 'spreadsheet';

export interface CampaignAudience {
  id: string;
  firm_id: string;
  name: string;
  description: string;
  source: AudienceSource;
  definition: AudienceGroup | Record<string, never>;
  member_client_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus =
  | 'draft' | 'awaiting_review' | 'changes_requested' | 'approved'
  | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled' | 'failed';

export type SendMode = 'personal_gmail' | 'bulk';

export interface CampaignStats {
  recipients?: number;
  sent?: number;
  delivered?: number;
  bounced?: number;
  failed?: number;
  opened?: number;       // unique recipients who opened
  clicked?: number;      // unique recipients who clicked
  unsubscribed?: number;
}

export interface CampaignSettings {
  /** How to handle several client rows sharing one email address. */
  dedupe?: 'per_client' | 'per_email';
  tone?: string;
  includeUnsubscribe?: boolean;
}

export interface Campaign {
  id: string;
  firm_id: string;
  name: string;
  subject: string;
  preview_text: string;
  body_html: string;
  body_font: string | null;
  from_email: string | null;
  reply_to: string | null;
  audience_id: string | null;
  audience_snapshot: unknown;
  status: CampaignStatus;
  send_mode: SendMode;
  scheduled_at: string | null;
  sent_at: string | null;
  settings: CampaignSettings;
  stats: CampaignStats;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RecipientStatus =
  | 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed'
  | 'skipped' | 'unsubscribed' | 'suppressed';

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  firm_id: string;
  client_id: string | null;
  email: string;
  name: string;
  merge_data: Record<string, string>;
  status: RecipientStatus;
  message_id: string | null;
  thread_id: string | null;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  first_clicked_at: string | null;
  open_count: number;
  click_count: number;
  bounced_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

// ── Automations ───────────────────────────────────────────────────────────────
export type AutomationTriggerType =
  | 'recurring' | 'year_end_approaching' | 'cs_approaching'
  | 'invoice_overdue' | 'mtd_quarter_outstanding' | 'task_overdue';

export interface AutomationTriggerConfig {
  frequency?: 'monthly' | 'weekly';
  day?: number;    // monthly: day-of-month 1–28; weekly: ISO weekday 1–7
  hour?: number;   // 0–23
  days?: number;   // lead time for *_approaching triggers
}

export type JourneyGoal = 'opened' | 'clicked' | 'uploaded_document' | 'paid_invoice' | 'completed_task';

export type JourneyStep =
  | { id: string; type: 'email'; subject: string; preview_text: string; body_html: string }
  | { id: string; type: 'wait'; days: number }
  | { id: string; type: 'check'; goal: JourneyGoal };

export type AutomationMode = 'single' | 'journey';

export interface CampaignAutomation {
  id: string;
  firm_id: string;
  name: string;
  status: 'active' | 'paused';
  mode: AutomationMode;
  steps: JourneyStep[];
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  audience_id: string | null;
  subject: string;
  preview_text: string;
  body_html: string;
  body_font: string | null;
  from_email: string | null;
  reply_to: string | null;
  require_approval: boolean;
  settings: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Spreadsheet audiences (CSV/Excel mail-merge) ──────────────────────────────
export type SpreadsheetColumnRole =
  | 'email' | 'first_name' | 'full_name' | 'business_name' | 'reference' | 'custom' | 'ignore';

export interface SpreadsheetColumn {
  key: string;      // stable slug, unique within the sheet; also the {{custom.<key>}} suffix
  header: string;   // original header text
  role: SpreadsheetColumnRole;
}

export interface SpreadsheetAudienceData {
  kind: 'spreadsheet';
  columns: SpreadsheetColumn[];
  rows: Record<string, string>[];   // keyed by column key
}

// ── Firm settings ─────────────────────────────────────────────────────────────
export interface CampaignFirmSettings {
  reply_to: string | null;
  include_unsubscribe: boolean;
  unsubscribe_footer: string;
  default_dedupe: 'per_email' | 'per_client';
  frequency_guard_days: number;
}

// ── Templates ─────────────────────────────────────────────────────────────────
export interface CampaignTemplate {
  id: string;
  firm_id: string;
  name: string;
  description: string;
  category: string;
  subject: string;
  preview_text: string;
  body_html: string;
  body_font: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Audience resolution (server → client preview) ─────────────────────────────
export interface ResolvedRecipient {
  client_id: string | null;
  name: string;
  email: string;
  client_ref: string | null;
  business_type: string | null;
  merge_data: Record<string, string>;
  /** Why this recipient is not sendable, if so (no email, unsubscribed…). */
  excludedReason?: 'no_email' | 'unsubscribed' | 'duplicate';
}

export interface AudiencePreview {
  total: number;             // matched clients
  sendable: number;          // with a valid, non-suppressed email after dedupe
  noEmail: number;
  unsubscribed: number;
  duplicates: number;
  sample: ResolvedRecipient[];
}
