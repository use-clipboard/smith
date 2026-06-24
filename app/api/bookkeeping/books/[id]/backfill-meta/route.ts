import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { backfillAccountMeta } from '@/lib/bookkeeping/backfillAccountMeta';
import type { BookTemplateType } from '@/types/bookkeeping';

// ── POST /api/bookkeeping/books/[id]/backfill-meta ───────────────────────────
// Admin-only one-off: stamp system_role / ledger_key / code onto a book's
// accounts created before migration 20260630. Idempotent — only fills NULLs.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can backfill account metadata' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, template_type')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const result = await backfillAccountMeta(supabase, params.id, book.template_type as BookTemplateType);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
