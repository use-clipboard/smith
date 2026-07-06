import {
  Landmark, BookCopy, Cloud, Calculator, ReceiptText, Wallet, Table2,
  ClipboardPaste, FileSpreadsheet, PencilLine,
} from 'lucide-react';
import type {
  Engagement, StageId, ImportSourceId,
  EntityType, CompanySize,
} from './types';
import { buildDisclosures } from '@/lib/accounts-studio/disclosures';

export const STAGES: { id: StageId; label: string; blurb: string }[] = [
  { id: 'import',       label: 'Import Data',        blurb: 'Bring in the ledger or trial balance' },
  { id: 'preparation',  label: 'AI Preparation',     blurb: 'SMITH builds the statutory accounts' },
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
  /** Provider logo (rendered as a circular badge). Overrides `icon` when set. */
  logo?: string;
}[] = [
  { id: 'bookkeeping', name: 'SMITH Bookkeeping', sub: 'Live trial balance',      icon: BookCopy,          native: true, enabled: true },
  { id: 'manual',      name: 'Build manually',    sub: 'Enter a trial balance',   icon: PencilLine,                      enabled: true },
  { id: 'clipboard',   name: 'Clipboard',         sub: 'Paste a trial balance',   icon: ClipboardPaste,                  enabled: true },
  { id: 'csv',         name: 'CSV',               sub: 'Upload a file',           icon: FileSpreadsheet,                 enabled: true },
  { id: 'xero',        name: 'Xero',              sub: 'Connected ledger',        icon: Cloud,                           enabled: false, logo: '/logos/xero.png' },
  { id: 'quickbooks',  name: 'QuickBooks',        sub: 'Connected ledger',        icon: Calculator,                      enabled: false, logo: '/logos/quickbooks.png' },
  { id: 'sage',        name: 'Sage',              sub: 'Connected ledger',        icon: ReceiptText,                     enabled: false, logo: '/logos/sage.png' },
  { id: 'freeagent',   name: 'FreeAgent',         sub: 'Connected ledger',        icon: Wallet,                          enabled: false, logo: '/logos/freeagent.png' },
  { id: 'capium',      name: 'Capium',            sub: 'Connected ledger',        icon: Calculator,                      enabled: false, logo: '/logos/capium.png' },
  { id: 'vt',          name: 'VT Transaction+',   sub: 'Import file',             icon: Table2,                          enabled: false, logo: '/logos/vt.png' },
];

// ─── Engagement factory ──────────────────────────────────────────────────────
const ALL_STAGES: StageId[] = ['import', 'preparation', 'disclosures', 'final-review', 'publish'];

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
  /** Companies House details, when a lookup ran during setup. */
  companyNumber?: string;
  registeredOffice?: string | null;
  incorporationDate?: string | null;
  sicCodes?: string[];
  directors?: string[];
  accountsDue?: string;
  chDeadline?: string;
  chLinked?: boolean;
}

/**
 * Build a fresh engagement for a newly-selected client. Detection fields are
 * seeded with sensible demo defaults (a real build would derive them from the
 * imported ledger + Companies House).
 */
export function buildEngagement(input: NewEngagementInput): Engagement {
  const { clientId, clientRef, companyName, entityType = 'limited_company' } = input;
  return {
    id: `eng-${clientId ?? 'demo'}-${clientRef ?? '0000'}`,
    clientId,
    clientRef,
    companyName,
    companyNumber: input.companyNumber ?? '',
    registeredOffice: input.registeredOffice ?? null,
    incorporationDate: input.incorporationDate ?? null,
    sicCodes: input.sicCodes ?? [],
    directors: input.directors ?? [],
    chLinked: input.chLinked ?? false,
    entityType,
    size: 'small',
    framework: 'FRS 102 Section 1A',
    periodStart: '',
    periodEnd: '',
    comparativePeriod: '',
    dormant: false,
    microEligible: false,
    preparedBy: '',
    reviewedBy: '',
    source: null,
    accountsDue: input.accountsDue ?? '',
    chDeadline: input.chDeadline ?? '',
    stageStatus: freshStageStatus('import'),
    review: { status: 'not-started', reviewPoints: 0, serious: 0, journalsApproved: 0, workingPapers: false },
    // Note shells (no fabricated figures) — replaced with real-figure drafts on
    // the first trial-balance import.
    disclosures: buildDisclosures({ entityType, size: 'small', framework: 'FRS 102 Section 1A', statements: null, priorYear: '', directors: input.directors }),
    // Stage 5 checks are derived live from the engagement (lib/.../validations).
    validations: [],
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
  const stages: StageId[] = ['import', 'preparation', 'disclosures', 'final-review', 'publish'];
  const allButPublishDone = stages.slice(0, stages.length - 1).every(s => e.stageStatus[s] === 'complete');
  if (allButPublishDone) return { label: 'Ready to file', tone: 'ready' };
  const started = stages.some(s => e.stageStatus[s] === 'complete');
  return started ? { label: 'In progress', tone: 'progress' } : { label: 'Draft', tone: 'draft' };
}

/** How many of the five stages are complete. */
export function stageProgress(e: Engagement): number {
  return (['import', 'preparation', 'disclosures', 'final-review', 'publish'] as StageId[])
    .filter(s => e.stageStatus[s] === 'complete').length;
}

