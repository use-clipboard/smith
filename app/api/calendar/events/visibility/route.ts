import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Schema = z.object({
  eventId: z.string().min(1),
  hidden: z.boolean(),
});

/** POST /api/calendar/events/visibility
 *  Admin-only: mark a specific event as hidden from (or visible to) all other team members.
 *  The event still appears for the owner, tagged isHidden: true.
 */
export async function POST(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can hide individual events' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { eventId, hidden } = parsed.data;
  const supabase = createClient();

  if (hidden) {
    const { error } = await supabase
      .from('calendar_hidden_events')
      .upsert(
        { user_id: ctx.userId, firm_id: ctx.firmId, google_event_id: eventId },
        { onConflict: 'user_id,google_event_id' }
      );
    if (error) {
      console.error('calendar_hidden_events upsert failed:', error);
      return NextResponse.json({ error: 'Failed to hide event — has the migration been run?' }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from('calendar_hidden_events')
      .delete()
      .eq('user_id', ctx.userId)
      .eq('google_event_id', eventId);
    if (error) {
      console.error('calendar_hidden_events delete failed:', error);
      return NextResponse.json({ error: 'Failed to unhide event' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
