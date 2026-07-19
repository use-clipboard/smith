// Audience Builder field registry.
//
// The single source of truth for what an audience can filter on. Drives both the
// builder UI (labels, operators, value inputs) and the server-side resolver
// (which computes a value per field per client, then evaluates the rule tree).
//
// Every field here MUST be computed in lib/campaigns/audience.ts → buildClientAttrs.
// Keep the two in lock-step: adding a field here without computing it means the
// rule silently never matches.

import type { FieldDef } from '@/types/campaigns';

export const BUSINESS_TYPE_OPTIONS = [
  { value: 'limited_company', label: 'Limited Company' },
  { value: 'sole_trader',     label: 'Sole Trader' },
  { value: 'partnership',     label: 'Partnership' },
  { value: 'llp',             label: 'LLP' },
  { value: 'individual',      label: 'Individual' },
  { value: 'trust',           label: 'Trust' },
  { value: 'charity',         label: 'Charity' },
  { value: 'rental_landlord', label: 'Rental / Landlord' },
];

export const AUDIENCE_FIELDS: FieldDef[] = [
  // ── Client ──────────────────────────────────────────────────────────────────
  {
    id: 'client_status', label: 'Client status', group: 'Client', type: 'select',
    operators: ['eq', 'neq'],
    options: [
      { value: 'active',   label: 'Active' },
      { value: 'hold',     label: 'On hold' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
  {
    id: 'business_type', label: 'Entity type', group: 'Client', type: 'select',
    operators: ['eq', 'neq'],
    options: BUSINESS_TYPE_OPTIONS,
  },
  {
    id: 'risk_rating', label: 'Risk rating', group: 'Client', type: 'select',
    operators: ['eq', 'neq'],
    options: [
      { value: 'Low',    label: 'Low' },
      { value: 'Medium', label: 'Medium' },
      { value: 'High',   label: 'High' },
    ],
  },
  {
    id: 'account_manager_id', label: 'Account manager', group: 'Client', type: 'select',
    operators: ['eq', 'neq'],
    hint: 'Options are your team members.',
  },
  {
    id: 'client_name', label: 'Client name', group: 'Client', type: 'text',
    operators: ['contains', 'not_contains', 'eq'],
  },
  {
    id: 'client_ref', label: 'Client reference', group: 'Client', type: 'text',
    operators: ['contains', 'eq', 'is_empty', 'is_not_empty'],
  },
  {
    id: 'year_end', label: 'Year end', group: 'Client', type: 'text',
    operators: ['contains', 'eq', 'is_empty', 'is_not_empty'],
    hint: 'e.g. "MAR" to match all 31 March year ends.',
  },
  {
    id: 'has_email', label: 'Has email address', group: 'Client', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },

  // ── Compliance ────────────────────────────────────────────────────────────────
  {
    id: 'vat_registered', label: 'VAT registered', group: 'Compliance', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  {
    id: 'vat_scheme', label: 'VAT scheme', group: 'Compliance', type: 'select',
    operators: ['eq', 'neq'],
    options: [
      { value: 'Monthly',   label: 'Monthly' },
      { value: 'Quarterly', label: 'Quarterly' },
      { value: 'Yearly',    label: 'Yearly' },
    ],
  },
  {
    id: 'mtd_it', label: 'MTD for Income Tax', group: 'Compliance', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  {
    id: 'mtd_quarter_outstanding', label: 'Has an outstanding MTD IT quarter', group: 'Compliance', type: 'boolean',
    operators: ['is_true', 'is_false'],
    hint: 'A quarter not yet submitted or approved.',
  },

  // ── Companies House ───────────────────────────────────────────────────────────
  {
    id: 'ch_status', label: 'Company status', group: 'Companies House', type: 'select',
    operators: ['eq', 'neq'],
    options: [
      { value: 'active',            label: 'Active' },
      { value: 'dissolved',         label: 'Dissolved' },
      { value: 'liquidation',       label: 'Liquidation' },
      { value: 'administration',    label: 'Administration' },
    ],
    hint: 'From live Companies House data (limited companies / LLPs).',
  },
  {
    id: 'accounts_due_in_days', label: 'Accounts due within (days)', group: 'Companies House', type: 'number',
    operators: ['within_days'],
    hint: 'Matches companies whose next accounts are due within N days.',
  },
  {
    id: 'accounts_overdue', label: 'Accounts overdue', group: 'Companies House', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  {
    id: 'cs_due_in_days', label: 'Confirmation statement due within (days)', group: 'Companies House', type: 'number',
    operators: ['within_days'],
  },
  {
    id: 'cs_overdue', label: 'Confirmation statement overdue', group: 'Companies House', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────────
  {
    id: 'has_open_task', label: 'Has an open task', group: 'Tasks', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  {
    id: 'has_overdue_task', label: 'Has an overdue task', group: 'Tasks', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  {
    id: 'has_records_here_task', label: 'Has a "records here" task', group: 'Tasks', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },

  // ── Billing ─────────────────────────────────────────────────────────────────────
  {
    id: 'has_overdue_invoice', label: 'Has an overdue invoice', group: 'Billing', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },
  {
    id: 'outstanding_balance_pounds', label: 'Outstanding balance (£) greater than', group: 'Billing', type: 'number',
    operators: ['gt', 'gte'],
    hint: 'Total unpaid across all invoices.',
  },
  {
    id: 'has_active_dd', label: 'Has an active direct debit', group: 'Billing', type: 'boolean',
    operators: ['is_true', 'is_false'],
  },

  // ── Engagement ──────────────────────────────────────────────────────────────────
  {
    id: 'unsubscribed', label: 'Unsubscribed', group: 'Engagement', type: 'boolean',
    operators: ['is_true', 'is_false'],
    hint: 'Unsubscribed contacts are always excluded from sends regardless of this filter.',
  },
];

export const FIELD_BY_ID: Record<string, FieldDef> =
  Object.fromEntries(AUDIENCE_FIELDS.map(f => [f.id, f]));

export const OPERATOR_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  is_true: 'is yes',
  is_false: 'is no',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'is greater than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
  within_days: 'within (days)',
};
