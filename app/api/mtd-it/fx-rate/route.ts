import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { lookupHmrcRate } from '@/lib/mtdIt/hmrcFxRates';

// GET /api/mtd-it/fx-rate?currency=EUR&date=2026-01-15
//   The HMRC monthly rate for a currency in the given date's month, converted
//   to our "1 unit → GBP" convention (see lib/mtdIt/hmrcFxRates for the
//   inversion). The editor calls this to auto-fill a foreign entry's fx_rate.
//
//   200 { rate, unitsPerGbp, period, startDate, endDate } when found;
//   200 { rate: null, reason } when GBP / bad input / HMRC hasn't published it —
//   the caller just leaves the field blank, this is never an error state.

export async function GET(req: NextRequest) {
  // Auth only — the data is public, but gating keeps it off the open internet
  // and consistent with every other mtd-it route.
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const currency = url.searchParams.get('currency') ?? '';
  const date = url.searchParams.get('date') ?? '';

  try {
    const found = await lookupHmrcRate(currency, date);
    if (!found) {
      return NextResponse.json({ rate: null, reason: 'No published HMRC rate for that currency and month.' });
    }
    return NextResponse.json(found);
  } catch (e) {
    console.error('GET /api/mtd-it/fx-rate', e);
    // Soft-fail: the editor treats a null rate as "leave it to the user".
    return NextResponse.json({ rate: null, reason: 'Could not reach the HMRC rate service.' });
  }
}
