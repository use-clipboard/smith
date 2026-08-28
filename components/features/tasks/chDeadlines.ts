// Shared helpers for the "Companies House deadline" recurrence option in the
// task creation modals (CreateTaskModal, QuickTaskModal). Keeps the deadline
// labels, the eligibility/date fetch, and the UK date formatter in one place.

export type ChDeadlineType = 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due';

export const CH_DEADLINE_TYPES: ChDeadlineType[] = ['accounts_due', 'cs_due', 'officer_idv_due', 'psc_idv_due'];

export const CH_DEADLINE_LABELS: Record<ChDeadlineType, string> = {
  accounts_due:    'Accounts Due',
  cs_due:          'Confirmation Statement Due',
  officer_idv_due: 'Officer IDV Due',
  psc_idv_due:     'PSC IDV Due',
};

export interface ClientChDeadlines {
  eligible: boolean;
  chModuleActive: boolean;
  businessType: string | null;
  companiesHouseId: string | null;
  deadlines: Record<ChDeadlineType, string | null>;
}

/**
 * Fetches whether a client is eligible for CH-deadline task linking and, when
 * eligible, the four cached deadline dates. Returns null on any failure so the
 * caller can fall back to hiding the CH option (fail safe).
 */
export async function fetchClientChDeadlines(clientId: string): Promise<ClientChDeadlines | null> {
  try {
    const r = await fetch(`/api/ch-secretarial/client-deadlines?clientId=${encodeURIComponent(clientId)}`);
    if (!r.ok) return null;
    return (await r.json()) as ClientChDeadlines;
  } catch {
    return null;
  }
}

export interface ScanClientResult {
  ok: boolean;
  deadlines?: Record<ChDeadlineType, string | null>;
  error?: string;
}

/**
 * On-demand Companies House scan for a single client — used when the client
 * isn't in the CH Secretarial cache yet (e.g. mid-onboarding). Fetches the
 * company live, merges it into the firm's CH cache, and returns the freshly
 * resolved deadline dates. Maps the known error codes to friendly messages.
 */
export async function scanClientChDeadlines(clientId: string): Promise<ScanClientResult> {
  try {
    const r = await fetch('/api/ch-secretarial/scan-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const map: Record<string, string> = {
        NO_API_KEY: 'No Companies House API key is set for your firm (add one in Settings → API).',
        RATE_LIMITED: 'Companies House is rate-limiting requests — please try again in a moment.',
      };
      return { ok: false, error: map[d?.error as string] ?? (d?.error as string) ?? 'Scan failed.' };
    }
    return { ok: true, deadlines: d.deadlines };
  } catch {
    return { ok: false, error: 'Scan failed. Please try again.' };
  }
}

/** dd-mm-yyyy, or a placeholder when the date isn't cached yet. */
export function formatDeadlineDate(iso: string | null | undefined): string {
  if (!iso) return 'not yet available';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
