import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { fetchUserEvents } from '@/lib/googleCalendar';

export interface TimesheetCalendarEvent {
  id: string;
  title: string;
  start: string;       // ISO
  end: string;         // ISO
  startHHmm: string;   // local HH:mm
  minutes: number;
  location?: string;
}

// GET /api/timesheets/calendar?date=YYYY-MM-DD
// The signed-in user's own timed Google Calendar events on that local day.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const date = new URL(req.url).searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: tok } = await supabase
    .from('calendar_tokens')
    .select('google_access_token, google_refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!tok?.google_refresh_token) return NextResponse.json({ connected: false, events: [] });

  // Query a generous ±window around the day (in UTC), then filter by the
  // event's own wall-clock date/time so timezones are handled correctly
  // regardless of the server's timezone.
  const dayStartMs = Date.parse(`${date}T00:00:00Z`);
  const timeMin = new Date(dayStartMs - 12 * 3600_000).toISOString();
  const timeMax = new Date(dayStartMs + 36 * 3600_000).toISOString();

  try {
    const { events, newAccessToken } = await fetchUserEvents(
      tok.google_access_token ?? '',
      tok.google_refresh_token,
      timeMin,
      timeMax,
    );

    const mapped: TimesheetCalendarEvent[] = events
      // Timed events (skip all-day) whose wall-clock start date is this day.
      .filter(e => e.start.includes('T') && e.start.slice(0, 10) === date)
      .map(e => {
        // Wall-clock time is encoded in the ISO string (e.g. ...T14:30:00+01:00).
        const m = e.start.match(/T(\d{2}):(\d{2})/);
        const startHHmm = m ? `${m[1]}:${m[2]}` : '09:00';
        const minutes = Math.max(15, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000));
        return {
          id: e.id,
          title: e.title || 'Untitled event',
          start: e.start,
          end: e.end,
          startHHmm,
          minutes,
          location: e.location,
        };
      })
      .sort((a, b) => a.startHHmm.localeCompare(b.startHHmm));

    // Persist a refreshed access token if Google handed us one.
    if (newAccessToken && newAccessToken !== tok.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    return NextResponse.json({ connected: true, events: mapped });
  } catch (err) {
    console.error('[/api/timesheets/calendar]', err);
    return NextResponse.json({ connected: true, events: [] });
  }
}
