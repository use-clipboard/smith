import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { calcTotalDays } from '@/lib/hrHolidays';
import { addCalendarEventForUser } from '@/lib/hrCalendarPush';

const HalfMarker = z.enum(['full', 'morning', 'afternoon']);
const Category = z.enum([
  'sickness', 'unpaid_leave', 'compassionate', 'jury_duty', 'medical_appointment', 'other',
]);

const CreateSchema = z.object({
  user_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_half: HalfMarker.default('full'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_half: HalfMarker.default('full'),
  category: Category,
  reason: z.string().nullable().optional(),
  evidence_url: z.string().url().nullable().optional(),
  push_to_calendar: z.boolean().optional().default(false),
});

// GET /api/hr/absence?scope=mine|team|all&category=...
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const scope = (url.searchParams.get('scope') ?? 'mine') as 'mine' | 'team' | 'all';
  const category = url.searchParams.get('category');

  const supabase = createClient();
  let query = supabase
    .from('hr_absence_records')
    .select(`
      id, firm_id, user_id, manager_id, recorded_by, start_date, start_half,
      end_date, end_half, total_days, category, reason, evidence_url,
      return_to_work_done, return_to_work_notes,
      pushed_to_calendar, google_calendar_event_id, created_at,
      user:users!user_id ( id, full_name, email ),
      manager:users!manager_id ( id, full_name, email ),
      recorder:users!recorded_by ( id, full_name, email )
    `)
    .eq('firm_id', ctx.firmId);

  if (scope === 'mine') query = query.eq('user_id', ctx.userId);
  else if (scope === 'team') query = query.eq('manager_id', ctx.userId);
  else if (scope === 'all') {
    if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  if (category) query = query.eq('category', category);

  query = query.order('start_date', { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error('[GET /api/hr/absence]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  return NextResponse.json({ records: data ?? [] });
}

// POST /api/hr/absence — manager/admin records a new absence (no approval flow)
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateSchema>;
  try { body = CreateSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (body.end_date < body.start_date) {
    return NextResponse.json({ error: 'End date cannot be before start date.' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id, manager_id, full_name, email')
    .eq('id', body.user_id)
    .maybeSingle();
  if (!target || target.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'User not found in your firm' }, { status: 404 });
  }

  const isManager = target.manager_id === ctx.userId;
  const isAdmin = ctx.userRole === 'admin';
  if (!isManager && !isAdmin) {
    return NextResponse.json({ error: 'Only the team member\'s manager or an admin can record an absence.' }, { status: 403 });
  }

  const total = calcTotalDays(body.start_date, body.start_half, body.end_date, body.end_half);

  // Optional calendar push
  let calendarEventId: string | null = null;
  let pushed = false;
  if (body.push_to_calendar) {
    try {
      const summary = body.category === 'sickness' ? 'Sickness'
        : body.category === 'unpaid_leave' ? 'Unpaid leave'
        : body.category === 'compassionate' ? 'Compassionate leave'
        : body.category === 'jury_duty' ? 'Jury duty'
        : body.category === 'medical_appointment' ? 'Medical appointment'
        : 'Absence';
      calendarEventId = await addCalendarEventForUser({
        userId: body.user_id, firmId: ctx.firmId,
        startDate: body.start_date, startHalf: body.start_half,
        endDate: body.end_date, endHalf: body.end_half,
        summary,
      });
      pushed = !!calendarEventId;
    } catch (e) {
      console.error('[hr/absence] calendar push failed:', e);
    }
  }

  const { data, error } = await supabase
    .from('hr_absence_records')
    .insert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      manager_id: target.manager_id,
      recorded_by: ctx.userId,
      start_date: body.start_date,
      start_half: body.start_half,
      end_date: body.end_date,
      end_half: body.end_half,
      total_days: total,
      category: body.category,
      reason: body.reason ?? null,
      evidence_url: body.evidence_url ?? null,
      pushed_to_calendar: pushed,
      google_calendar_event_id: calendarEventId,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/hr/absence]', error);
    return NextResponse.json({ error: 'Failed to record absence' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
