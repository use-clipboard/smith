import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeVatThresholdStatus } from '@/lib/bookkeeping/vatThresholds';

// ── /api/bookkeeping/books/[id]/vat-thresholds ───────────────────────────────
// Trailing-12-month turnover vs the VAT registration / FRS-exit thresholds.
// Drives the warning banners on the book view.

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const status = await computeVatThresholdStatus(supabase, params.id, today);
  return NextResponse.json(status);
}
