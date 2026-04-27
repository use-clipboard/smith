import { google } from 'googleapis';

export function getCalendarOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_SITE_URL}/auth/calendar/callback`
  );
}

export function getCalendarAuthUrl() {
  const client = getCalendarOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

export async function getCalendarClient(accessToken: string, refreshToken: string) {
  const client = getCalendarOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.calendar({ version: 'v3', auth: client });
}

export async function getRefreshedCalendarClient(refreshToken: string): Promise<{
  calendar: ReturnType<typeof google.calendar>;
  accessToken: string;
}> {
  const client = getCalendarOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error('Token refresh failed');
  return {
    calendar: google.calendar({ version: 'v3', auth: client }),
    accessToken: credentials.access_token,
  };
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: { email: string; name?: string; responseStatus?: string }[];
  htmlLink?: string;
  meetLink?: string;
  colorId?: string;
  ownerUserId?: string;
  ownerName?: string;
  ownerColor?: string;
  /** true when this event has been marked hidden by its owner (only returned to the owner themselves) */
  isHidden?: boolean;
}

/** Fetch events from a user's primary Google Calendar for a given time range.
 *  Throws on error — callers must catch and handle individually. */
export async function fetchUserEvents(
  accessToken: string,
  refreshToken: string,
  timeMin: string,
  timeMax: string
): Promise<{ events: CalendarEvent[]; newAccessToken?: string }> {
  const { calendar, accessToken: newToken } = await getRefreshedCalendarClient(refreshToken);
  void accessToken; // refreshed above

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 500,
  });

  const events: CalendarEvent[] = (res.data.items ?? [])
    .filter(e => e.status !== 'cancelled')
    .map(e => {
      const videoEntry = e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video');
      return {
        id: e.id ?? '',
        title: e.summary ?? '(No title)',
        start: e.start?.dateTime ?? e.start?.date ?? '',
        end: e.end?.dateTime ?? e.end?.date ?? '',
        description: e.description ?? undefined,
        location: e.location ?? undefined,
        attendees: (e.attendees ?? []).map(a => ({
          email: a.email ?? '',
          name: a.displayName ?? undefined,
          responseStatus: a.responseStatus ?? undefined,
        })),
        htmlLink: e.htmlLink ?? undefined,
        meetLink: videoEntry?.uri ?? undefined,
        colorId: e.colorId ?? undefined,
      };
    });

  return { events, newAccessToken: newToken };
}

/** Create an event in the user's primary Google Calendar */
export async function createCalendarEvent(
  refreshToken: string,
  event: {
    title: string;
    start: string;
    end: string;
    isAllDay?: boolean;
    timezone?: string;
    description?: string;
    location?: string;
    attendeeEmails?: string[];
    sendNotifications?: boolean;
    recurrence?: string[];
    addGoogleMeet?: boolean;
  }
): Promise<{ eventId: string; htmlLink: string; meetLink?: string; newAccessToken: string }> {
  const { calendar, accessToken } = await getRefreshedCalendarClient(refreshToken);
  const tz = event.timezone ?? 'Europe/London';

  const res = await calendar.events.insert({
    calendarId: 'primary',
    // conferenceDataVersion: 1 is required for Google to process Meet creation
    conferenceDataVersion: event.addGoogleMeet ? 1 : 0,
    sendUpdates: event.sendNotifications ? 'all' : 'none',
    requestBody: {
      summary: event.title,
      description: event.description,
      location: event.location,
      start: event.isAllDay ? { date: event.start } : { dateTime: event.start, timeZone: tz },
      end: event.isAllDay ? { date: event.end } : { dateTime: event.end, timeZone: tz },
      attendees: (event.attendeeEmails ?? []).map(email => ({ email })),
      recurrence: event.recurrence,
      ...(event.addGoogleMeet && {
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    },
  });

  const videoEntry = res.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video');

  return {
    eventId: res.data.id ?? '',
    htmlLink: res.data.htmlLink ?? '',
    meetLink: videoEntry?.uri ?? undefined,
    newAccessToken: accessToken,
  };
}

/** Update an existing event */
export async function updateCalendarEvent(
  refreshToken: string,
  eventId: string,
  patch: {
    title?: string;
    start?: string;
    end?: string;
    isAllDay?: boolean;
    timezone?: string;
    description?: string;
    location?: string;
    recurrence?: string[];
    addGoogleMeet?: boolean;
  }
): Promise<{ newAccessToken: string; meetLink?: string }> {
  const { calendar, accessToken } = await getRefreshedCalendarClient(refreshToken);
  const tz = patch.timezone ?? 'Europe/London';

  const requestBody: Record<string, unknown> = {};
  if (patch.title) requestBody.summary = patch.title;
  if (patch.description !== undefined) requestBody.description = patch.description;
  if (patch.location !== undefined) requestBody.location = patch.location;
  if (patch.start) {
    requestBody.start = patch.isAllDay
      ? { date: patch.start }
      : { dateTime: patch.start, timeZone: tz };
  }
  if (patch.end) {
    requestBody.end = patch.isAllDay
      ? { date: patch.end }
      : { dateTime: patch.end, timeZone: tz };
  }
  if (patch.recurrence !== undefined) requestBody.recurrence = patch.recurrence;
  if (patch.addGoogleMeet) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const res = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    conferenceDataVersion: patch.addGoogleMeet ? 1 : 0,
    requestBody,
  });

  const videoEntry = res.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video');

  return { newAccessToken: accessToken, meetLink: videoEntry?.uri ?? undefined };
}

/** Delete an event */
export async function deleteCalendarEvent(
  refreshToken: string,
  eventId: string
): Promise<{ newAccessToken: string }> {
  const { calendar, accessToken } = await getRefreshedCalendarClient(refreshToken);
  await calendar.events.delete({ calendarId: 'primary', eventId });
  return { newAccessToken: accessToken };
}
