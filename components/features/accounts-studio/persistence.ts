// Accounts Studio — client-side persistence helpers.
//
// Thin wrappers over /api/accounts-studio/engagements so the UI never talks to
// fetch() directly. Engagements are stored server-side (Supabase) — no more
// in-memory demo data.

import type { Engagement } from './types';
import type { AccountsHistoryItem } from './data';
import { SESSION_EXPIRED_MESSAGE } from '@/lib/fetchJson';

const BASE = '/api/accounts-studio/engagements';

interface EngagementDto {
  id: string;
  data: Engagement;
  updatedAt: string;
  mine: boolean;
}

/** ISO timestamp → 'dd-mm-yyyy HH:mm' (UK display used across the history list). */
function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toHistoryItem(dto: EngagementDto): AccountsHistoryItem {
  return { id: dto.id, engagement: { ...dto.data, id: dto.id }, date: fmt(dto.updatedAt), mine: dto.mine };
}

/**
 * Parse a JSON response, but fail with a friendly message when the server sends
 * back HTML instead — which happens when the auth middleware redirects an
 * expired session to the login page (a 200 HTML body). Without this, callers hit
 * the raw `Unexpected token '<'` JSON.parse error.
 */
async function readJson<T>(r: Response, fallback: string): Promise<T> {
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    // A middleware redirect to /login returns a 200 HTML page, so check the
    // redirect target too — not just 401/403 — before falling back.
    if ((r.redirected && /\/login(\?|$)/.test(r.url)) || r.status === 401 || r.status === 403 || !r.ok) {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    throw new Error(fallback);
  }
  const d = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? fallback);
  return d as T;
}

export async function listEngagements(): Promise<AccountsHistoryItem[]> {
  const r = await fetch(BASE, { cache: 'no-store' });
  const d = await readJson<{ engagements: EngagementDto[] }>(r, 'Could not load accounts.');
  return (d.engagements ?? []).map(toHistoryItem);
}

/** Create a new engagement; returns the stored engagement (server stamps id + preparedBy). */
export async function createEngagement(e: Engagement, copiedFromId?: string): Promise<Engagement> {
  const r = await fetch(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(copiedFromId ? { data: e, copiedFromId } : { data: e }),
  });
  const d = await readJson<{ engagement: EngagementDto }>(r, 'Could not create the engagement.');
  return { ...d.engagement.data, id: d.engagement.id };
}

/**
 * Record a client-side action (a download, or the list export) in the Accounts
 * Studio audit trail. Best-effort — never blocks the user's action.
 */
export async function logAuditClientEvent(input: {
  action: 'downloaded' | 'exported';
  summary: string;
  engagementId?: string | null;
  clientId?: string | null;
  companyName?: string | null;
}): Promise<void> {
  try {
    await fetch('/api/accounts-studio/audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch { /* non-critical */ }
}

/** Persist the current engagement snapshot (autosave). */
export async function saveEngagement(e: Engagement): Promise<void> {
  const r = await fetch(`${BASE}/${e.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: e }),
  });
  await readJson(r, 'Save failed.');
}

export async function deleteEngagement(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  await readJson(r, 'Delete failed.');
}

// ── Client approval + submission ─────────────────────────────────────────────

export interface SendApprovalInput {
  recipientEmail: string;
  coverNote?: string | null;
  pdfBase64?: string | null;
  summaryLines?: { label: string; value: string }[] | null;
  /** Email Triage on → skip Gmail; return the rendered email for the compose window. */
  prepareOnly?: boolean;
}
export interface SendApprovalResult {
  ok: boolean;
  approvalUrl: string;
  senderEmail?: string;
  subject?: string;
  htmlBody?: string;
  attachmentFilename?: string;
}

/** Send the accounts to the client for approval (email via the preparer's Gmail). */
export async function sendForApproval(engagementId: string, input: SendApprovalInput): Promise<SendApprovalResult> {
  const r = await fetch(`${BASE}/${engagementId}/send-approval`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient_email: input.recipientEmail,
      cover_note: input.coverNote ?? null,
      pdf_base64: input.pdfBase64 ?? null,
      summary_lines: input.summaryLines ?? null,
      prepare_only: input.prepareOnly ?? false,
    }),
  });
  return readJson<SendApprovalResult>(r, 'Could not send for approval.');
}

/** Flip the engagement status to 'sent' — after the approval email is really
 *  sent from the compose window (server-authoritative). */
export async function markApprovalSent(engagementId: string): Promise<Engagement> {
  const r = await fetch(`${BASE}/${engagementId}/mark-approval-sent`, { method: 'POST' });
  const d = await readJson<{ engagement: EngagementDto }>(r, 'Could not update status.');
  return { ...d.engagement.data, id: d.engagement.id };
}

/** Mark the accounts as submitted to Companies House (server-authoritative). */
export async function markSubmitted(engagementId: string): Promise<Engagement> {
  const r = await fetch(`${BASE}/${engagementId}/mark-submitted`, { method: 'POST' });
  const d = await readJson<{ engagement: EngagementDto }>(r, 'Could not mark as submitted.');
  return { ...d.engagement.data, id: d.engagement.id };
}

// ── Companies House XML Gateway filing ───────────────────────────────────────

export interface ChSubmitInput {
  companyAuthCode: string;
  companyType?: string;
  contactName?: string;
  contactNumber?: string;
  // Audit details from the filing panel — sent explicitly so a pending autosave
  // can't stale them.
  audited?: boolean;
  auditorName?: string;
  auditFirm?: string;
  auditReportDate?: string;
}
export interface ChSubmitResult {
  ok: boolean;
  status: 'submitted' | 'accepted' | 'rejected' | 'error';
  message: string;
  submissionNumber: string;
  correlationId: string | null;
  isTest: boolean;
}

/** File the engagement's iXBRL accounts to the Companies House XML Gateway. */
export async function submitToCompaniesHouse(engagementId: string, input: ChSubmitInput): Promise<ChSubmitResult> {
  const r = await fetch(`${BASE}/${engagementId}/ch-submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  // ch-submit returns a 502 with {error} on a gateway rejection AND a 200 with
  // {ok:false} is not used — read both shapes so the caller sees the CH message.
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok && (d as { error?: string }).error) throw new Error((d as { error: string }).error);
  if (!r.ok && !(d as { status?: string }).status) throw new Error('Filing failed. Please try again.');
  return d as ChSubmitResult;
}

/**
 * Copy the accounts into a fresh draft — for preparing amended accounts. Clones
 * everything up to the point of sending to the client, resetting the approval /
 * submission / publish state and stage progress. Returns the new engagement.
 */
export async function copyEngagement(e: Engagement): Promise<Engagement> {
  const clone: Engagement = {
    ...structuredClone(e),
    id: '',
    published: false,
    publishedOutputId: null,
    approvalStatus: undefined,
    sentAt: undefined,
    approvedAt: undefined,
    approvedByName: undefined,
    rejectedAt: undefined,
    changesNote: undefined,
    submittedAt: undefined,
    stageStatus: {
      import: 'complete', preparation: 'complete', disclosures: 'active',
      'final-review': 'upcoming', publish: 'upcoming',
    },
  };
  return createEngagement(clone, e.id);
}

/** Record the published statutory accounts against the client record. Returns the outputs.id. */
export async function publishEngagement(e: Engagement): Promise<string> {
  const s = e.statements;
  const r = await fetch(`${BASE}/${e.id}/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: e.clientId,
      clientName: e.companyName,
      clientCode: e.clientRef,
      companyName: e.companyName,
      entityType: e.entityType,
      framework: e.framework,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      turnover: s?.profitLoss.turnoverTotal ?? null,
      netProfit: s?.profitLoss.netProfit ?? null,
      totalAssets: s?.balanceSheet.totalAssets ?? null,
      netAssets: s?.balanceSheet.netAssets ?? null,
      outputId: e.publishedOutputId ?? null,
    }),
  });
  const d = await readJson<{ outputId: string }>(r, 'Publish failed.');
  return d.outputId;
}
