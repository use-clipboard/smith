import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';
import { calcTotalDays } from '@/lib/hrHolidays';

const HalfMarker = z.enum(['full', 'morning', 'afternoon']);

const CreateSchema = z.object({
  // For staff requesting their own holiday: omit user_id (defaults to self).
  // For manager/admin direct entry: pass the team-member's user_id.
  user_id: z.string().uuid().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_half: HalfMarker.default('full'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_half: HalfMarker.default('full'),
  reason: z.string().optional().nullable(),
  // 'request' = staff-raised, defaults to pending. 'direct' = manager/admin
  // recording on behalf of a team member, defaults to approved.
  source: z.enum(['request', 'direct']).default('request'),
});

// GET /api/hr/holidays?scope=mine|team|all
//   mine = the requester's own
//   team = those where the caller is the manager
//   firm = firm-wide approved holidays (everyone can see — for the shared calendar)
//   all  = admin-only — entire firm regardless of status
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const scope = (url.searchParams.get('scope') ?? 'mine') as 'mine' | 'team' | 'firm' | 'all';
  const status = url.searchParams.get('status'); // optional filter

  const supabase = createClient();
  let query = supabase
    .from('hr_holiday_requests')
    .select(`
      id, firm_id, user_id, manager_id, start_date, start_half, end_date, end_half,
      total_days, reason, status, source, decided_by, decided_at, rejection_reason,
      pushed_to_calendar, google_calendar_event_id, is_bank_holiday, bank_holiday_title, created_at,
      requester:users!user_id ( id, full_name, email ),
      manager:users!manager_id ( id, full_name, email )
    `)
    .eq('firm_id', ctx.firmId);

  if (scope === 'mine') {
    query = query.eq('user_id', ctx.userId);
  } else if (scope === 'team') {
    query = query.eq('manager_id', ctx.userId);
  } else if (scope === 'firm') {
    // Shared calendar view: every firm user can see approved entries (incl. bank
    // holidays, which have no manager). RLS already restricts to status=approved
    // for non-managers/admins, but we also enforce it here for clarity.
    query = query.eq('status', 'approved');
  } else if (scope === 'all') {
    if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  if (status && scope !== 'firm') query = query.eq('status', status);

  query = query.order('start_date', { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error('[GET /api/hr/holidays]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  return NextResponse.json({ holidays: data ?? [] });
}

// POST /api/hr/holidays — create a request (staff for self) or a direct entry (manager/admin)
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
  const targetUserId = body.user_id ?? ctx.userId;

  // Verify the target user is in the same firm + grab their manager_id snapshot.
  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id, manager_id, full_name, email')
    .eq('id', targetUserId)
    .maybeSingle();
  if (!target || target.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'User not found in your firm' }, { status: 404 });
  }

  // Authorisation: only the user themselves OR their manager OR an admin can create
  // on behalf of someone. RLS also enforces this — checking here gives clearer errors.
  const isSelf = targetUserId === ctx.userId;
  const isManager = target.manager_id === ctx.userId;
  const isAdmin = ctx.userRole === 'admin';
  if (!isSelf && !isManager && !isAdmin) {
    return NextResponse.json({ error: 'You can only book holiday for yourself or your direct reports.' }, { status: 403 });
  }

  // Direct entries can only be made by manager or admin (not by staff for themselves)
  const source = body.source;
  if (source === 'direct' && !isManager && !isAdmin) {
    return NextResponse.json({ error: 'Only managers and admins can record holidays directly.' }, { status: 403 });
  }

  const total = calcTotalDays(body.start_date, body.start_half, body.end_date, body.end_half);
  const initialStatus = source === 'direct' ? 'approved' : 'pending';

  const { data: created, error } = await supabase
    .from('hr_holiday_requests')
    .insert({
      firm_id: ctx.firmId,
      user_id: targetUserId,
      manager_id: target.manager_id,
      start_date: body.start_date,
      start_half: body.start_half,
      end_date: body.end_date,
      end_half: body.end_half,
      total_days: total,
      reason: body.reason ?? null,
      status: initialStatus,
      source,
      decided_by: source === 'direct' ? ctx.userId : null,
      decided_at: source === 'direct' ? new Date().toISOString() : null,
    })
    .select(`
      id, user_id, manager_id, start_date, end_date, status, total_days,
      requester:users!user_id ( full_name, email )
    `)
    .single();

  if (error) {
    console.error('[POST /api/hr/holidays]', error);
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });
  }

  // Notify the manager when a staff member raises a request.
  if (source === 'request' && target.manager_id && target.manager_id !== ctx.userId) {
    const requesterName = target.full_name || target.email || 'A team member';
    void createNotification({
      userId: target.manager_id,
      firmId: ctx.firmId,
      type: 'hr_holiday_request',
      title: `Holiday request: ${requesterName}`,
      body: `${body.start_date}${body.start_date === body.end_date ? '' : ` → ${body.end_date}`} (${total} day${total === 1 ? '' : 's'}).`,
      data: { holiday_id: created.id, link: '/hr?tab=approvals' },
    });
  }

  return NextResponse.json({ holiday: created });
}
