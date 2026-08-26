// Client Services — shared types, frequency maths, and derived health.
// Pure module (no React/lucide) so API routes and client components can share it.

// 'annual' is the proposals-catalogue term (== yearly); both accepted so a
// service shared from proposal_services maps cleanly.
export type ServiceFrequency =
  | 'weekly' | 'bi_weekly' | 'monthly' | 'quarterly' | 'yearly' | 'annual' | 'one_off' | 'custom';

// The shared catalogue offers these four; the extras stay valid for legacy rows.
export const SERVICE_FREQUENCIES: ServiceFrequency[] =
  ['monthly', 'quarterly', 'annual', 'one_off'];

export const FREQUENCY_LABEL: Record<ServiceFrequency, string> = {
  weekly: 'Weekly', bi_weekly: 'Bi-Weekly', monthly: 'Monthly', quarterly: 'Quarterly',
  yearly: 'Yearly', annual: 'Yearly', one_off: 'One-off', custom: 'Custom',
};

/** How many times a year the fee recurs (drives Monthly Recurring + Annual Value). */
export const FREQUENCY_PER_YEAR: Record<ServiceFrequency, number> = {
  weekly: 52, bi_weekly: 26, monthly: 12, quarterly: 4, yearly: 1, annual: 1, one_off: 0, custom: 0,
};

/** Short "/ month", "/ quarter" suffix shown under a price. */
export const FREQUENCY_UNIT: Record<ServiceFrequency, string> = {
  weekly: '/ week', bi_weekly: '/ fortnight', monthly: '/ month', quarterly: '/ quarter',
  yearly: '/ year', annual: '/ year', one_off: 'one-off', custom: '',
};

// ── VAT treatment (shared with proposal_services) ────────────────────────────
export type ServiceVatTreatment = 'firm_default' | 'inclusive' | 'exclusive' | 'exempt';
export const VAT_TREATMENTS: ServiceVatTreatment[] = ['exclusive', 'inclusive', 'exempt', 'firm_default'];
export const VAT_TREATMENT_LABEL: Record<ServiceVatTreatment, string> = {
  exclusive: 'Plus VAT (ex VAT)', inclusive: 'VAT inclusive', exempt: 'VAT exempt', firm_default: 'Firm default',
};
/** Short badge shown next to a price: exclusive → "+ VAT", inclusive → "inc VAT". */
export function vatSuffix(t: string | null | undefined): string {
  switch (t) {
    case 'exclusive': return 'ex VAT';
    case 'inclusive': return 'inc VAT';
    case 'exempt': return 'no VAT';
    default: return '';
  }
}

export type ServiceStatus = 'active' | 'paused' | 'ended';
export const SERVICE_STATUSES: ServiceStatus[] = ['active', 'paused', 'ended'];
export const STATUS_LABEL: Record<ServiceStatus, string> = {
  active: 'Active', paused: 'Paused', ended: 'Ended',
};

/** Derived health bucket for the health donut. Never stored. */
export type ServiceHealth = 'active' | 'at_risk' | 'overdue' | 'inactive';
export const HEALTH_LABEL: Record<ServiceHealth, string> = {
  active: 'Active', at_risk: 'At risk', overdue: 'Overdue', inactive: 'Inactive',
};
export const HEALTH_COLOR: Record<ServiceHealth, string> = {
  active: '#16a34a', at_risk: '#d97706', overdue: '#dc2626', inactive: '#94a3b8',
};

/** Days before the due date at which an active service is flagged "at risk". */
export const AT_RISK_DAYS = 7;

/**
 * Derive a service's health from its status and effective next-due date.
 * `todayIso`/`nextDueIso` are YYYY-MM-DD. Pure + deterministic.
 */
export function deriveHealth(
  status: ServiceStatus,
  nextDueIso: string | null,
  todayIso: string,
): ServiceHealth {
  if (status !== 'active') return 'inactive';
  if (!nextDueIso) return 'active';
  if (nextDueIso < todayIso) return 'overdue';
  const cutoff = addDaysIso(todayIso, AT_RISK_DAYS);
  if (nextDueIso <= cutoff) return 'at_risk';
  return 'active';
}

/** Add N days to a YYYY-MM-DD string (UTC, no tz drift). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface CatalogueItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  defaultFrequency: ServiceFrequency | null;
  defaultPricePence: number | null;
  defaultTaskType: string | null;
  archived: boolean;
  sortOrder: number;
}

export interface LinkedTaskRef {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
}

export interface ClientService {
  id: string;
  clientId: string;
  catalogueId: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  frequency: ServiceFrequency | null;
  pricePence: number | null;
  vatTreatment: string | null;
  /** For a tiered catalogue service: the chosen tier's label (else null). */
  tierLabel: string | null;
  status: ServiceStatus;
  /** Manually-set due date; only used when there are no open linked tasks. */
  manualNextDue: string | null;
  /** Effective due — earliest open linked task due date, else manualNextDue. */
  nextDue: string | null;
  notes: string | null;
  linkedRecurringInvoiceId: string | null;
  sortOrder: number;
  tasks: LinkedTaskRef[];
  health: ServiceHealth;
}

export interface ClientServiceNote {
  id: string;
  body: string;
  createdByName: string | null;
  createdAt: string;
}

/** Monthly recurring value (pence) across the given services — active + priced only. */
export function monthlyRecurringPence(services: { status: ServiceStatus; frequency: ServiceFrequency | null; pricePence: number | null }[]): number {
  return services.reduce((sum, s) => {
    if (s.status !== 'active' || !s.pricePence || !s.frequency) return sum;
    const perYear = FREQUENCY_PER_YEAR[s.frequency];
    if (!perYear) return sum; // one-off / custom don't recur
    return sum + Math.round((s.pricePence * perYear) / 12);
  }, 0);
}

export function annualValuePence(services: { status: ServiceStatus; frequency: ServiceFrequency | null; pricePence: number | null }[]): number {
  return services.reduce((sum, s) => {
    if (s.status !== 'active' || !s.pricePence || !s.frequency) return sum;
    const perYear = FREQUENCY_PER_YEAR[s.frequency];
    if (!perYear) return sum;
    return sum + s.pricePence * perYear;
  }, 0);
}
