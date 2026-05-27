import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/accounts/[accountId] ────────────────────────
// GET    → single account row (currently unused; round-trips after PATCH).
// PATCH  → rename / notes / inactive / move-to-ledger.
//          - rename + notes + inactive: any firm member (RLS)
//          - move-to-ledger: admin-only (changes the COA structure)
// DELETE → admin-only. Hard-blocks if any split references the account.

const SELECT_ACCOUNT = `
  id, book_id, name, ledger, account_type, sort_order, archived, inactive, notes
`;

async function loadAccount(supabase: ReturnType<typeof createClient>, bookId: string, accountId: string, firmId: string) {
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, admin_locked').eq('id', bookId).eq('firm_id', firmId).single();
  if (!book) return { book: null, account: null };
  const { data: account } = await supabase
    .from('bookkeeping_accounts').select(SELECT_ACCOUNT).eq('id', accountId).eq('book_id', bookId).single();
  return { book, account };
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string; accountId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { book, account } = await loadAccount(supabase, params.id, params.accountId, ctx.firmId);
  if (!book || !account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ account });
}

// ── PATCH ───────────────────────────────────────────────────────────────────
const PatchBody = z.object({
  name:     z.string().min(1).max(200).optional(),
  ledger:   z.string().min(1).max(100).optional(),
  notes:    z.string().max(2000).nullable().optional(),
  inactive: z.boolean().optional(),
}).refine(b => Object.keys(b).length > 0, { message: 'No fields to update' });

export async function PATCH(req: NextRequest, { params }: { params: { id: string; accountId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { book, account } = await loadAccount(supabase, params.id, params.accountId, ctx.firmId);
  if (!book || !account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // Moving an account between ledgers changes the COA structure — admin only,
  // mirroring VT's "Move (admin only)".
  const isMove = body.ledger !== undefined && body.ledger !== account.ledger;
  if (isMove && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can move accounts between ledgers' }, { status: 403 });
  }
  // Toggling inactive is also admin-only (per VT — see Properties dialog).
  const isInactiveChange = body.inactive !== undefined && body.inactive !== account.inactive;
  if (isInactiveChange && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can lock or unlock an account' }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name     !== undefined) patch.name = body.name.trim();
  if (body.ledger   !== undefined) patch.ledger = body.ledger;
  if (body.notes    !== undefined) patch.notes = body.notes;
  if (body.inactive !== undefined) patch.inactive = body.inactive;

  // When moving, push to the bottom of the destination ledger so it doesn't
  // collide with whatever sort_order it had in its old ledger.
  if (isMove) {
    const { data: maxRow } = await supabase
      .from('bookkeeping_accounts')
      .select('sort_order')
      .eq('book_id', params.id)
      .eq('ledger', body.ledger!)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    patch.sort_order = ((maxRow?.sort_order as number | null) ?? 0) + 1;
  }

  const { data: updated, error } = await supabase
    .from('bookkeeping_accounts')
    .update(patch)
    .eq('id', params.accountId)
    .select(SELECT_ACCOUNT)
    .single();

  if (error) {
    const conflict = /duplicate key|unique constraint/i.test(error.message);
    return NextResponse.json(
      { error: conflict ? `An account with that name already exists in the destination ledger.` : error.message },
      { status: conflict ? 409 : 500 },
    );
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'account',
    entity_id: params.accountId,
    action: 'update',
    diff: patch,
  });

  return NextResponse.json({ account: updated });
}

// ── DELETE ──────────────────────────────────────────────────────────────────
// Admin-only. Refuses if any split (in any period) references this account.
// We surface the split count so the UI can show a friendly "can't delete —
// X entries posted against it" explanation rather than a generic error.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; accountId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { book, account } = await loadAccount(supabase, params.id, params.accountId, ctx.firmId);
  if (!book || !account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can delete accounts' }, { status: 403 });
  }

  // Block delete if any split touches this account. Cheap exists-style check.
  const { count: splitCount, error: countErr } = await supabase
    .from('bookkeeping_transaction_splits')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', params.accountId);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((splitCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: 'has_entries',
        message: `Can’t delete — ${splitCount} entr${splitCount === 1 ? 'y has' : 'ies have'} been posted to this account. Mark the account inactive instead so no new entries can be added, or reverse the entries first.`,
        entry_count: splitCount,
      },
      { status: 409 },
    );
  }

  // Also block if this account is referenced as a book's retained earnings
  // target — that's a single-row FK with ON DELETE RESTRICT in the migration.
  const { count: reUseCount } = await supabase
    .from('bookkeeping_books')
    .select('id', { count: 'exact', head: true })
    .eq('retained_earnings_account_id', params.accountId);
  if ((reUseCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Can’t delete — this account is set as the Retained Earnings target for the book. Pick a different RE account in Book Settings first.' },
      { status: 409 },
    );
  }

  const { error: delErr } = await supabase
    .from('bookkeeping_accounts').delete().eq('id', params.accountId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'account',
    entity_id: params.accountId,
    action: 'delete',
    diff: { name: account.name, ledger: account.ledger },
  });

  return NextResponse.json({ ok: true });
}
