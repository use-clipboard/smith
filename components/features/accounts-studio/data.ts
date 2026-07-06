import {
  Landmark, BookCopy, Cloud, Calculator, ReceiptText, Wallet, Table2,
  ClipboardPaste, FileSpreadsheet, Files,
} from 'lucide-react';
import type {
  Engagement, StageId, ImportSourceId, ValidationCheck,
  EntityType, CompanySize,
} from './types';
import { buildDisclosures } from '@/lib/accounts-studio/disclosures';

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
  { id: 'clipboard',   name: 'Clipboard',         sub: 'Paste a trial balance',   icon: ClipboardPaste,                  enabled: false },
  { id: 'csv',         name: 'CSV',               sub: 'Upload a file',           icon: FileSpreadsheet,                 enabled: false },
  { id: 'excel',       name: 'Excel',             sub: 'Upload a workbook',       icon: Files,                           enabled: false },
  { id: 'xero',        name: 'Xero',              sub: 'Connected ledger',        icon: Cloud,                           enabled: false },
  { id: 'quickbooks',  name: 'QuickBooks',        sub: 'Connected ledger',        icon: Calculator,                      enabled: false },
  { id: 'sage',        name: 'Sage',              sub: 'Connected ledger',        icon: ReceiptText,                     enabled: false },
  { id: 'freeagent',   name: 'FreeAgent',         sub: 'Connected ledger',        icon: Wallet,                          enabled: false },
  { id: 'vt',          name: 'VT Transaction+',   sub: 'Import file',             icon: Table2,                          enabled: false },
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
    // Note shells (no fabricated figures) — replaced with real-figure drafts on
    // the first trial-balance import.
    disclosures: buildDisclosures({ entityType, size: 'small', framework: 'FRS 102 Section 1A', statements: null, priorYear: '' }),
    validations: VALIDATION_TEMPLATE.map(v => ({ ...v })),
    published: false,
    disclosuresSeeded: false,
  };
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

