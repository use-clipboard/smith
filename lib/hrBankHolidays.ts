/**
 * UK Bank Holiday sync.
 *
 * Pulls the official feed at https://www.gov.uk/bank-holidays.json (no auth,
 * no rate limits in practice) and writes one hr_holiday_requests row per
 * user × per bank holiday in the configured horizon. Idempotent.
 */
import { createServiceClient } from '@/lib/supabase-server';
import { addCalendarEventForUser } from '@/lib/hrCalendarPush';

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

  // Read settings — bail if disabled. We deliberately surface the real
  // Postgres error so callers can tell "migration not run" from "toggle off".
  const { data: settings, error: settingsErr } = await service
    .from('firm_hr_settings')
    .select('bank_holidays_enabled, bank_holidays_region, push_to_calendar_default')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (settingsErr) {
    const msg = settingsErr.message ?? '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      throw new Error(
        'Bank-holiday columns are missing on firm_hr_settings. The 20260510_hr_bank_holidays migration has not been applied to this Supabase project.'
      );
    }
    throw new Error(`Could not read firm_hr_settings: ${msg}`);
  }
  if (!settings) {
    throw new Error('No firm_hr_settings row found for this firm. Save HR settings once first, then try again.');
  }
  if (!settings.bank_holidays_enabled) {
    throw new Error('Bank holidays toggle is currently OFF in the database. Toggle it on, then click Sync now (the button auto-saves before syncing).');
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
  const { data: users, error: usersErr } = await service
    .from('users')
    .select('id')
    .eq('firm_id', firmId);
  if (usersErr) throw new Error(`Could not load users for firm: ${usersErr.message}`);
  const userIds = (users ?? []).map(u => u.id);
  if (userIds.length === 0) {
    throw new Error('Sync ran but found 0 users in this firm. Check that users.firm_id is set correctly.');
  }

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

  // Insert in batches of 500 to avoid Postgres row-limit hiccups. Use .select()
  // so we get back the inserted rows for the Google Calendar push step.
  let inserted = 0;
  const insertedRows: Array<{ id: string; user_id: string; start_date: string; end_date: string; bank_holiday_title: string | null }> = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { data, error, count } = await service
      .from('hr_holiday_requests')
      .insert(batch, { count: 'exact' })
      .select('id, user_id, start_date, end_date, bank_holiday_title');
    if (error) {
      console.error('[syncBankHolidaysForFirm] batch insert failed:', error);
      throw error;
    }
    inserted += count ?? batch.length;
    if (data) insertedRows.push(...data);
  }

  // Push to Google Calendar (best-effort, per user). Only when the firm has the
  // push toggle on. addCalendarEventForUser returns null when the user hasn't
  // connected their Google Calendar — that's fine, we just skip.
  if (settings.push_to_calendar_default && insertedRows.length > 0) {
    await pushBankHolidayRowsToCalendar(firmId, insertedRows);
  }

  await service.from('firm_hr_settings').update({ bank_holidays_last_synced_at: new Date().toISOString() }).eq('firm_id', firmId);
  return { inserted, total_holidays: upcoming.length, users: userIds.length };
}

/** Best-effort Google Calendar push for newly-inserted bank-holiday rows. */
async function pushBankHolidayRowsToCalendar(
  firmId: string,
  rows: Array<{ id: string; user_id: string; start_date: string; end_date: string; bank_holiday_title: string | null }>,
) {
  const service = createServiceClient();
  for (const r of rows) {
    try {
      const eventId = await addCalendarEventForUser({
        userId: r.user_id,
        firmId,
        startDate: r.start_date,
        startHalf: 'full',
        endDate: r.end_date,
        endHalf: 'full',
        summary: r.bank_holiday_title ?? 'Bank holiday',
      });
      if (eventId) {
        await service
          .from('hr_holiday_requests')
          .update({ pushed_to_calendar: true, google_calendar_event_id: eventId })
          .eq('id', r.id);
      }
    } catch (e) {
      // Don't fail the whole sync for one user's calendar error
      console.error('[bank holidays] calendar push failed for', r.user_id, e);
    }
  }
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
    .select('bank_holidays_enabled, bank_holidays_region, push_to_calendar_default')
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
  const { data, error, count } = await service
    .from('hr_holiday_requests')
    .insert(rows, { count: 'exact' })
    .select('id, user_id, start_date, end_date, bank_holiday_title');
  if (error) {
    console.error('[ensureBankHolidaysForUser] insert failed:', error);
    return 0;
  }
  if (settings.push_to_calendar_default && data && data.length > 0) {
    await pushBankHolidayRowsToCalendar(firmId, data);
  }
  return count ?? rows.length;
}
