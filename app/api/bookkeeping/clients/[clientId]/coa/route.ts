import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/clients/[clientId]/coa ──────────────────────────────
// Resolves a client's bookkeeping book and returns its income/expense chart of
// accounts as both a CSV (for the Capture AI's allocation context) and a list.
// Capture feeds this when the SMITH target software is chosen so allocations
// land on the book's REAL accounts. The same book becomes the send target.
//
// Returns { book: {id,name} | null, books: [...], multiple, accounts: [{name,code}], csv }.
// Gated by bookkeeping access — non-bookkeeping users get an empty payload and
// the auto-COA simply doesn't engage.
export async function GET(req: NextRequest, { params }: { params: { clientId: string } }) {
  const empty = { book: null, books: [], multiple: false, accounts: [], csv: '' };
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json(empty);

  const supabase = createClient();
  const { data: books } = await supabase
    .from('bookkeeping_books')
    .select('id, name, updated_at')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', params.clientId)
    .eq('archived', false)
    .order('updated_at', { ascending: false });

  if (!books || books.length === 0) return NextResponse.json(empty);

  // Default to the most recently touched book; honour an explicit ?book_id when
  // it belongs to this client (the book picker passes it so COA + send target
  // always match).
  const requested = new URL(req.url).searchParams.get('book_id');
  const primary = (requested && books.find(b => b.id === requested)) || books[0];

  const { data: accts } = await supabase
    .from('bookkeeping_accounts')
    .select('name, code, account_type')
    .eq('book_id', primary.id)
    .in('account_type', ['income', 'expense'])
    .eq('archived', false);

  const accounts = (accts ?? [])
    .filter(a => !!a.name)
    .map(a => ({ name: a.name as string, code: (a.code as string | null) ?? '' }));

  // CSV the Capture AI + local matcher understand (name,code).
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = ['name,code', ...accounts.map(a => `${esc(a.name)},${esc(a.code)}`)].join('\n');

  return NextResponse.json({
    book: { id: primary.id, name: primary.name },
    books: books.map(b => ({ id: b.id, name: b.name })),
    multiple: books.length > 1,
    accounts,
    csv,
  });
}
