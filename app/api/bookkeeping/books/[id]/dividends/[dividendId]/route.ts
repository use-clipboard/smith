import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// DELETE → remove a declared dividend (and its recipients, via cascade).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; dividendId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('bookkeeping_dividends')
    .delete()
    .eq('id', params.dividendId)
    .eq('book_id', params.id)
    .eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
