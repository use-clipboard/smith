import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import type { CHCompanyData, CHOfficer, CHPSC, CHAddress } from '@/types/ch';

const CH_BASE = 'https://api.company-information.service.gov.uk';
const INTRA_DELAY = 200; // ms between the 3 sequential requests per company

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ─── ECCTA 2023 IDV helpers ───────────────────────────────────────────────────
// CH API updated 18 Nov 2025 to include IDV fields directly on officer/PSC records:
//   appointment_verification_statement_due_on  — the due date (officers + PSCs)
//   verification_stmt_due_date                  — alternative due date field
//   appointment_verification_eff_date           — set when verification is complete (officers)
//   appointment_verification_statement_date     — set when verification statement filed (PSCs)
//
// We prefer these API fields over our local computation. Local computation is kept
// as a fallback for any records the API hasn't yet populated.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getIdvDueDate(record: any, appointedOn: string | undefined): string | null {
  // For PSCs, CH API nests IDV fields under identity_verification_details
  const ivd = record.identity_verification_details ?? null;

  // Prefer the API's own due date — check nested (PSC) and top-level (officer) locations
  const apiDue = ivd?.appointment_verification_statement_due_on
    ?? record.appointment_verification_statement_due_on
    ?? ivd?.appointment_verification_statement_date  // fallback: statement date as due date
    ?? record.verification_stmt_due_date
    ?? null;
  if (apiDue) return apiDue;

  // Fallback: compute from ECCTA rules for records not yet updated
  if (!appointedOn) return null;
  const appointed = new Date(appointedOn);
  if (isNaN(appointed.getTime())) return null;
  const cutoff = new Date('2024-03-04');
  const phase2 = new Date('2024-10-01');
  if (appointed <= cutoff) return '2025-03-04';
  if (appointed < phase2) {
    const due = new Date(appointed);
    due.setDate(due.getDate() + 14);
    return due.toISOString().slice(0, 10);
  }
  return appointedOn;
}

// CH uses "9999-12-31" as a sentinel meaning "no end date / indefinitely valid"
function isActiveStatement(startOn: string | undefined, endOn: string | undefined): boolean {
  if (!startOn) return false;
  if (!endOn) return true; // no end date = still active
  const today = new Date().toISOString().slice(0, 10);
  return endOn > today; // "9999-12-31" is always > today, as is any future date
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasVerification(record: any): boolean {
  const ivd = record.identity_verification_details ?? null;

  // ACSP verified the identity directly
  if (ivd?.identity_verified_on) return true;
  // Active verification statement (start set, end not set or future — "9999-12-31" = indefinite)
  if (isActiveStatement(ivd?.appointment_verification_start_on, ivd?.appointment_verification_end_on)) return true;

  // Officer top-level fields (Nov 2025 CH API update)
  if (record.appointment_verification_eff_date) return true;
  if (isActiveStatement(record.appointment_verification_start_on, record.appointment_verification_end_on)) return true;

  // Legacy fallback
  if (record.verification_details) {
    const vd = record.verification_details;
    if (vd.verification_date) return true;
    if (Array.isArray(vd.verification_statements) && vd.verification_statements.length > 0) return true;
  }
  return false;
}

function isIdvOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function nearestDate(dates: (string | null)[]): string | null {
  const valid = dates.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  return valid.sort()[0];
}

// ─── Address helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAddress(raw: any): CHAddress {
  if (!raw) return {};
  return {
    addressLine1: raw.address_line_1,
    addressLine2: raw.address_line_2,
    locality: raw.locality,
    region: raw.region,
    postalCode: raw.postal_code,
    country: raw.country,
  };
}

// ─── CH API fetch helpers ─────────────────────────────────────────────────────
// Note: NO retry logic here — 429s are passed straight back to the client as
// { error: 'RATE_LIMITED' } so the user can see what is happening.

class RateLimitError extends Error {
  constructor() { super('RATE_LIMITED'); }
}

async function chFetch(path: string, apiKey: string): Promise<unknown> {
  const credentials = Buffer.from(`${apiKey.trim()}:`).toString('base64');
  const res = await fetch(`${CH_BASE}${path}`, {
    headers: { Authorization: `Basic ${credentials}` },
    cache: 'no-store',
  });

  if (res.status === 429) throw new RateLimitError();
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Invalid API key (${res.status}) — check the key in API Settings`);
  }
  if (!res.ok) throw new Error(`Companies House returned ${res.status} for ${path}`);
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCompany(number: string, apiKey: string): Promise<CHCompanyData> {
  const n = number.trim().toUpperCase().padStart(8, '0');
  const chUrl = `https://find-and-update.company-information.service.gov.uk/company/${n}`;

  try {
    // Sequential requests with small delays — NOT parallel — to stay within CH rate limits.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = await chFetch(`/company/${n}`, apiKey) as any;
    await sleep(INTRA_DELAY);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const officersData = await chFetch(`/company/${n}/officers?items_per_page=100`, apiKey).catch(e => {
      if (e instanceof RateLimitError) throw e; // propagate rate limit
      return { items: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await sleep(INTRA_DELAY);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pscData = await chFetch(`/company/${n}/persons-with-significant-control?items_per_page=100`, apiKey).catch(e => {
      if (e instanceof RateLimitError) throw e; // propagate rate limit
      return { items: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    // Debug: log the FULL raw object for first active officer and PSC so we can see
    // exactly which fields CH returns — helps diagnose IDV field naming issues.
    const firstOfficer = (officersData.items ?? []).find((o: { resigned_on?: string }) => !o.resigned_on);
    const firstPsc = (pscData.items ?? []).find((p: { ceased_on?: string }) => !p.ceased_on);
    if (firstOfficer) {
      console.log(`[CH IDV RAW] ${n} officer "${firstOfficer.name}":`, JSON.stringify(firstOfficer));
    }
    if (firstPsc) {
      console.log(`[CH IDV RAW] ${n} PSC "${firstPsc.name}":`, JSON.stringify(firstPsc));
    }

    // Secretaries are exempt from ECCTA 2023 IDV requirements
    const SECRETARY_ROLES = new Set(['secretary', 'corporate-secretary', 'nominee-secretary']);

    // Officers (active only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeOfficers: CHOfficer[] = (officersData.items ?? []).filter((o: any) => !o.resigned_on).map((o: any) => {
      const isSecretary = SECRETARY_ROLES.has((o.officer_role ?? '').toLowerCase());
      if (isSecretary) {
        return {
          name: o.name ?? '',
          role: o.officer_role ?? '',
          appointedOn: o.appointed_on ?? '',
          dateOfBirth: o.date_of_birth ? { month: o.date_of_birth.month, year: o.date_of_birth.year } : undefined,
          address: parseAddress(o.address),
          idvDueDate: null,
          idvOverdue: false,
          idvVerified: false,
          idvExempt: true,
        };
      }
      const idvDueDate = getIdvDueDate(o, o.appointed_on);
      const idvVerified = hasVerification(o);
      return {
        name: o.name ?? '',
        role: o.officer_role ?? '',
        appointedOn: o.appointed_on ?? '',
        dateOfBirth: o.date_of_birth ? { month: o.date_of_birth.month, year: o.date_of_birth.year } : undefined,
        address: parseAddress(o.address),
        idvDueDate,
        idvOverdue: !idvVerified && isIdvOverdue(idvDueDate),
        idvVerified,
        idvExempt: false,
      };
    });

    // PSCs (active only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activePscs: CHPSC[] = (pscData.items ?? []).filter((p: any) => !p.ceased_on).map((p: any) => {
      const idvDueDate = getIdvDueDate(p, p.notified_on);
      const idvVerified = hasVerification(p);
      return {
        name: p.name ?? p.description ?? '',
        kind: p.kind ?? '',
        notifiedOn: p.notified_on ?? '',
        naturesOfControl: p.natures_of_control ?? [],
        address: parseAddress(p.address),
        dateOfBirth: p.date_of_birth ? { month: p.date_of_birth.month, year: p.date_of_birth.year } : undefined,
        idvDueDate,
        idvOverdue: !idvVerified && isIdvOverdue(idvDueDate),
        idvVerified,
      };
    });

    const officerIdvDates = activeOfficers.filter(o => !o.idvExempt && !o.idvVerified).map(o => o.idvDueDate);
    const pscIdvDates = activePscs.filter(p => !p.idvVerified).map(p => p.idvDueDate);

    return {
      companyNumber: profile.company_number ?? n,
      companyName: profile.company_name ?? '',
      status: profile.company_status ?? 'unknown',
      incorporationDate: profile.date_of_creation ?? '',
      type: profile.type ?? '',
      sicCodes: profile.sic_codes ?? [],
      registeredOffice: parseAddress(profile.registered_office_address),
      accountsNextDue: profile.accounts?.next_due ?? null,
      accountsOverdue: profile.accounts?.overdue ?? false,
      csNextDue: profile.confirmation_statement?.next_due ?? null,
      csOverdue: profile.confirmation_statement?.overdue ?? false,
      nearestOfficerIdvDue: nearestDate(officerIdvDates),
      officersIdvOverdueCount: activeOfficers.filter(o => o.idvOverdue).length,
      nearestPscIdvDue: nearestDate(pscIdvDates),
      pscIdvOverdueCount: activePscs.filter(p => p.idvOverdue).length,
      activeOfficerCount: activeOfficers.length,
      activePscCount: activePscs.length,
      officers: activeOfficers,
      pscs: activePscs,
      chUrl,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof RateLimitError) throw err; // don't swallow — let POST handler return 429
    return {
      companyNumber: n,
      companyName: '',
      status: 'error',
      incorporationDate: '',
      type: '',
      sicCodes: [],
      registeredOffice: {},
      accountsNextDue: null,
      accountsOverdue: false,
      csNextDue: null,
      csOverdue: false,
      nearestOfficerIdvDue: null,
      officersIdvOverdueCount: 0,
      nearestPscIdvDue: null,
      pscIdvOverdueCount: 0,
      activeOfficerCount: 0,
      activePscCount: 0,
      officers: [],
      pscs: [],
      chUrl,
      fetchedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  }
}

// ─── Request schema ───────────────────────────────────────────────────────────

const bodySchema = z.object({
  // Single company per request so the client controls retries and can show progress
  companyNumber: z.string().min(1),
});

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('firm_id')
    .eq('id', user.id)
    .single();
  if (!profile?.firm_id) return NextResponse.json({ error: 'No firm found' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const service = createServiceClient();
  const { data: firm } = await service
    .from('firms')
    .select('ch_api_key')
    .eq('id', profile.firm_id)
    .single();

  const apiKey = (firm as { ch_api_key?: string } | null)?.ch_api_key;
  if (!apiKey) return NextResponse.json({ error: 'NO_API_KEY' }, { status: 422 });

  try {
    const company = await fetchCompany(parsed.data.companyNumber, apiKey);
    return NextResponse.json({ company });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    }
    return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
  }
}
