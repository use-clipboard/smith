import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { holidayYearWindow, toIsoDate } from '@/lib/hrHolidays';

// GET /api/hr/holidays/balance?userId=...
// Returns the holiday-year balance for one user (defaults to caller).
// Includes: entitlement, used (approved), pending, remaining, year window.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? ctx.userId;

  const supabase = createClient();
  // Visibility: caller can fetch own; manager of target; admin of firm.
  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id, manager_id, holiday_entitlement_days_override')
    .eq('id', userId)
    .maybeSingle();
  if (!target || target.firm_id !== ctx.firmId) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const isSelf = userId === ctx.userId;
  const isManager = target.manager_id === ctx.userId;
  const isAdmin = ctx.userRole === 'admin';
  if (!isSelf && !isManager && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Firm holiday-year settings
  const { data: settings } = await supabase
    .from('firm_hr_settings')
    .select('holiday_reset_month, holiday_reset_day, default_annual_holiday_days')
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  const resetMonth = settings?.holiday_reset_month ?? 1;
  const resetDay = settings?.holiday_reset_day ?? 1;
  const defaultDays = Number(settings?.default_annual_holiday_days ?? 28);
  const entitlement = target.holiday_entitlement_days_override != null
    ? Number(target.holiday_entitlement_days_override)
    : defaultDays;

  const { start, end } = holidayYearWindow(resetMonth, resetDay, new Date());
  const startIso = toIsoDate(start);
  const endIsoExclusive = toIsoDate(end);

  // Approved holidays where ANY part falls within [start, end). We use a
  // loose overlap check on dates to keep the SQL simple.
  const { data: approved } = await supabase
    .from('hr_holiday_requests')
    .select('total_days, start_date, end_date, status')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .in('status', ['approved'])
    .lt('start_date', endIsoExclusive)
    .gte('end_date', startIso);

  const { data: pending } = await supabase
    .from('hr_holiday_requests')
    .select('total_days, start_date, end_date, status')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lt('start_date', endIsoExclusive)
    .gte('end_date', startIso);

  const sum = (rows: { total_days: number | null }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Number(r.total_days ?? 0), 0);

  const used = sum(approved);
  const pendingDays = sum(pending);

  return NextResponse.json({
    user_id: userId,
    year: { start: startIso, end: endIsoExclusive, reset_month: resetMonth, reset_day: resetDay },
    entitlement,
    used,
    pending: pendingDays,
    remaining: Math.max(0, entitlement - used - pendingDays),
  });
}
