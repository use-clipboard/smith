import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';

export const dynamic = 'force-dynamic';

// dd-mm-yyyy for display (from an ISO date).
function ukDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

// GET /api/tax-studio/integrations/dividends?clientId=<uuid>&taxYear=2025/26
//
// Finds the UK-company dividends an INDIVIDUAL received in the tax year, across
// every Ltd book where they are a shareholder participant. The per-recipient
// amount is already snapshotted at declaration (bookkeeping_dividend_recipients),
// so this just sums it — no re-splitting. Grouped by paying company; the Analyse
// card imports each into SA100 box 4 (Dividends from UK companies).
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

  const windowStart = `${startYear}-04-06`;
  const windowEnd = `${startYear + 1}-04-05`;
  const supabase = createClient();

  // Shareholder participant links for this individual → the paying entity + book.
  const { data: parts, error: pErr } = await supabase
    .from('bookkeeping_book_participants')
    .select('id, bookkeeping_books!inner(client_id, name, archived)')
    .eq('firm_id', ctx.firmId)
    .eq('linked_client_id', clientId)
    .eq('role', 'shareholder');
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  type PartRow = { id: string; bookkeeping_books: { client_id: string | null; name: string | null; archived: boolean } | null };
  const partById = new Map<string, { entityClientId: string; entityName: string }>();
  for (const p of (parts ?? []) as unknown as PartRow[]) {
    const book = p.bookkeeping_books;
    if (!book || book.archived || !book.client_id) continue;
    partById.set(p.id, { entityClientId: book.client_id, entityName: book.name ?? 'Company' });
  }
  const participantIds = [...partById.keys()];
  if (participantIds.length === 0) return NextResponse.json({ found: false, total: 0, sources: [] });

  // The dividend slices paid to those shareholdings.
  const { data: recips, error: rErr } = await supabase
    .from('bookkeeping_dividend_recipients')
    .select('amount, participant_id, bookkeeping_dividends!inner(id, tax_year, declaration_date, payment_date, dividend_type)')
    .eq('firm_id', ctx.firmId)
    .in('participant_id', participantIds);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  type RecipRow = { amount: number | string; participant_id: string | null; bookkeeping_dividends: { id: string; tax_year: string | null; declaration_date: string | null; payment_date: string | null; dividend_type: string | null } | null };

  // In-year when the dividend's own tax_year matches, else its relevant date
  // (paid, else declared) falls in the 6 Apr–5 Apr window.
  const inYear = (d: RecipRow['bookkeeping_dividends']) => {
    if (!d) return false;
    if (d.tax_year) return d.tax_year === taxYearLabel;
    const when = d.payment_date || d.declaration_date;
    return !!when && when >= windowStart && when <= windowEnd;
  };

  const groups = new Map<string, { clientId: string; name: string; ref: string; amount: number; items: { company: string; description?: string; paymentDate?: string; amount: number }[] }>();
  for (const r of (recips ?? []) as unknown as RecipRow[]) {
    const meta = r.participant_id ? partById.get(r.participant_id) : undefined;
    const div = r.bookkeeping_dividends;
    if (!meta || !inYear(div)) continue;
    const amount = Math.round(Number(r.amount) || 0);
    if (amount === 0) continue;
    const g = groups.get(meta.entityClientId) ?? { clientId: meta.entityClientId, name: meta.entityName, ref: '', amount: 0, items: [] };
    g.amount += amount;
    g.items.push({
      company: meta.entityName,
      description: div?.dividend_type ? `${div.dividend_type === 'final' ? 'Final' : 'Interim'} dividend` : undefined,
      paymentDate: ukDate(div?.payment_date || div?.declaration_date),
      amount,
    });
    groups.set(meta.entityClientId, g);
  }

  const sources = [...groups.values()];
  if (sources.length === 0) return NextResponse.json({ found: false, total: 0, sources: [] });

  // Resolve the paying companies' refs for display.
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, client_ref')
    .eq('firm_id', ctx.firmId)
    .in('id', sources.map(s => s.clientId));
  const metaById = new Map((clients ?? []).map((c: { id: string; name: string | null; client_ref: string | null }) => [c.id, { name: c.name ?? 'Company', ref: c.client_ref ?? '' }]));
  for (const s of sources) {
    const m = metaById.get(s.clientId);
    if (m) { s.name = m.name; s.ref = m.ref; }
  }

  const total = sources.reduce((a, s) => a + s.amount, 0);
  return NextResponse.json({ found: true, total, sources: sources.map(s => ({ ...s, count: s.items.length })) });
}
