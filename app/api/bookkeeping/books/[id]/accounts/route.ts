import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { rangeBaseFor, nextCodeInRange, type CodeAccountType } from '@/lib/bookkeeping/accountCodes';

// ── GET /api/bookkeeping/books/[id]/accounts ─────────────────────────────────
// Returns the book's COA, optionally filtered. Used by the account picker.
//   ?ledger=Expenses    — accounts within a single ledger
//   ?search=accountancy — case-insensitive substring on the account name
//   ?include_archived=true — opt in to archived accounts (default off)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const ledger = url.searchParams.get('ledger');
  const search = url.searchParams.get('search')?.trim();
  const includeArchived = url.searchParams.get('include_archived') === 'true';
  // The account picker uses ?pickable_only=true to hide inactive accounts so
  // users can't post new entries to them. The ledger view doesn't pass it —
  // inactive accounts must still appear there so historic balances remain
  // discoverable.
  const pickableOnly = url.searchParams.get('pickable_only') === 'true';

  const supabase = createClient();
  // Confirm the book belongs to this firm before exposing its accounts.
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let q = supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, ledger_key, account_type, sort_order, archived, inactive, notes, code, system_role')
    .eq('book_id', params.id)
    .order('ledger', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (!includeArchived) q = q.eq('archived', false);
  if (pickableOnly) q = q.eq('inactive', false);
  if (pickableOnly) q = q.eq('system_managed', false); // hide Petty cash etc. from manual posting
  if (ledger) q = q.eq('ledger', ledger);
  if (search) q = q.ilike('name', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ accounts: data ?? [] });
}

// ── POST /api/bookkeeping/books/[id]/accounts ────────────────────────────────
// Inline-create an account. Used by the AccountPicker's "Set up a new account"
// affordance. Ledger + account_type are required so the new account can be
// posted to immediately.
const ACCOUNT_TYPES = ['asset','liability','equity','income','expense'] as const;

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  ledger: z.string().min(1).max(100),
  account_type: z.enum(ACCOUNT_TYPES),
  sort_order: z.number().int().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  // Confirm the book belongs to this firm + the book isn't admin-locked for non-admins.
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // Pick a sort_order that pushes the new account to the bottom of its ledger
  // unless the caller provided one. While we're here, grab the ledger_key from
  // an existing sibling account (ledger_key is a per-ledger constant) so the
  // new account joins the same ledger identity.
  let sortOrder = body.sort_order;
  let ledgerKey: string | null = null;
  {
    const { data: siblings } = await supabase
      .from('bookkeeping_accounts')
      .select('sort_order, ledger_key')
      .eq('book_id', params.id)
      .eq('ledger', body.ledger)
      .order('sort_order', { ascending: false });
    if (sortOrder === undefined) {
      sortOrder = ((siblings?.[0]?.sort_order as number | null) ?? 0) + 1;
    }
    ledgerKey = (siblings ?? []).map(s => s.ledger_key as string | null).find(Boolean) ?? null;
  }

  // Assign the next free code in this account type's band (1xxx asset … 6xxx
  // expense). Cosmetic only — never used for resolution.
  const { data: codeRows } = await supabase
    .from('bookkeeping_accounts')
    .select('code')
    .eq('book_id', params.id);
  const base = rangeBaseFor(body.account_type as CodeAccountType, ledgerKey, body.ledger);
  const code = nextCodeInRange((codeRows ?? []).map(r => r.code as string | null), base);

  const { data, error } = await supabase
    .from('bookkeeping_accounts')
    .insert({
      book_id: params.id,
      name: body.name.trim(),
      ledger: body.ledger,
      ledger_key: ledgerKey,
      account_type: body.account_type,
      sort_order: sortOrder,
      code,
    })
    .select('id, name, ledger, ledger_key, account_type, sort_order, archived, code')
    .single();

  if (error) {
    // Most likely cause: duplicate (book_id, ledger, name) uniqueness violation.
    const conflict = /duplicate key|unique constraint/i.test(error.message);
    return NextResponse.json(
      { error: conflict ? `"${body.name}" already exists in ${body.ledger}.` : error.message },
      { status: conflict ? 409 : 500 },
    );
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'account',
    entity_id: data.id,
    action: 'create',
    diff: { ledger: data.ledger, name: data.name, account_type: data.account_type },
  });

  return NextResponse.json({ account: data });
}
