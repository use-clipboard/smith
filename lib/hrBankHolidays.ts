/**
 * UK Bank Holiday sync.
 *
 * Pulls the official feed at https://www.gov.uk/bank-holidays.json (no auth,
 * no rate limits in practice) and writes one hr_holiday_requests row per
 * user × per bank holiday in the configured horizon. Idempotent.
 */
import { createServiceClient } from '@/lib/supabase-server';

interface GovUkEvent {
  title: string;
  date: string; // YYYY-MM-DD
  notes?: string;
  bunting?: boolean;
}
interface GovUkRegion {
  division: string;
  events: GovUkEvent[];
}
interface GovUkFeed {
  'england-and-wales': GovUkRegion;
  scotland: GovUkRegion;
  'northern-ireland': GovUkRegion;
}

export type BankHolidayRegion = 'england-and-wales' | 'scotland' | 'northern-ireland';

/** Fetches the gov.uk bank-holidays JSON feed for a single region. */
export async function fetchBankHolidays(region: BankHolidayRegion): Promise<GovUkEvent[]> {
  const res = await fetch('https://www.gov.uk/bank-holidays.json', { next: { revalidate: 60 * 60 * 12 } });
  if (!res.ok) throw new Error(`Bank holiday feed returned ${res.status}`);
  const feed = await res.json() as GovUkFeed;
  return feed[region]?.events ?? [];
}

/**
 * Sync bank holidays for one firm.
 *
 * @param firmId   — the firm whose users get holiday rows
 * @param actorId  — who's running the sync (recorded as decided_by)
 * @param horizonYears — how many years ahead to materialise (default 2)
 * @returns count of rows inserted
 */
export async function syncBankHolidaysForFirm({
  firmId,
  actorId,
  horizonYears = 2,
}: {
  firmId: string;
  actorId: string;
  horizonYears?: number;
}): Promise<{ inserted: number; total_holidays: number; users: number }> {
  const service = createServiceClient();

  // Read settings — bail if disabled
  const { data: settings } = await service
    .from('firm_hr_settings')
    .select('bank_holidays_enabled, bank_holidays_region')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!settings?.bank_holidays_enabled) {
    return { inserted: 0, total_holidays: 0, users: 0 };
  }

  const region = (settings.bank_holidays_region ?? 'england-and-wales') as BankHolidayRegion;
  const events = await fetchBankHolidays(region);

  // Filter: from today through horizonYears ahead (inclusive of the year-end)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setUTCFullYear(horizon.getUTCFullYear() + horizonYears);
  const upcoming = events.filter(e => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d.getTime() >= today.getTime() && d.getTime() <= horizon.getTime();
  });

  if (upcoming.length === 0) {
    return { inserted: 0, total_holidays: 0, users: 0 };
  }

  // Active users in the firm
  const { data: users } = await service
    .from('users')
    .select('id')
    .eq('firm_id', firmId);
  const userIds = (users ?? []).map(u => u.id);
  if (userIds.length === 0) return { inserted: 0, total_holidays: upcoming.length, users: 0 };

  // Existing bank-holiday rows so we don't duplicate
  const { data: existing } = await service
    .from('hr_holiday_requests')
    .select('user_id, start_date')
    .eq('firm_id', firmId)
    .eq('is_bank_holiday', true);
  const existingKey = new Set((existing ?? []).map(e => `${e.user_id}|${e.start_date}`));

  // Build the insert batch
  const rows: Record<string, unknown>[] = [];
  for (const u of userIds) {
    for (const ev of upcoming) {
      if (existingKey.has(`${u}|${ev.date}`)) continue;
      rows.push({
        firm_id: firmId,
        user_id: u,
        manager_id: null,
        start_date: ev.date,
        start_half: 'full',
        end_date: ev.date,
        end_half: 'full',
        total_days: 1,
        reason: ev.title,
        status: 'approved',
        source: 'direct',
        decided_by: actorId,
        decided_at: new Date().toISOString(),
        is_bank_holiday: true,
        bank_holiday_title: ev.title,
      });
    }
  }

  if (rows.length === 0) {
    // Nothing new — still update the last_synced timestamp
    await service.from('firm_hr_settings').update({ bank_holidays_last_synced_at: new Date().toISOString() }).eq('firm_id', firmId);
    return { inserted: 0, total_holidays: upcoming.length, users: userIds.length };
  }

  // Insert in batches of 500 to avoid Postgres row-limit hiccups
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error, count } = await service.from('hr_holiday_requests').insert(batch, { count: 'exact' });
    if (error) {
      console.error('[syncBankHolidaysForFirm] batch insert failed:', error);
      throw error;
    }
    inserted += count ?? batch.length;
  }

  await service.from('firm_hr_settings').update({ bank_holidays_last_synced_at: new Date().toISOString() }).eq('firm_id', firmId);
  return { inserted, total_holidays: upcoming.length, users: userIds.length };
}

/**
 * Lazy sync just for one user. Used by the holidays/balance endpoint to catch
 * new joiners — if bank holidays are enabled and they don't have rows for the
 * upcoming bank holidays, create them. Cheap because it only touches one user.
 */
export async function ensureBankHolidaysForUser({
  userId,
  firmId,
  horizonYears = 2,
}: {
  userId: string;
  firmId: string;
  horizonYears?: number;
}): Promise<number> {
  const service = createServiceClient();
  const { data: settings } = await service
    .from('firm_hr_settings')
    .select('bank_holidays_enabled, bank_holidays_region')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!settings?.bank_holidays_enabled) return 0;

  const region = (settings.bank_holidays_region ?? 'england-and-wales') as BankHolidayRegion;
  const events = await fetchBankHolidays(region);

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setUTCFullYear(horizon.getUTCFullYear() + horizonYears);
  const upcoming = events.filter(e => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d.getTime() >= today.getTime() && d.getTime() <= horizon.getTime();
  });
  if (upcoming.length === 0) return 0;

  const { data: existing } = await service
    .from('hr_holiday_requests')
    .select('start_date')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .eq('is_bank_holiday', true);
  const existingDates = new Set((existing ?? []).map(e => e.start_date));

  const rows = upcoming
    .filter(ev => !existingDates.has(ev.date))
    .map(ev => ({
      firm_id: firmId,
      user_id: userId,
      manager_id: null,
      start_date: ev.date,
      start_half: 'full',
      end_date: ev.date,
      end_half: 'full',
      total_days: 1,
      reason: ev.title,
      status: 'approved',
      source: 'direct',
      decided_by: null,
      decided_at: new Date().toISOString(),
      is_bank_holiday: true,
      bank_holiday_title: ev.title,
    }));

  if (rows.length === 0) return 0;
  const { error, count } = await service.from('hr_holiday_requests').insert(rows, { count: 'exact' });
  if (error) {
    console.error('[ensureBankHolidaysForUser] insert failed:', error);
    return 0;
  }
  return count ?? rows.length;
}
