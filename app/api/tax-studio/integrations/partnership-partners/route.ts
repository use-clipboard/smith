import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';

// GET /api/tax-studio/integrations/partnership-partners?clientId=<uuid>
// The partners of a partnership client's bookkeeping book — name, profit share and
// (via the linked client) their UTR — so the SA800 Partnership Statement can be
// auto-populated. Read-only; RLS-scoped to the firm.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createClient();

  // Resolve the partnership's active book (firm-scoped).
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, name')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId).eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  if (!book) return NextResponse.json({ found: false, bookName: '', partners: [] });

  const { data: rows } = await supabase
    .from('bookkeeping_book_participants')
    .select('name, profit_share_pct, linked_client_id, clients:linked_client_id(utr_number)')
    .eq('book_id', book.id as string)
    .eq('role', 'partner');

  const partners = (rows ?? []).map(r => {
    const linked = (r.clients ?? null) as { utr_number?: string | null } | null;
    return {
      name: (r.name as string | null) ?? '',
      sharePct: Number(r.profit_share_pct ?? 0) || 0,
      clientId: (r.linked_client_id as string | null) ?? null,
      utr: linked?.utr_number ?? null,
    };
  });

  return NextResponse.json({ found: partners.length > 0, bookName: (book.name as string) ?? 'Bookkeeping', partners });
}
