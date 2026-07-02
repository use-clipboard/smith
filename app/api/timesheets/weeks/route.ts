import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { canAccessTimesheets } from '@/lib/timesheets/access';
import { createServiceClient } from '@/lib/supabase-server';

export interface WeekStatusRow {
  userId: string;
  weekStart: string;
  status: 'submitted' | 'approved' | 'rejected';
  note: string | null;
  reviewedBy: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapRow = (r: any): WeekStatusRow => ({
  userId: r.user_id, weekStart: r.week_start, status: r.status, note: r.note ?? null, reviewedBy: r.reviewed_by ?? null,
});

// GET /api/timesheets/weeks → { available, weeks: WeekStatusRow[] }
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');
  if (!canAccessTimesheets(ctx.email)) return moduleNotActive('timesheets');

  const service = createServiceClient();
  const { data, error } = await service
    .from('timesheet_week_status')
    .select('user_id, week_start, status, note, reviewed_by')
    .eq('firm_id', ctx.firmId)
    .order('week_start', { ascending: false });

  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205' || /timesheet_week_status/.test(error.message ?? '');
    if (missing) return NextResponse.json({ available: false, weeks: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ available: true, weeks: (data ?? []).map(mapRow) });
}

const PostSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(['submit', 'withdraw', 'approve', 'reject']),
  userId: z.string().uuid().optional(),   // target user (admin review); defaults to self
  note: z.string().max(500).optional(),
});

// POST /api/timesheets/weeks  { weekStart, action, userId?, note? }
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');
  if (!canAccessTimesheets(ctx.email)) return moduleNotActive('timesheets');

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { weekStart, action, note } = parsed.data;
  const targetUser = parsed.data.userId ?? ctx.userId;
  const service = createServiceClient();

  // Permission: self may submit/withdraw own weeks; admin may review anyone.
  const isReview = action === 'approve' || action === 'reject';
  if (isReview) {
    if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (targetUser !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (action === 'withdraw') {
    // Back to draft — remove the row (only if not already approved).
    const { error } = await service
      .from('timesheet_week_status')
      .delete()
      .eq('user_id', targetUser)
      .eq('week_start', weekStart)
      .neq('status', 'approved');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: 'draft' });
  }

  if (action === 'submit') {
    const { error } = await service
      .from('timesheet_week_status')
      .upsert({
        firm_id: ctx.firmId, user_id: targetUser, week_start: weekStart,
        status: 'submitted', note: null, submitted_at: new Date().toISOString(),
        reviewed_by: null, reviewed_at: null,
      }, { onConflict: 'user_id,week_start' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: 'submitted' });
  }

  // approve / reject
  const status = action === 'approve' ? 'approved' : 'rejected';
  const { error } = await service
    .from('timesheet_week_status')
    .upsert({
      firm_id: ctx.firmId, user_id: targetUser, week_start: weekStart,
      status, note: note ?? null, reviewed_by: ctx.userId, reviewed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,week_start' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
