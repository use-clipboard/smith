import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Re-use the same CH fetch logic as the main endpoint
const CH_BASE = 'https://api.company-information.service.gov.uk';
const INTRA_DELAY = 200;

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ─── Verify this request came from Vercel's cron scheduler ───────────────────
// Vercel sets the Authorization header to Bearer <CRON_SECRET> on cron requests.
function isAuthorisedCron(request: Request): boolean {
  const auth = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured in env
  return auth === `Bearer ${secret}`;
}

// ─── London time helpers ──────────────────────────────────────────────────────
function londonHHMM(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isDueNow(times: string[]): boolean {
  if (!times || times.length === 0) return false;
  const now = londonHHMM();
  // Match within a 30-minute window (cron runs every 30 min)
  return times.some(t => {
    const [th, tm] = t.split(':').map(Number);
    const [nh, nm] = now.split(':').map(Number);
    const diffMins = Math.abs((th * 60 + tm) - (nh * 60 + nm));
    return diffMins <= 15; // within 15 min of the scheduled time
  });
}

// ─── IDV helpers (duplicated from main route to keep cron self-contained) ────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getIdvDueDate(record: any, appointedOn: string | undefined): string | null {
  const ivd = record.identity_verification_details ?? null;
  const apiDue = ivd?.appointment_verification_statement_due_on
    ?? record.appointment_verification_statement_due_on
    ?? ivd?.appointment_verification_statement_date
    ?? record.verification_stmt_due_date
    ?? null;
  if (apiDue) return apiDue;
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
function isActiveStatement(startOn: string | undefined, endOn: string | undefined): boolean {
  if (!startOn) return false;
  if (!endOn) return true;
  return endOn > new Date().toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasVerification(record: any): boolean {
  const ivd = record.identity_verification_details ?? null;
  if (ivd?.identity_verified_on) return true;
  if (isActiveStatement(ivd?.appointment_verification_start_on, ivd?.appointment_verification_end_on)) return true;
  if (record.appointment_verification_eff_date) return true;
  if (isActiveStatement(record.appointment_verification_start_on, record.appointment_verification_end_on)) return true;
  if (record.verification_details?.verification_date) return true;
  if (Array.isArray(record.verification_details?.verification_statements) &&
      record.verification_details.verification_statements.length > 0) return true;
  return false;
}
function isIdvOverdue(d: string | null): boolean {
  return !!d && d < new Date().toISOString().slice(0, 10);
}
function nearestDate(dates: (string | null)[]): string | null {
  const v = dates.filter(Boolean) as string[];
  return v.length ? v.sort()[0] : null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAddress(raw: any) {
  if (!raw) return {};
  return {
    addressLine1: raw.address_line_1, addressLine2: raw.address_line_2,
    locality: raw.locality, region: raw.region,
    postalCode: raw.postal_code, country: raw.country,
  };
}

class RateLimitError extends Error { constructor() { super('RATE_LIMITED'); } }

async function chFetch(path: string, apiKey: string): Promise<unknown> {
  const credentials = Buffer.from(`${apiKey.trim()}:`).toString('base64');
  const res = await fetch(`${CH_BASE}${path}`, {
    headers: { Authorization: `Basic ${credentials}` },
    cache: 'no-store',
  });
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`CH ${res.status} for ${path}`);
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCompanyWithRetry(number: string, apiKey: string): Promise<any> {
  const n = number.trim().toUpperCase().padStart(8, '0');
  const chUrl = `https://find-and-update.company-information.service.gov.uk/company/${n}`;
  let retryDelay = 310_000; // 5m10s in ms

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profile = await chFetch(`/company/${n}`, apiKey) as any;
      await sleep(INTRA_DELAY);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const officersData = await chFetch(`/company/${n}/officers?items_per_page=100`, apiKey).catch(e => {
        if (e instanceof RateLimitError) throw e;
        return { items: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      await sleep(INTRA_DELAY);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pscData = await chFetch(`/company/${n}/persons-with-significant-control?items_per_page=100`, apiKey).catch(e => {
        if (e instanceof RateLimitError) throw e;
        return { items: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

      const SECRETARY_ROLES = new Set(['secretary', 'corporate-secretary', 'nominee-secretary']);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeOfficers = (officersData.items ?? []).filter((o: any) => !o.resigned_on).map((o: any) => {
        const isSecretary = SECRETARY_ROLES.has((o.officer_role ?? '').toLowerCase());
        if (isSecretary) {
          return {
            name: o.name ?? '', role: o.officer_role ?? '', appointedOn: o.appointed_on ?? '',
            dateOfBirth: o.date_of_birth ? { month: o.date_of_birth.month, year: o.date_of_birth.year } : undefined,
            address: parseAddress(o.address), idvDueDate: null,
            idvOverdue: false, idvVerified: false, idvExempt: true,
          };
        }
        const idvDueDate = getIdvDueDate(o, o.appointed_on);
        const idvVerified = hasVerification(o);
        return {
          name: o.name ?? '', role: o.officer_role ?? '', appointedOn: o.appointed_on ?? '',
          dateOfBirth: o.date_of_birth ? { month: o.date_of_birth.month, year: o.date_of_birth.year } : undefined,
          address: parseAddress(o.address), idvDueDate,
          idvOverdue: !idvVerified && isIdvOverdue(idvDueDate), idvVerified, idvExempt: false,
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activePscs = (pscData.items ?? []).filter((p: any) => !p.ceased_on).map((p: any) => {
        const idvDueDate = getIdvDueDate(p, p.notified_on);
        const idvVerified = hasVerification(p);
        return {
          name: p.name ?? p.description ?? '', kind: p.kind ?? '', notifiedOn: p.notified_on ?? '',
          naturesOfControl: p.natures_of_control ?? [], address: parseAddress(p.address),
          dateOfBirth: p.date_of_birth ? { month: p.date_of_birth.month, year: p.date_of_birth.year } : undefined,
          idvDueDate, idvOverdue: !idvVerified && isIdvOverdue(idvDueDate), idvVerified,
        };
      });

      const officerIdvDates = activeOfficers.filter((o: { idvVerified: boolean; idvExempt: boolean }) => !o.idvExempt && !o.idvVerified).map((o: { idvDueDate: string | null }) => o.idvDueDate);
      const pscIdvDates = activePscs.filter((p: { idvVerified: boolean }) => !p.idvVerified).map((p: { idvDueDate: string | null }) => p.idvDueDate);

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
        officersIdvOverdueCount: activeOfficers.filter((o: { idvOverdue: boolean }) => o.idvOverdue).length,
        nearestPscIdvDue: nearestDate(pscIdvDates),
        pscIdvOverdueCount: activePscs.filter((p: { idvOverdue: boolean }) => p.idvOverdue).length,
        activeOfficerCount: activeOfficers.length, activePscCount: activePscs.length,
        officers: activeOfficers, pscs: activePscs, chUrl,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.log(`[CH Cron] Rate limited — waiting ${retryDelay / 1000}s`);
        await sleep(retryDelay);
        continue;
      }
      return {
        companyNumber: n, companyName: '', status: 'error', incorporationDate: '', type: '',
        sicCodes: [], registeredOffice: {}, accountsNextDue: null, accountsOverdue: false,
        csNextDue: null, csOverdue: false, nearestOfficerIdvDue: null, officersIdvOverdueCount: 0,
        nearestPscIdvDue: null, pscIdvOverdueCount: 0, activeOfficerCount: 0, activePscCount: 0,
        officers: [], pscs: [], chUrl, fetchedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Fetch failed',
      };
    }
  }
}

// ─── GET handler (called by Vercel cron every 30 minutes) ────────────────────
export const maxDuration = 300; // Pro plan: 5 minute max execution

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const service = createServiceClient();

  // Get all firms that have a CH API key and scheduled times
  const { data: firms } = await service
    .from('firms')
    .select('id, ch_api_key, ch_refresh_times, ch_company_numbers, ch_refresh_list_type')
    .not('ch_api_key', 'is', null)
    .not('ch_refresh_times', 'is', null);

  if (!firms || firms.length === 0) {
    return NextResponse.json({ message: 'No firms with schedules' });
  }

  const results: { firmId: string; status: string; count: number }[] = [];

  for (const firm of firms) {
    const f = firm as {
      id: string;
      ch_api_key: string;
      ch_refresh_times: string[];
      ch_company_numbers: string[] | null;
      ch_refresh_list_type: string | null;
    };

    if (!isDueNow(f.ch_refresh_times)) continue;

    const listType = f.ch_refresh_list_type ?? 'client_list';
    console.log(`[CH Cron] Refreshing firm ${f.id} — scheduled at ${f.ch_refresh_times.join(', ')} — list: ${listType}`);

    let numbers: string[] = [];

    if (listType === 'custom_list') {
      // Use the firm's saved custom company number list
      numbers = f.ch_company_numbers ?? [];
      if (numbers.length === 0) {
        console.log(`[CH Cron] Firm ${f.id} — custom list is empty, skipping`);
        continue;
      }
    } else {
      // Use companies_house_id from limited company clients
      const { data: clients } = await service
        .from('clients')
        .select('companies_house_id, business_type')
        .eq('firm_id', f.id)
        .not('companies_house_id', 'is', null);

      numbers = (clients ?? [])
        .filter(c => {
          const bt = (c.business_type ?? '').toLowerCase();
          return bt.includes('limited') || bt.includes('ltd') || bt === 'limited_company';
        })
        .map(c => c.companies_house_id)
        .filter(Boolean) as string[];
    }

    if (numbers.length === 0) {
      console.log(`[CH Cron] Firm ${f.id} — no company numbers, skipping`);
      continue;
    }

    const companies = [];
    let errorCount = 0;

    for (const n of numbers) {
      const result = await fetchCompanyWithRetry(n, f.ch_api_key);
      companies.push(result);
      if (result.status === 'error') errorCount++;
    }

    const status = errorCount === 0 ? 'success' : errorCount === numbers.length ? 'failed' : 'partial';

    await service.from('ch_cache').upsert({
      firm_id: f.id,
      companies,
      refreshed_at: new Date().toISOString(),
      refresh_status: status,
      refresh_type: 'scheduled',
      refresh_error: errorCount > 0 ? `${errorCount} of ${numbers.length} companies failed` : null,
      companies_fetched: companies.length - errorCount,
      companies_total: numbers.length,
    }, { onConflict: 'firm_id' });

    console.log(`[CH Cron] Firm ${f.id} — done. ${companies.length - errorCount}/${numbers.length} succeeded.`);
    results.push({ firmId: f.id, status, count: companies.length });
  }

  return NextResponse.json({ refreshed: results.length, results });
}
