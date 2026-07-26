// Accounts Studio audit trail — pure, client-safe types + diffing.
//
// This module has NO server-only imports (no supabase, no env), so it can be
// used from both the API routes (logging) and the React viewer (rendering).
// The actual write helper lives in ./audit.ts (server-only).

import type { Engagement } from '@/components/features/accounts-studio/types';

export type AuditAction =
  | 'created'
  | 'copied'
  | 'edited'
  | 'deleted'
  | 'published'
  | 'sent_for_approval'
  | 'client_approved'
  | 'client_rejected'
  | 'marked_submitted'
  | 'filed_to_ch'
  | 'downloaded'
  | 'exported';

export type AuditTone =
  | 'create' | 'edit' | 'delete' | 'send' | 'approve' | 'reject' | 'file' | 'download' | 'neutral';

/** One field-level change in an edit event. */
export interface AuditChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface AuditEntry {
  id: string;
  engagementId: string | null;
  clientId: string | null;
  companyName: string | null;
  actorName: string;
  action: AuditAction;
  summary: string | null;
  changes: AuditChange[] | null;
  createdAt: string;
}

export const ACTION_META: Record<AuditAction, { label: string; tone: AuditTone }> = {
  created:           { label: 'Created',            tone: 'create' },
  copied:            { label: 'Copied',             tone: 'create' },
  edited:            { label: 'Edited',             tone: 'edit' },
  deleted:           { label: 'Deleted',            tone: 'delete' },
  published:         { label: 'Published',          tone: 'file' },
  sent_for_approval: { label: 'Sent for approval',  tone: 'send' },
  client_approved:   { label: 'Approved by client', tone: 'approve' },
  client_rejected:   { label: 'Changes requested',  tone: 'reject' },
  marked_submitted:  { label: 'Marked submitted',   tone: 'file' },
  filed_to_ch:       { label: 'Filed to Companies House', tone: 'file' },
  downloaded:        { label: 'Downloaded',         tone: 'download' },
  exported:          { label: 'Exported',           tone: 'download' },
};

const ENTITY_LABEL: Record<string, string> = {
  limited_company: 'Limited Company',
  company_limited_by_guarantee: 'Company Limited by Guarantee',
  cic: 'Community Interest Company',
  dormant_company: 'Dormant Company',
  llp: 'LLP',
  sole_trader: 'Sole Trader',
  partnership: 'Partnership',
  trust: 'Trust',
  charity: 'Charity',
};
const SIZE_LABEL: Record<string, string> = {
  micro: 'Micro-entity', small: 'Small', medium: 'Medium', large: 'Large',
};

// Scalar fields whose changes are worth recording, with display formatting.
const SCALAR_FIELDS: { key: keyof Engagement; label: string; fmt?: (v: unknown) => string }[] = [
  { key: 'companyName',           label: 'Company name' },
  { key: 'companyNumber',         label: 'Registration number' },
  { key: 'clientRef',             label: 'Client ref' },
  { key: 'entityType',            label: 'Entity type', fmt: v => ENTITY_LABEL[String(v)] ?? String(v ?? '') },
  { key: 'framework',             label: 'Framework' },
  { key: 'size',                  label: 'Company size', fmt: v => SIZE_LABEL[String(v)] ?? String(v ?? '') },
  { key: 'periodStart',           label: 'Period start' },
  { key: 'periodEnd',             label: 'Period end' },
  { key: 'fileFilleted',          label: 'Filing type', fmt: v => (v ? 'Filleted' : 'Full') },
  { key: 'audited',               label: 'Audit status', fmt: v => (v ? 'Audited' : 'Audit-exempt') },
  { key: 'auditorName',           label: 'Senior statutory auditor' },
  { key: 'auditFirm',             label: 'Audit firm' },
  { key: 'auditReportDate',       label: 'Audit report date' },
  { key: 'averageEmployees',      label: 'Average employees' },
  { key: 'averageEmployeesPrior', label: 'Average employees (prior year)' },
  { key: 'signatory',             label: 'Signatory' },
  { key: 'amended',               label: 'Amended', fmt: v => (v ? 'Yes' : 'No') },
  { key: 'showComparatives',      label: 'Comparatives shown', fmt: v => (v === false ? 'No' : 'Yes') },
];

function norm(v: unknown, fmt?: (v: unknown) => string): string {
  if (fmt) return fmt(v);
  if (v === null || v === undefined) return '';
  return String(v);
}

interface DisclosureLike { id?: string; title?: string; content?: string; included?: boolean }

/**
 * Field-level diff between two engagement snapshots. Covers the curated scalar
 * fields, the directors list, and note-level disclosure changes (added / removed
 * / edited / excluded — by title, not full text). Returns [] when nothing
 * meaningful changed (so autosaves that only move stage progress log nothing).
 */
export function diffEngagement(prev: Partial<Engagement>, next: Partial<Engagement>): AuditChange[] {
  const changes: AuditChange[] = [];

  for (const f of SCALAR_FIELDS) {
    const a = norm(prev[f.key], f.fmt);
    const b = norm(next[f.key], f.fmt);
    if (a !== b) changes.push({ field: String(f.key), label: f.label, from: a, to: b });
  }

  // Directors — record additions/removals as a from/to list.
  const dPrev = (prev.directors ?? []).filter(Boolean);
  const dNext = (next.directors ?? []).filter(Boolean);
  if (dPrev.join('') !== dNext.join('')) {
    changes.push({ field: 'directors', label: 'Directors', from: dPrev.join(', ') || '—', to: dNext.join(', ') || '—' });
  }

  // Disclosures — per-note changes, capped to keep a single edit sane.
  const prevNotes = new Map((prev.disclosures as DisclosureLike[] | undefined ?? []).map(d => [d.id ?? '', d]));
  const nextNotes = new Map((next.disclosures as DisclosureLike[] | undefined ?? []).map(d => [d.id ?? '', d]));
  let noteChanges = 0;
  for (const [id, nd] of nextNotes) {
    if (noteChanges >= 25) break;
    const title = nd.title || id;
    const pd = prevNotes.get(id);
    if (!pd) { changes.push({ field: `note:${id}`, label: `Note: ${title}`, from: '—', to: 'added' }); noteChanges++; continue; }
    if ((pd.included !== false) !== (nd.included !== false)) {
      changes.push({ field: `note:${id}`, label: `Note: ${title}`, from: pd.included === false ? 'excluded' : 'included', to: nd.included === false ? 'excluded' : 'included' });
      noteChanges++;
    } else if ((pd.content ?? '') !== (nd.content ?? '')) {
      changes.push({ field: `note:${id}`, label: `Note: ${title}`, from: 'previous text', to: 'edited' });
      noteChanges++;
    }
  }
  for (const [id, pd] of prevNotes) {
    if (noteChanges >= 25) break;
    if (!nextNotes.has(id)) { changes.push({ field: `note:${id}`, label: `Note: ${pd.title || id}`, from: 'present', to: 'removed' }); noteChanges++; }
  }

  return changes;
}

/** Short human summary for an 'edited' event from its change list. */
export function summariseChanges(changes: AuditChange[]): string {
  if (changes.length === 0) return 'Edited the accounts';
  const labels = changes.slice(0, 3).map(c => c.label);
  const more = changes.length - labels.length;
  return `Edited ${changes.length} field${changes.length === 1 ? '' : 's'}: ${labels.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
}
