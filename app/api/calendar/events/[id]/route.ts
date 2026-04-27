import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar';

const PatchSchema = z.object({
  title: z.string().min(1).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
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
    const { newAccessToken } = await updateCalendarEvent(
      token.google_refresh_token,
      params.id,
      parsed.data
    );

    if (newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Update calendar event error:', err);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

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
    const { newAccessToken } = await deleteCalendarEvent(token.google_refresh_token, params.id);

    if (newAccessToken !== token.google_access_token) {
      await supabase
        .from('calendar_tokens')
        .update({ google_access_token: newAccessToken, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Delete calendar event error:', err);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
