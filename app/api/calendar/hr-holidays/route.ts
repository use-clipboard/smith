import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/calendar/hr-holidays?start=ISO&end=ISO
//
// APPROVED holidays that were ticked "add to calendar", for the SMITH Calendar
// overlay — for the current user AND the teammates whose calendars they can see
// (same visibility rules as /api/calendar/events).
//
// Approval already pushes the holiday to the person's Google Calendar, but only
// if they've connected Google (then google_calendar_event_id is set and it shows
// via the Google feed). We overlay only the ones NOT on Google so an approved
// holiday shows even without a Google connection, with no duplicate for those who
// have one. Bank holidays have their own overlay, so they're excluded here.
export async function GET(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ holidays: [] });

  const { searchParams } = new URL(request.url);
  const startDate = (searchParams.get('start') ?? '1900-01-01').slice(0, 10);
  const endDate = (searchParams.get('end') ?? '2999-12-31').slice(0, 10);

  const supabase = createClient();
  const service = createServiceClient();

  // Team members + which calendars the viewer may see — mirrors the events route:
  // self and all staff are visible; admins follow their calendar_visibility flag.
  const { data: teamMembers } = await supabase
    .from('users').select('id, full_name, email, role').eq('firm_id', ctx.firmId);
  if (!teamMembers?.length) return NextResponse.json({ holidays: [] });

  const { data: vis } = await supabase
    .from('calendar_visibility').select('user_id, visible_to_team').eq('firm_id', ctx.firmId);
  const visMap = new Map((vis ?? []).map(v => [v.user_id, v.visible_to_team as boolean]));

  const visibleIds = teamMembers
    .filter(m => {
      if (m.id === ctx.userId) return true;
      if (m.role === 'staff') return true;
      return visMap.get(m.id) ?? true; // admins: default visible
    })
    .map(m => m.id);
  const nameById = new Map(teamMembers.map(m => [m.id, m.full_name ?? m.email ?? 'Team member']));

  try {
    const { data } = await service
      .from('hr_holiday_requests')
      .select('id, user_id, start_date, end_date, start_half, end_half, is_bank_holiday')
      .eq('firm_id', ctx.firmId)
      .in('user_id', visibleIds)
      .eq('status', 'approved')
      .eq('pushed_to_calendar', true)
      .is('google_calendar_event_id', null)
      .lte('start_date', endDate)
      .gte('end_date', startDate);

    const holidays = (data ?? [])
      .filter(r => !r.is_bank_holiday)
      .map(r => ({
        id: r.id as string,
        userId: r.user_id as string,
        ownerName: nameById.get(r.user_id as string) ?? 'Team member',
        start_date: r.start_date as string,
        end_date: r.end_date as string,
        start_half: r.start_half as 'full' | 'morning' | 'afternoon',
        end_half: r.end_half as 'full' | 'morning' | 'afternoon',
      }));
    return NextResponse.json({ holidays });
  } catch {
    return NextResponse.json({ holidays: [] });
  }
}
