import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';

export const dynamic = 'force-dynamic';

// GET /api/tax-studio/integrations/entity-sources?clientId=<uuid>&taxYear=2025/26
//
// Discovers the business entities an INDIVIDUAL is linked to as a sole trader or
// partner, so their trade/partnership figures can be pulled into this person's SA
// return without hunting for the entity by hand. This is the trade/partnership
// analog of the landlord per-owner pull: instead of `property_owners`, the link
// lives on `bookkeeping_book_participants` (role + linked_client_id +
// profit_share_pct). Because participants sit ON a bookkeeping book, every
// discovered entity has a book — so the figures are read from Bookkeeping
// (sole trade → SA103 itemisation; partner's share of net profit → SA104).
//
// Returns pure link data (entity client + role + profit share). The Analyse-stage
// cards read the actual P&L for each entity via the existing readers.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const taxYearLabel = url.searchParams.get('taxYear') ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const startYear = parseInt(taxYearLabel.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return NextResponse.json({ error: 'Invalid taxYear' }, { status: 400 });

  // Tax-year window (6 Apr – 5 Apr) — a participant counts if it was effective
  // for any part of it (open-ended dates always count).
  const windowStart = `${startYear}-04-06`;
  const windowEnd = `${startYear + 1}-04-05`;
  const effectiveInYear = (from?: string | null, to?: string | null) =>
    (!from || from <= windowEnd) && (!to || to >= windowStart);

  const supabase = createClient();

  const { data: parts, error } = await supabase
    .from('bookkeeping_book_participants')
    .select('role, profit_share_pct, effective_from, effective_to, bookkeeping_books!inner(id, client_id, name, archived)')
    .eq('firm_id', ctx.firmId)
    .eq('linked_client_id', clientId)
    .in('role', ['sole_trader', 'partner']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    role: 'sole_trader' | 'partner';
    profit_share_pct: number | string | null;
    effective_from: string | null;
    effective_to: string | null;
    bookkeeping_books: { id: string; client_id: string | null; name: string | null; archived: boolean } | null;
  };

  // Group by entity client — keep the strongest (most recent, in-year) link per
  // entity/role. An individual on two different partnership books = two sources.
  const byEntity = new Map<string, { clientId: string; role: 'sole_trader' | 'partner'; sharePct: number | null; bookName: string }>();
  for (const r of (parts ?? []) as unknown as Row[]) {
    const book = r.bookkeeping_books;
    if (!book || book.archived || !book.client_id) continue;
    // The entity must be a DIFFERENT client — a person listed as the sole trader
    // of their own client record is already the return's own source.
    if (book.client_id === clientId) continue;
    if (!effectiveInYear(r.effective_from, r.effective_to)) continue;
    const share = r.profit_share_pct == null ? null : Number(r.profit_share_pct);
    const key = `${book.client_id}:${r.role}`;
    if (!byEntity.has(key)) {
      byEntity.set(key, { clientId: book.client_id, role: r.role, sharePct: Number.isFinite(share as number) ? (share as number) : null, bookName: book.name ?? 'Bookkeeping' });
    }
  }

  const entityIds = [...new Set([...byEntity.values()].map(v => v.clientId))];
  const nameById = new Map<string, { name: string; ref: string }>();
  if (entityIds.length) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, client_ref')
      .eq('firm_id', ctx.firmId)
      .in('id', entityIds);
    for (const c of (clients ?? []) as { id: string; name: string | null; client_ref: string | null }[]) {
      nameById.set(c.id, { name: c.name ?? 'Business', ref: c.client_ref ?? '' });
    }
  }

  const soleTrades: unknown[] = [];
  const partnerships: unknown[] = [];
  for (const v of byEntity.values()) {
    const meta = nameById.get(v.clientId);
    if (!meta) continue; // entity client not visible to this firm — skip
    const entry = { clientId: v.clientId, name: meta.name, ref: meta.ref, role: v.role, sharePct: v.sharePct, bookName: v.bookName };
    (v.role === 'partner' ? partnerships : soleTrades).push(entry);
  }

  return NextResponse.json({ soleTrades, partnerships });
}
