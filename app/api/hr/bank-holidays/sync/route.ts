import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { syncBankHolidaysForFirm } from '@/lib/hrBankHolidays';

// POST /api/hr/bank-holidays/sync — admin-only.
// Runs the bank-holiday sync for the firm. Idempotent.
export async function POST() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  try {
    const result = await syncBankHolidaysForFirm({ firmId: ctx.firmId, actorId: ctx.userId });
    return NextResponse.json(result);
  } catch (e) {
    console.error('[POST /api/hr/bank-holidays/sync]', e);
    return NextResponse.json({ error: 'Sync failed. Check server logs.' }, { status: 500 });
  }
}
