import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar';

// POST /api/organise-plan/calendar
// Idempotently syncs an "Organise my day" plan onto the user's own Google Calendar.
// Each plan block becomes a timed event; re-running UPDATES existing events (by the
// eventId map the client keeps) and DELETES events for blocks that are gone — so
// pressing "Update calendar" after editing never duplicates. Calendar MEETINGS are
// never sent here (they aren't plan blocks), so they can't be double-booked.
//
// Visibility: 'private' → Google visibility 'private' (colleagues see "Busy" via the
// team calendar mask); 'shared' → 'default' (colleagues see the block). All plan
// events are marked busy (opaque) and given a distinct colour so they're easy to spot.

const PLAN_COLOR_ID = '9';          // Blueberry — marks SMITH plan blocks
const PLAN_DESCRIPTION = 'Added by SMITH · Organise my day';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  visibility: z.enum(['private', 'shared']),
  blocks: z.array(z.object({
    key: z.string().min(1),
    summary: z.string().min(1),
    startISO: z.string().min(1),
    endISO: z.string().min(1),
  })),
  existing: z.record(z.string(), z.string()).default({}),
});

export async function POST(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { visibility, blocks, existing } = parsed;

  const service = createServiceClient();
  const { data: token } = await service
    .from('calendar_tokens')
    .select('google_access_token, google_refresh_token')
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (!token?.google_refresh_token) {
    return NextResponse.json({ error: 'calendar-not-connected' }, { status: 400 });
  }
  const refreshToken = token.google_refresh_token as string;
  const googleVis = visibility === 'shared' ? 'default' : 'private';

  const eventIds: Record<string, string> = {};
  const currentKeys = new Set(blocks.map(b => b.key));

  // Create / update a Google event for every current block (in parallel — keeps a
  // large plan comfortably inside the request timeout).
  await Promise.all(blocks.map(async b => {
    const fields = {
      title: b.summary,
      start: b.startISO,
      end: b.endISO,
      description: PLAN_DESCRIPTION,
      visibility: googleVis as 'private' | 'default',
      transparency: 'opaque' as const,
      colorId: PLAN_COLOR_ID,
    };
    const existingId = existing[b.key];
    if (existingId) {
      try {
        await updateCalendarEvent(refreshToken, existingId, fields);
        eventIds[b.key] = existingId;
        return;
      } catch {
        // Event was deleted in Google (or otherwise gone) — fall through to recreate.
      }
    }
    try {
      const { eventId } = await createCalendarEvent(refreshToken, fields);
      if (eventId) eventIds[b.key] = eventId;
    } catch (err) {
      console.error('organise-plan calendar create failed', err);
    }
  }));

  // Delete events whose block no longer exists in the plan.
  await Promise.all(Object.entries(existing).map(async ([key, id]) => {
    if (currentKeys.has(key)) return;
    try {
      await deleteCalendarEvent(refreshToken, id);
    } catch {
      // Already gone — ignore.
    }
  }));

  return NextResponse.json({ eventIds, syncedAt: new Date().toISOString() });
}
