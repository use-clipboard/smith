import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getCalendarAuthUrl } from '@/lib/googleCalendar';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('google-calendar')) {
    return NextResponse.json({ error: 'Google Calendar module not active' }, { status: 403 });
  }

  const url = getCalendarAuthUrl();
  return NextResponse.redirect(url);
}
