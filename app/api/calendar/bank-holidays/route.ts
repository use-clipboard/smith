import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { fetchBankHolidays, type BankHolidayRegion } from '@/lib/hrBankHolidays';

// GET /api/calendar/bank-holidays?start=ISO&end=ISO
// Read-only UK bank holidays for the calendar overlay. Independent of the HR
// bank-holiday sync — this just displays them. Region follows the firm's HR
// setting when present, otherwise England & Wales.
export async function GET(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ holidays: [] });

  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  let region: BankHolidayRegion = 'england-and-wales';
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from('firm_hr_settings')
      .select('bank_holidays_region')
      .eq('firm_id', ctx.firmId)
      .maybeSingle();
    if (data?.bank_holidays_region) region = data.bank_holidays_region as BankHolidayRegion;
  } catch { /* HR settings absent → default region */ }

  try {
    const events = await fetchBankHolidays(region);
    const startMs = start ? Date.parse(start) : -Infinity;
    const endMs = end ? Date.parse(end) : Infinity;
    const holidays = events
      .filter(e => {
        const t = Date.parse(`${e.date}T00:00:00Z`);
        return t >= startMs && t <= endMs;
      })
      .map(e => ({ date: e.date, title: e.title }));
    return NextResponse.json({ holidays, region });
  } catch {
    // Feed unreachable — degrade to no overlay rather than erroring the calendar.
    return NextResponse.json({ holidays: [] });
  }
}
