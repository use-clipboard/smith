import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/transactions/[txId]/audit ──────────────
// Returns the audit trail for a single transaction — every create / update /
// delete row, with user, timestamp, and the diff blob captured at the time.
// Used by the per-row "View audit history" action.

interface UserRef { id: string; full_name: string | null; email: string | null; }

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; txId: string } },
) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Verify book + firm
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_audit')
    .select(`
      id, action, diff, created_at,
      user:users(id, full_name, email)
    `)
    .eq('book_id', params.id)
    .eq('entity_type', 'transaction')
    .eq('entity_id', params.txId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Shape the user join consistently (PostgREST sometimes returns single
  // joined rows as a one-element array depending on FK direction).
  const shaped = (data ?? []).map(row => {
    const r = row as Record<string, unknown> & { user?: UserRef | UserRef[] | null };
    const u = Array.isArray(r.user) ? r.user[0] : r.user;
    const userName = u?.full_name ?? u?.email ?? null;
    const { user, ...rest } = r;
    void user;
    return { ...rest, user_name: userName };
  });

  return NextResponse.json({ audit: shaped });
}
