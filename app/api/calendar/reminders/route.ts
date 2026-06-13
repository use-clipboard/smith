import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getUpcomingReminders } from '@/lib/calendarReminders';

/**
 * GET /api/calendar/reminders
 * The current user's own upcoming events for the next 24 hours. Served from a
 * short-TTL server-side cache (see lib/calendarReminders.ts) so the several
 * consumers — dashboard hero + widget, sidebar badge, reminder banner — and
 * repeated page loads don't each trigger a fresh Google Calendar call.
 */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ events: [] });

  const { events, connected } = await getUpcomingReminders(ctx.userId);
  return NextResponse.json({ events, connected });
}
