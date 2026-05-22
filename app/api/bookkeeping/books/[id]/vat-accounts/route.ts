import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/vat-accounts ─────────────────────────────
// Look up the canonical VAT routing accounts for this book — the ones we
// debit (Input) or credit (Output) when posting a transaction with VAT.
//
// Both come from the Creditors ledger, named "VAT - Input" and "VAT - Output"
// per the Ltd COA seed. If the book isn't VAT-registered or those accounts
// don't exist (e.g. older book pre-Phase-2A), returns nulls and the input
// sheet falls back to lumping VAT into the analysis account.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, vat_registered')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!book.vat_registered) {
    return NextResponse.json({ input_account_id: null, output_account_id: null });
  }

  const { data, error } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name')
    .eq('book_id', params.id)
    .eq('ledger', 'Creditors')
    .in('name', ['VAT - Input', 'VAT - Output']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const input  = (data ?? []).find(a => a.name === 'VAT - Input')?.id  ?? null;
  const output = (data ?? []).find(a => a.name === 'VAT - Output')?.id ?? null;

  return NextResponse.json({ input_account_id: input, output_account_id: output });
}
