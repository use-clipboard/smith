import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── GET /api/bookkeeping/books/[id]/payees ───────────────────────────────────
// Returns memorised payees for the autocomplete dropdown. Filtered by
// transaction type (memorisation is per-type — Tesco as a PAY is independent
// from Tesco as a PIN) and an optional substring query.
//
//   ?type=PAY      — required: one of PAY/CHQ/REC/TRF/SIN/SCR/PIN/PCR/JRN
//   ?q=tes         — optional case-insensitive substring on payee_display
//   ?limit=N       — default 8, max 25
//
// Joins the analysis account so the client can show "Suppliers: Tesco" in the
// dropdown without a second lookup.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '8', 10) || 8, 25);
  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 });

  const supabase = createClient();
  // Confirm the book belongs to this firm before exposing memorisation.
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let query = supabase
    .from('bookkeeping_payee_memory')
    .select('id, payee_display, payee_key, last_used_at, use_count, template')
    .eq('book_id', params.id)
    .eq('transaction_type', type)
    .order('last_used_at', { ascending: false })
    .limit(limit);

  if (q) query = query.ilike('payee_display', `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve analysis_account_id → account ref for display
  const accountIds = [...new Set(
    (data ?? [])
      .map(r => (r.template as { analysis_account_id?: string | null } | null)?.analysis_account_id)
      .filter((id): id is string => Boolean(id)),
  )];
  let accountsById: Record<string, { id: string; name: string; ledger: string | null }> = {};
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase
      .from('bookkeeping_accounts')
      .select('id, name, ledger')
      .in('id', accountIds);
    accountsById = Object.fromEntries((accounts ?? []).map(a => [a.id, a]));
  }

  const payees = (data ?? []).map(r => {
    const template = (r.template ?? {}) as {
      analysis_account_id?: string | null;
      vat_treatment?: string | null;
      vat_rate?: number | null;
      entry_details?: string | null;
    };
    const analysis = template.analysis_account_id ? accountsById[template.analysis_account_id] ?? null : null;
    return {
      id: r.id,
      payee_display: r.payee_display,
      use_count: r.use_count,
      last_used_at: r.last_used_at,
      analysis_account: analysis,
      vat_treatment: template.vat_treatment ?? null,
      vat_rate: template.vat_rate ?? null,
      entry_details: template.entry_details ?? null,
    };
  });

  return NextResponse.json({ payees });
}
