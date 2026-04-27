import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { fetchUserEvents } from '@/lib/googleCalendar';

/**
 * GET /api/calendar/reminders
 * Returns only the current user's own upcoming events for the next 24 hours.
 * Lightweight endpoint used exclusively by CalendarReminderBanner — avoids the
 * team-visibility complexity of /api/calendar/events.
 */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ events: [] });

  const supabase = createClient();

  const { data: token } = await supabase
    .from('calendar_tokens')
    .select('google_access_token, google_refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!token?.google_refresh_token) {
    return NextResponse.json({ events: [], connected: false });
  }

  const now = new Date();
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const { events, newAccessToken } = await fetchUserEvents(
      token.google_access_token ?? '',
      token.google_refresh_token,
      now.toISOString(),
      end.toISOString()
    );

    // Persist a refreshed token if needed
    if (newAccessToken && newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    // Return only timed (non all-day) events with the fields the banner needs
    const upcoming = events
      .filter(e => e.start.includes('T'))
      .map(e => ({
        id:       e.id,
        title:    e.title,
        start:    e.start,
        end:      e.end,
        htmlLink: e.htmlLink,
        meetLink: e.meetLink,
      }));

    return NextResponse.json({ events: upcoming, connected: true });
  } catch (err) {
    console.error('Calendar reminders fetch error:', err);
    return NextResponse.json({ events: [], connected: true, error: 'fetch_failed' });
  }
}
