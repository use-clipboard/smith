import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createCalendarEvent } from '@/lib/googleCalendar';

const ScheduleMeetingSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1),
  start: z.string(),
  end: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  additionalAttendeeEmails: z.array(z.string().email()).optional(),
});

/** POST /api/calendar/meetings — schedule a meeting with a client */
export async function POST(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('google-calendar')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = ScheduleMeetingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();

  // Verify client belongs to this firm and get their email
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, contact_email')
    .eq('id', parsed.data.clientId)
    .eq('firm_id', ctx.firmId)
    .single();

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { data: token } = await supabase
    .from('calendar_tokens')
    .select('google_refresh_token, google_access_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!token?.google_refresh_token) {
    return NextResponse.json({ error: 'Google Calendar not connected. Please connect your calendar in Settings first.' }, { status: 400 });
  }

  // Build attendee list: client + any additional attendees
  const attendeeEmails: string[] = [];
  if (client.contact_email) attendeeEmails.push(client.contact_email);
  if (parsed.data.additionalAttendeeEmails) {
    attendeeEmails.push(...parsed.data.additionalAttendeeEmails);
  }

  try {
    const { eventId, htmlLink, newAccessToken } = await createCalendarEvent(
      token.google_refresh_token,
      {
        title: parsed.data.title,
        start: parsed.data.start,
        end: parsed.data.end,
        description: parsed.data.description,
        location: parsed.data.location,
        attendeeEmails,
        sendNotifications: true, // sends email invite to client
      }
    );

    if (newAccessToken && newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    return NextResponse.json({
      eventId,
      htmlLink,
      clientEmail: client.contact_email,
      inviteSent: !!client.contact_email,
    });
  } catch (err) {
    console.error('Schedule meeting error:', err);
    return NextResponse.json({ error: 'Failed to create meeting' }, { status: 500 });
  }
}
