import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { syncCHDeadlineLinks } from '@/lib/chDeadlineSync';

// ─── Resumable cron architecture ──────────────────────────────────────────────
// The Companies House refresh used to fetch every company for every firm in a
// single function invocation. Vercel's 5-minute function cap killed it on any
// firm > ~200 companies, and a single CH 429 (5m10s cool-off) killed it
// immediately. The result was that scheduled refreshes silently never landed.
//
// Now the cron is split across ticks:
//   - Tick fires every 30 minutes (configured in vercel.json).
//   - For each firm with a CH key + schedule:
//       * If there's already a running job for that firm, RESUME it.
//       * Otherwise, if the schedule says "due now", START a fresh job by
//         loading the company list and parking it in remaining_numbers.
//       * Otherwise, skip.
//   - Process companies one at a time, persisting progress after each.
//   - Stop after PROCESS_BUDGET_MS so the function exits well before the
//     hard 5-minute Vercel limit. The next tick (in 30 min) picks up.
//   - When remaining_numbers empties, flush the accumulated results into
//     ch_cache and mark the job idle.
//
// From the user's perspective: the refresh "starts at the scheduled time and
// takes as long as it takes" — they just don't see the multi-tick mechanics.
// Worst-case for a 500-company firm with rate limiting: ~3 ticks = 90 min.

const CH_BASE = 'https://api.company-information.service.gov.uk';
const INTRA_DELAY = 200;
// How long a single cron invocation is allowed to spend processing before it
// saves state and bails. 4 minutes leaves a comfortable margin under Vercel's
// 5-minute hard cap for the final upsert + response.
const PROCESS_BUDGET_MS = 4 * 60 * 1000;

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ─── Verify this request came from Vercel's cron scheduler ───────────────────
// Vercel sets the Authorization header to Bearer <CRON_SECRET> on cron requests.
function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[CH Cron] CRON_SECRET env var not set — allowing request. Set it in Vercel env vars to secure this endpoint.');
    return true;
  }
  const auth = request.headers.get('authorization');
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
    const wrappedDiff = Math.min(diffMins, 1440 - diffMins); // handle midnight crossing
    return wrappedDiff <= 15; // within 15 min of the scheduled time
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

// Fetch ONE company's profile + officers + PSCs. On rate-limit, this now
// PROPAGATES the RateLimitError up to the caller instead of sleeping 5m10s
// internally — that internal sleep guaranteed we'd blow the Vercel budget.
// The cron loop catches the error, leaves the number in remaining_numbers,
// and exits the tick. The next tick (~30 min later) is well past CH's
// 5-minute rate-limit window so the retry just works.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCompany(number: string, apiKey: string): Promise<any> {
  const n = number.trim().toUpperCase().padStart(8, '0');
  const chUrl = `https://find-and-update.company-information.service.gov.uk/company/${n}`;

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

    const CORPORATE_PSC_KINDS = new Set([
      'corporate-entity-person-with-significant-control',
      'legal-person-with-significant-control',
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activePscs = (pscData.items ?? []).filter((p: any) => !p.ceased_on).map((p: any) => {
      const kind = p.kind ?? '';
      const idvExempt = CORPORATE_PSC_KINDS.has(kind);
      if (idvExempt) {
        return {
          name: p.name ?? p.description ?? '', kind, notifiedOn: p.notified_on ?? '',
          naturesOfControl: p.natures_of_control ?? [], address: parseAddress(p.address),
          dateOfBirth: undefined, idvDueDate: null, idvOverdue: false, idvVerified: false, idvExempt: true,
        };
      }
      const idvDueDate = getIdvDueDate(p, p.notified_on);
      const idvVerified = hasVerification(p);
      return {
        name: p.name ?? p.description ?? '', kind, notifiedOn: p.notified_on ?? '',
        naturesOfControl: p.natures_of_control ?? [], address: parseAddress(p.address),
        dateOfBirth: p.date_of_birth ? { month: p.date_of_birth.month, year: p.date_of_birth.year } : undefined,
        idvDueDate, idvOverdue: !idvVerified && isIdvOverdue(idvDueDate), idvVerified, idvExempt: false,
      };
    });

    const officerIdvDates = activeOfficers.filter((o: { idvVerified: boolean; idvExempt: boolean }) => !o.idvExempt && !o.idvVerified).map((o: { idvDueDate: string | null }) => o.idvDueDate);
    const pscIdvDates = activePscs.filter((p: { idvExempt: boolean; idvVerified: boolean }) => !p.idvExempt && !p.idvVerified).map((p: { idvDueDate: string | null }) => p.idvDueDate);

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
      // Re-throw so the cron loop pauses for this tick.
      throw err;
    }
    // Non-429 error: persist a stub row so it's visible in the UI and the
    // company doesn't get retried forever. The user can manually re-run if
    // needed.
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

// ─── Job state types ──────────────────────────────────────────────────────────
interface JobRow {
  firm_id: string;
  status: 'idle' | 'running';
  refresh_type: 'scheduled' | 'manual' | null;
  started_at: string | null;
  last_tick_at: string | null;
  remaining_numbers: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processed_companies: any[];
  error_count: number;
  total_count: number;
  /** Per-number consecutive error count. Cleared on a successful fetch. */
  failures_by_number: Record<string, number>;
  /** Numbers that hit the failure threshold during this run and were parked. */
  skipped_numbers: string[];
}

function emptyJob(firmId: string): JobRow {
  return {
    firm_id: firmId, status: 'idle', refresh_type: null,
    started_at: null, last_tick_at: null,
    remaining_numbers: [], processed_companies: [],
    error_count: 0, total_count: 0,
    failures_by_number: {}, skipped_numbers: [],
  };
}

function jobUpsertPayload(job: JobRow): Record<string, unknown> {
  return {
    firm_id:             job.firm_id,
    status:              job.status,
    refresh_type:        job.refresh_type,
    started_at:          job.started_at,
    last_tick_at:        job.last_tick_at,
    remaining_numbers:   job.remaining_numbers,
    processed_companies: job.processed_companies,
    error_count:         job.error_count,
    total_count:         job.total_count,
    failures_by_number:  job.failures_by_number,
    skipped_numbers:     job.skipped_numbers,
    updated_at:          new Date().toISOString(),
  };
}

/** Per-number error count at which we give up on that company for this run. */
const MAX_NUMBER_FAILURES = 3;
/** A 'running' job whose last_tick_at is older than this is treated as crashed. */
const STALE_RUNNING_HOURS = 2;

// ─── GET handler (called by Vercel cron every 30 minutes) ────────────────────
export const maxDuration = 300; // Pro plan: 5 minute max execution

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const tickStartedAt = Date.now();
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

  // Fairness: order firms by how long it's been since their last successful
  // refresh. Without this, PostgREST's default order means firm A (first in
  // the list) hogs every tick's 4-minute budget on big firms, and firm B
  // (further down) never gets processed. The single-firm case sees no
  // change; only matters once there are 2+ firms with overlapping schedules.
  const { data: lastRuns } = await service
    .from('ch_cache')
    .select('firm_id, refreshed_at');
  const lastRunByFirm = new Map<string, string>();
  for (const r of (lastRuns ?? []) as { firm_id: string; refreshed_at: string | null }[]) {
    if (r.refreshed_at) lastRunByFirm.set(r.firm_id, r.refreshed_at);
  }
  const orderedFirms = [...firms].sort((a, b) => {
    const ta = lastRunByFirm.get(a.id);
    const tb = lastRunByFirm.get(b.id);
    // Firms with no recorded refresh go first (most-starved wins).
    if (!ta && !tb) return 0;
    if (!ta) return -1;
    if (!tb) return 1;
    return new Date(ta).getTime() - new Date(tb).getTime();
  });

  const results: Array<{ firmId: string; action: string; processed: number; remaining: number }> = [];

  for (const firm of orderedFirms) {
    const f = firm as {
      id: string;
      ch_api_key: string;
      ch_refresh_times: string[];
      ch_company_numbers: string[] | null;
      ch_refresh_list_type: string | null;
    };

    // Bail early if this firm's tick budget has already been spent. Other
    // firms in this list get picked up by future ticks.
    if (Date.now() - tickStartedAt > PROCESS_BUDGET_MS) {
      results.push({ firmId: f.id, action: 'skipped_budget', processed: 0, remaining: 0 });
      continue;
    }

    // Load existing job state (one row per firm). Missing row → implicit idle.
    const { data: existing } = await service
      .from('ch_refresh_jobs')
      .select('*')
      .eq('firm_id', f.id)
      .maybeSingle();
    let job: JobRow = (existing as JobRow | null) ?? emptyJob(f.id);
    // Older rows pre-date the resilience columns — coerce so the rest of the
    // tick can assume both fields are present.
    job.failures_by_number = job.failures_by_number ?? {};
    job.skipped_numbers    = job.skipped_numbers    ?? [];

    // Stale-job recovery: a 'running' row whose last_tick_at is hours old
    // means a previous tick crashed mid-loop (Vercel termination, OOM, etc.)
    // and the resume path would otherwise re-attempt the same stuck number
    // forever. Treat it as crashed: log, reset to idle, then fall through
    // to the normal isDueNow check so we either start fresh or skip cleanly.
    if (job.status === 'running' && job.last_tick_at) {
      const ageMs = Date.now() - new Date(job.last_tick_at).getTime();
      if (ageMs > STALE_RUNNING_HOURS * 3600 * 1000) {
        console.warn(`[CH Cron] Firm ${f.id} — stale running job (last_tick_at ${job.last_tick_at}), resetting`);
        job = emptyJob(f.id);
        await service.from('ch_refresh_jobs').upsert(jobUpsertPayload(job), { onConflict: 'firm_id' });
      }
    }

    // Decide whether to start a new run, resume an in-flight one, or skip.
    if (job.status === 'running' && job.remaining_numbers.length > 0) {
      // Resume — leave job state as-is.
      console.log(`[CH Cron] Firm ${f.id} — resuming, ${job.remaining_numbers.length} remaining of ${job.total_count}, skipped so far: ${job.skipped_numbers.length}`);
    } else if (isDueNow(f.ch_refresh_times)) {
      // Start a fresh run.
      const listType = f.ch_refresh_list_type ?? 'client_list';
      let numbers: string[] = [];
      if (listType === 'custom_list') {
        numbers = f.ch_company_numbers ?? [];
      } else {
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
        results.push({ firmId: f.id, action: 'skipped_empty', processed: 0, remaining: 0 });
        continue;
      }
      job = {
        firm_id: f.id,
        status: 'running',
        refresh_type: 'scheduled',
        started_at: new Date().toISOString(),
        last_tick_at: new Date().toISOString(),
        remaining_numbers: numbers,
        processed_companies: [],
        error_count: 0,
        total_count: numbers.length,
        failures_by_number: {},
        skipped_numbers: [],
      };
      console.log(`[CH Cron] Firm ${f.id} — starting fresh run, ${numbers.length} companies`);
    } else {
      // Not due, not in flight — skip this firm this tick.
      continue;
    }

    // Process companies one by one. Persist after each so a function
    // termination (Vercel timeout, deploy, crash) never loses more than the
    // company currently being fetched.
    let processedThisTick = 0;
    while (job.remaining_numbers.length > 0) {
      if (Date.now() - tickStartedAt > PROCESS_BUDGET_MS) {
        console.log(`[CH Cron] Firm ${f.id} — budget spent, parking with ${job.remaining_numbers.length} remaining`);
        break;
      }
      const next = job.remaining_numbers[0];
      try {
        const result = await fetchCompany(next, f.ch_api_key);
        job.remaining_numbers = job.remaining_numbers.slice(1);
        job.processed_companies = [...job.processed_companies, result];
        if (result.status === 'error') job.error_count += 1;
        processedThisTick += 1;
        // Successful fetch — clear any prior failure streak on this number.
        if (job.failures_by_number[next] !== undefined) {
          const failures = { ...job.failures_by_number };
          delete failures[next];
          job.failures_by_number = failures;
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          // Don't consume the number — it'll be retried on the next tick
          // (~30 min from now), which is well past CH's 5-minute rate-limit
          // window. Save state (so the staleness check doesn't trip on the
          // next tick) and stop processing for this firm.
          console.log(`[CH Cron] Firm ${f.id} — rate limited at ${next}, parking with ${job.remaining_numbers.length} remaining`);
          job.last_tick_at = new Date().toISOString();
          await service.from('ch_refresh_jobs').upsert(jobUpsertPayload(job), { onConflict: 'firm_id' });
          break;
        }
        // Non-rate-limit error on this specific number. Bump its per-number
        // counter. If it's hit the threshold, park it (move to skipped_numbers
        // and drop from remaining) so the rest of the run can continue.
        // Otherwise persist the bumped count and break to retry next tick.
        console.error(`[CH Cron] Firm ${f.id} — error on ${next}`, err);
        const failCount = (job.failures_by_number[next] ?? 0) + 1;
        if (failCount >= MAX_NUMBER_FAILURES) {
          console.warn(`[CH Cron] Firm ${f.id} — ${next} hit ${failCount} consecutive failures, parking`);
          job.remaining_numbers = job.remaining_numbers.slice(1);
          job.skipped_numbers   = [...job.skipped_numbers, next];
          const failures = { ...job.failures_by_number };
          delete failures[next];
          job.failures_by_number = failures;
          job.error_count += 1;
          job.last_tick_at = new Date().toISOString();
          await service.from('ch_refresh_jobs').upsert(jobUpsertPayload(job), { onConflict: 'firm_id' });
          continue; // move on to the next company in this same tick
        }
        job.failures_by_number = { ...job.failures_by_number, [next]: failCount };
        job.last_tick_at = new Date().toISOString();
        await service.from('ch_refresh_jobs').upsert(jobUpsertPayload(job), { onConflict: 'firm_id' });
        break;
      }
      // Persist after each company so we never lose more than the in-flight one.
      job.last_tick_at = new Date().toISOString();
      await service.from('ch_refresh_jobs').upsert(jobUpsertPayload(job), { onConflict: 'firm_id' });
    }

    // Flush + clear when this firm's run is complete.
    if (job.remaining_numbers.length === 0 && job.processed_companies.length > 0) {
      const total       = job.total_count;
      const errors      = job.error_count;
      const skipped     = job.skipped_numbers;
      const cacheStatus = errors === 0 ? 'success' : errors === total ? 'failed' : 'partial';

      // Build an error message that calls out parked numbers explicitly —
      // users want to know which clients to look at, not just a count.
      const errorMessage = errors > 0
        ? skipped.length > 0
          ? `${errors} of ${total} companies failed (parked after repeated errors: ${skipped.join(', ')})`
          : `${errors} of ${total} companies failed`
        : null;

      await service.from('ch_cache').upsert({
        firm_id:                 f.id,
        companies:               job.processed_companies,
        refreshed_at:            new Date().toISOString(),
        refresh_status:          cacheStatus,
        refresh_type:            job.refresh_type ?? 'scheduled',
        refresh_error:           errorMessage,
        companies_fetched:       job.processed_companies.length - errors,
        companies_total:         total,
        skipped_company_numbers: skipped,
      }, { onConflict: 'firm_id' });

      // Clear the job back to idle so the next scheduled tick can start fresh.
      await service.from('ch_refresh_jobs').upsert(jobUpsertPayload(emptyJob(f.id)), { onConflict: 'firm_id' });

      // Slide / renew any task linked to one of these deadlines now the
      // fresh data is in the cache. Non-fatal — if this errors the cache
      // upsert above has still completed and the user sees current data.
      try {
        const linkSummary = await syncCHDeadlineLinks(service, f.id, job.processed_companies);
        console.log(`[CH Cron] Firm ${f.id} — deadline links sync:`, linkSummary);
      } catch (e) {
        console.error(`[CH Cron] Firm ${f.id} — deadline links sync failed`, e);
      }

      console.log(`[CH Cron] Firm ${f.id} — completed. ${job.processed_companies.length - errors}/${total} succeeded.`);
      results.push({ firmId: f.id, action: 'completed', processed: processedThisTick, remaining: 0 });
    } else {
      results.push({ firmId: f.id, action: 'progress_saved', processed: processedThisTick, remaining: job.remaining_numbers.length });
    }
  }

  return NextResponse.json({ tickMs: Date.now() - tickStartedAt, firms: results });
}
