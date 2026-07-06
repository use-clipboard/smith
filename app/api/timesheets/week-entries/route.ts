import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';
import { mapRow } from '@/lib/timesheets/entryMap';

// GET /api/timesheets/week-entries?userId=<uuid>&weekStart=YYYY-MM-DD
//
// Returns a submitter's time entries for a single week so an approver can see
// the hours behind a submitted week. RLS on time_entries scopes the normal
// entries feed to the current user, so this uses the service client guarded by
// an explicit approver permission check (admin, or the manager the week was
// routed to). Mirrors the review permission logic in /api/timesheets/weeks.

const QuerySchema = z.object({
  userId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// weekStart + 6 days (inclusive week end), staying in ISO date form.
function weekEnd(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 6));
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    userId: url.searchParams.get('userId'),
    weekStart: url.searchParams.get('weekStart'),
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { userId: targetUser, weekStart } = parsed.data;

  const service = createServiceClient();

  // Permission: admins may view any week; a non-admin may only view weeks routed
  // to them (the snapshot manager on the week row, falling back to the user's
  // current manager). Viewing your own week is always fine.
  if (targetUser !== ctx.userId && ctx.userRole !== 'admin') {
    let rowManager: string | null = null;
    try {
      const { data: existing } = await service
        .from('timesheet_week_status').select('manager_id')
        .eq('user_id', targetUser).eq('week_start', weekStart).maybeSingle();
      rowManager = (existing?.manager_id as string | null) ?? null;
      if (!rowManager) {
        const { data: u } = await service.from('users').select('manager_id').eq('id', targetUser).single();
        rowManager = (u?.manager_id as string | null) ?? null;
      }
    } catch { /* treated as no manager → forbidden below */ }
    if (rowManager !== ctx.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await service
    .from('time_entries')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', targetUser)
    .gte('entry_date', weekStart)
    .lte('entry_date', weekEnd(weekStart))
    .order('entry_date', { ascending: true });

  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205' || /time_entries/.test(error.message ?? '');
    if (missing) return NextResponse.json({ available: false, entries: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ available: true, entries: (data ?? []).map(mapRow) });
}
