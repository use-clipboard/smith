import { createServiceClient } from '@/lib/supabase-server';
import { createCalendarEvent } from '@/lib/googleCalendar';

interface PushArgs {
  userId: string;
  firmId: string;
  startDate: string; // YYYY-MM-DD
  startHalf: 'full' | 'morning' | 'afternoon';
  endDate: string;
  endHalf: 'full' | 'morning' | 'afternoon';
  summary: string;
}

/**
 * Push an approved holiday onto the staff member's Google Calendar.
 *
 * Returns the created event ID, or null if the user has no Google Calendar
 * connection. Throws on Google API errors so the caller can decide how loud
 * to be about the failure (we currently log + swallow at the call site).
 */
export async function addCalendarEventForUser(args: PushArgs): Promise<string | null> {
  const service = createServiceClient();

  // Look up the user's refresh token + their firm's half-day boundaries.
  const [{ data: token }, { data: settings }] = await Promise.all([
    service.from('calendar_tokens').select('google_refresh_token').eq('user_id', args.userId).maybeSingle(),
    service.from('firm_hr_settings').select('morning_start, morning_end, afternoon_start, afternoon_end').eq('firm_id', args.firmId).maybeSingle(),
  ]);

  if (!token?.google_refresh_token) return null; // user hasn't connected Google Calendar

  const ms = (settings?.morning_start as string)   ?? '09:00';
  const me = (settings?.morning_end as string)     ?? '13:00';
  const as = (settings?.afternoon_start as string) ?? '13:00';
  const ae = (settings?.afternoon_end as string)   ?? '17:30';
  const trim = (t: string) => t.length >= 5 ? t.slice(0, 5) : t;

  const sameDay = args.startDate === args.endDate;
  const isFullSpan = sameDay && args.startHalf === 'full' && args.endHalf === 'full';
  const isHalfDay = sameDay && (args.startHalf === 'morning' || args.startHalf === 'afternoon');
  const isMultiDayAllFull = !sameDay && args.startHalf === 'full' && args.endHalf === 'full';

  // ── Full-day or multi-day full holiday → all-day Google event ─────────
  if (isFullSpan || isMultiDayAllFull) {
    // Google all-day events: end is exclusive, so add one day
    const endExclusive = new Date(args.endDate + 'T00:00:00Z');
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const endStr = endExclusive.toISOString().slice(0, 10);
    const ev = await createCalendarEvent(token.google_refresh_token, {
      title: args.summary,
      start: args.startDate,
      end: endStr,
      isAllDay: true,
      description: 'Approved holiday — created by Agent Smith HR.',
    });
    return ev.eventId || null;
  }

  // ── Single half-day → timed event for the relevant half ───────────────
  if (isHalfDay) {
    const half = args.startHalf;
    const startHHMM = half === 'morning' ? trim(ms) : trim(as);
    const endHHMM   = half === 'morning' ? trim(me) : trim(ae);
    const ev = await createCalendarEvent(token.google_refresh_token, {
      title: `${args.summary} (${half})`,
      start: `${args.startDate}T${startHHMM}:00`,
      end:   `${args.startDate}T${endHHMM}:00`,
      isAllDay: false,
      description: 'Approved half-day holiday — created by Agent Smith HR.',
    });
    return ev.eventId || null;
  }

  // ── Multi-day with mixed halves → an all-day span across the full days,
  //    we don't separately model the half tails on the boundary days for now.
  //    (Edge case; can be refined in Phase 2.) ───────────────────────────
  const endExclusive = new Date(args.endDate + 'T00:00:00Z');
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endStr = endExclusive.toISOString().slice(0, 10);
  const ev = await createCalendarEvent(token.google_refresh_token, {
    title: args.summary,
    start: args.startDate,
    end: endStr,
    isAllDay: true,
    description: `Approved holiday — created by Agent Smith HR. Note: starts ${args.startHalf}, ends ${args.endHalf}.`,
  });
  return ev.eventId || null;
}
