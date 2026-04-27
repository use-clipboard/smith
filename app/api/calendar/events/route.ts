import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import {
  fetchUserEvents, createCalendarEvent, updateCalendarEvent,
  deleteCalendarEvent, type CalendarEvent,
} from '@/lib/googleCalendar';
import { notifyCalendarAttendees } from '@/lib/notifications';

// Colour palette for distinguishing team members' events
const MEMBER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

/** GET /api/calendar/events?start=ISO&end=ISO — fetch team events */
export async function GET(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start') ?? new Date(Date.now() - 7 * 86400000).toISOString();
  const end = searchParams.get('end') ?? new Date(Date.now() + 60 * 86400000).toISOString();

  // Use session client for firm/visibility queries (RLS-scoped to firm)
  const supabase = createClient();
  // Use service client for token queries — RLS only lets users see their own row,
  // but we need all team members' tokens to build the team calendar view.
  const service = createServiceClient();

  // Get all team members (include role for visibility rules)
  const { data: teamMembers } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('firm_id', ctx.firmId);

  if (!teamMembers?.length) return NextResponse.json({ events: [], members: [] });

  // Get visibility settings
  const { data: visibilitySettings } = await supabase
    .from('calendar_visibility')
    .select('user_id, visible_to_team')
    .eq('firm_id', ctx.firmId);

  // Get calendar tokens for ALL team members via service client (bypasses RLS)
  const memberIds = teamMembers.map(m => m.id);
  const { data: tokens } = await service
    .from('calendar_tokens')
    .select('user_id, google_access_token, google_refresh_token')
    .in('user_id', memberIds);

  const tokenMap = new Map((tokens ?? []).map(t => [t.user_id, t]));
  const visMap = new Map((visibilitySettings ?? []).map(v => [v.user_id, v]));

  // Determine which calendars the current user can see.
  // Staff members are always visible. Admins use their visibility setting (default: visible).
  const visibleMemberIds = teamMembers
    .filter(m => {
      if (m.id === ctx.userId) return true; // always see own calendar
      if (m.role === 'staff') return true;  // staff always visible to team
      const vis = visMap.get(m.id);
      return vis ? vis.visible_to_team : true; // admins: default visible
    })
    .map(m => m.id);

  // Fetch per-event hidden flags for all admin members via service client.
  // Admin users can mark individual events as hidden — those events are excluded
  // from other viewers' feeds but still shown (tagged isHidden) to the owner.
  const adminMemberIds = teamMembers.filter(m => m.role === 'admin').map(m => m.id);
  const hiddenEventMap = new Map<string, Set<string>>(); // userId → Set<googleEventId>
  if (adminMemberIds.length > 0) {
    const { data: hiddenRows } = await service
      .from('calendar_hidden_events')
      .select('user_id, google_event_id')
      .in('user_id', adminMemberIds);
    (hiddenRows ?? []).forEach(r => {
      if (!hiddenEventMap.has(r.user_id)) hiddenEventMap.set(r.user_id, new Set());
      hiddenEventMap.get(r.user_id)!.add(r.google_event_id);
    });
  }

  // Fetch events from each visible connected calendar in parallel
  const allEvents: CalendarEvent[] = [];
  const membersInfo: { id: string; name: string; email: string; connected: boolean; color: string }[] = [];
  const fetchErrors: { memberId: string; error: string }[] = [];

  await Promise.all(
    teamMembers.map(async (member, i) => {
      const color = MEMBER_COLORS[i % MEMBER_COLORS.length];
      const token = tokenMap.get(member.id);
      const isConnected = !!token?.google_refresh_token;

      membersInfo.push({
        id: member.id,
        name: member.full_name ?? member.email ?? 'Unknown',
        email: member.email ?? '',
        connected: isConnected,
        color,
      });

      if (!isConnected || !visibleMemberIds.includes(member.id)) return;

      try {
        const { events, newAccessToken } = await fetchUserEvents(
          token.google_access_token ?? '',
          token.google_refresh_token,
          start,
          end
        );

        // Persist refreshed access token via service client so it can update any member's row
        if (newAccessToken && newAccessToken !== token.google_access_token) {
          await service
            .from('calendar_tokens')
            .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
            .eq('user_id', member.id);
        }

        const memberHiddenIds = hiddenEventMap.get(member.id);

        events.forEach(e => {
          const isHidden = memberHiddenIds?.has(e.id) ?? false;
          // For other viewers: show hidden events as a masked "Busy" block (strip sensitive data)
          if (isHidden && member.id !== ctx.userId) {
            allEvents.push({
              id: e.id,
              title: 'Hidden',
              start: e.start,
              end: e.end,
              ownerUserId: member.id,
              ownerName: member.full_name ?? member.email ?? 'Unknown',
              ownerColor: color,
              isHidden: true,
            });
            return;
          }
          allEvents.push({
            ...e,
            ownerUserId: member.id,
            ownerName: member.full_name ?? member.email ?? 'Unknown',
            ownerColor: color,
            // Tag the event for the owner so they can see/toggle it
            isHidden: member.id === ctx.userId ? isHidden : undefined,
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to fetch calendar for user ${member.id}:`, err);
        fetchErrors.push({ memberId: member.id, error: msg });
      }
    })
  );

  // Sort by start time
  allEvents.sort((a, b) => a.start.localeCompare(b.start));

  return NextResponse.json({
    events: allEvents,
    members: membersInfo,
    ...(fetchErrors.length > 0 ? { errors: fetchErrors } : {}),
  });
}

/** DELETE /api/calendar/events?id=<googleEventId>&notifyEmails=a,b&eventTitle=... */
export async function DELETE(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('id');
  if (!eventId) return NextResponse.json({ error: 'Missing event id' }, { status: 400 });

  const supabase = createClient();
  const { data: token } = await supabase
    .from('calendar_tokens')
    .select('google_refresh_token, google_access_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!token?.google_refresh_token) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  try {
    const { newAccessToken } = await deleteCalendarEvent(token.google_refresh_token, eventId);
    if (newAccessToken && newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    // Notify any SMITH team members who were attendees
    const notifyEmailsStr = searchParams.get('notifyEmails');
    const notifyEmails = notifyEmailsStr ? notifyEmailsStr.split(',').filter(Boolean) : [];
    if (notifyEmails.length > 0) {
      const { data: actor } = await supabase
        .from('users').select('full_name, email').eq('id', ctx.userId).single();
      const actorName = actor?.full_name ?? actor?.email ?? 'A team member';
      const eventTitle = searchParams.get('eventTitle') ?? 'a meeting';

      await notifyCalendarAttendees({
        actorUserId: ctx.userId,
        firmId: ctx.firmId,
        attendeeEmails: notifyEmails,
        type: 'calendar_deleted',
        title: `${actorName} cancelled a meeting`,
        body: `"${eventTitle}" has been removed from your calendar`,
        data: {},
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Delete calendar event error:', err);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}

const CreateEventSchema = z.object({
  title: z.string().min(1),
  start: z.string(),
  end: z.string(),
  isAllDay: z.boolean().optional().default(false),
  timezone: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  attendeeEmails: z.array(z.string().email()).optional(),
  sendNotifications: z.boolean().optional().default(false),
  recurrence: z.array(z.string()).optional(),
  addGoogleMeet: z.boolean().optional().default(false),
});

/** POST /api/calendar/events — create event on current user's calendar */
export async function POST(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await request.json();
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { data: token } = await supabase
    .from('calendar_tokens')
    .select('google_refresh_token, google_access_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!token?.google_refresh_token) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  try {
    const { eventId, htmlLink, meetLink, newAccessToken } = await createCalendarEvent(
      token.google_refresh_token,
      {
        title:             parsed.data.title,
        start:             parsed.data.start,
        end:               parsed.data.end,
        isAllDay:          parsed.data.isAllDay,
        timezone:          parsed.data.timezone,
        description:       parsed.data.description,
        location:          parsed.data.location,
        attendeeEmails:    parsed.data.attendeeEmails,
        sendNotifications: parsed.data.sendNotifications,
        recurrence:        parsed.data.recurrence,
        addGoogleMeet:     parsed.data.addGoogleMeet,
      }
    );

    if (newAccessToken && newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    // Notify SMITH team members who are in the attendees list
    const attendeeEmails = parsed.data.attendeeEmails ?? [];
    if (attendeeEmails.length > 0) {
      const { data: actor } = await supabase
        .from('users').select('full_name, email').eq('id', ctx.userId).single();
      const actorName = actor?.full_name ?? actor?.email ?? 'A team member';

      await notifyCalendarAttendees({
        actorUserId: ctx.userId,
        firmId: ctx.firmId,
        attendeeEmails,
        type: 'calendar_invite',
        title: `${actorName} added you to a meeting`,
        body: `"${parsed.data.title}"`,
        data: { eventId, htmlLink },
      });
    }

    return NextResponse.json({ eventId, htmlLink, meetLink: meetLink ?? null });
  } catch (err) {
    console.error('Create calendar event error:', err);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}

const PatchEventSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().min(1).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  isAllDay: z.boolean().optional(),
  timezone: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  addGoogleMeet: z.boolean().optional(),
  attendeeEmails: z.array(z.string().email()).optional(),
  originalTitle: z.string().optional(),
});

/** PATCH /api/calendar/events — update an event on current user's calendar */
export async function PATCH(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await request.json();
  const parsed = PatchEventSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { data: token } = await supabase
    .from('calendar_tokens')
    .select('google_refresh_token, google_access_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!token?.google_refresh_token) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  try {
    const { newAccessToken, meetLink } = await updateCalendarEvent(
      token.google_refresh_token,
      parsed.data.eventId,
      {
        title:         parsed.data.title,
        start:         parsed.data.start,
        end:           parsed.data.end,
        isAllDay:      parsed.data.isAllDay,
        timezone:      parsed.data.timezone,
        description:   parsed.data.description,
        location:      parsed.data.location,
        recurrence:    parsed.data.recurrence,
        addGoogleMeet: parsed.data.addGoogleMeet,
      }
    );

    if (newAccessToken && newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    // Notify attendees who are SMITH team members
    const attendeeEmails = parsed.data.attendeeEmails ?? [];
    if (attendeeEmails.length > 0) {
      const { data: actor } = await supabase
        .from('users').select('full_name, email').eq('id', ctx.userId).single();
      const actorName = actor?.full_name ?? actor?.email ?? 'A team member';
      const eventLabel = parsed.data.originalTitle ?? parsed.data.title ?? 'a meeting';

      await notifyCalendarAttendees({
        actorUserId: ctx.userId,
        firmId: ctx.firmId,
        attendeeEmails,
        type: 'calendar_updated',
        title: `${actorName} updated a meeting`,
        body: `"${eventLabel}" has been updated`,
        data: { eventId: parsed.data.eventId },
      });
    }

    return NextResponse.json({ success: true, meetLink: meetLink ?? null });
  } catch (err) {
    console.error('Update calendar event error:', err);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}
