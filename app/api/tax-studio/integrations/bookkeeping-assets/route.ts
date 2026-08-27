import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { syncAdditionAssets } from '@/lib/bookkeeping/depreciationServer';

export const dynamic = 'force-dynamic';

// Map a bookkeeping fixed-asset ledger (category) to a suggested capital-
// allowances treatment. The accountant confirms/overrides on import.
function mapLedger(ledger: string): {
  assetType: 'plant' | 'car' | 'other';
  treatment: 'aia' | 'main' | 'special';
  excluded: boolean;   // not plant & machinery — don't import as a CA addition
  note?: string;
} {
  const l = (ledger || '').toLowerCase();
  if (l.includes('vehicle')) return { assetType: 'car', treatment: 'main', excluded: false, note: 'Confirm car vs van and enter CO₂ — cars follow the CO₂ decision tree.' };
  if (l.includes('land') || l.includes('building')) return { assetType: 'other', treatment: 'main', excluded: true, note: 'Land is excluded; a building/structure may qualify for SBA (3%) — add it in the SBA section.' };
  if (l.includes('intangible')) return { assetType: 'other', treatment: 'main', excluded: true, note: 'Intangible fixed asset — not plant & machinery (no capital allowances).' };
  if (l.includes('fixture') || l.includes('equipment')) return { assetType: 'plant', treatment: 'aia', excluded: false, note: 'Check for integral features (electrical / heating / air-con) — those are special-rate.' };
  return { assetType: 'plant', treatment: 'aia', excluded: false };
}

// GET /api/tax-studio/integrations/bookkeeping-assets?clientId=<uuid>
// Returns the client's bookkeeping fixed-asset register, each asset mapped to a
// suggested capital-allowances treatment. 200 with found:false when no book.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createServiceClient();

  // Resolve the client's (non-archived) book — most recently updated wins.
  const { data: books, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, name, updated_at')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId).eq('archived', false)
    .order('updated_at', { ascending: false });
  if (bookErr) return NextResponse.json({ error: bookErr.message }, { status: 500 });
  if (!books || books.length === 0) return NextResponse.json({ found: false, assets: [] });

  const book = books[0];

  // Materialise any un-synced "Cost - additions" postings into asset rows first,
  // so the register is current (the sync is per-ledger and normally lazy).
  const { data: faAccts } = await supabase
    .from('bookkeeping_accounts')
    .select('ledger').eq('book_id', book.id).ilike('ledger', 'FA -%');
  const ledgers = [...new Set((faAccts ?? []).map(a => (a as { ledger: string }).ledger).filter(Boolean))];
  for (const l of ledgers) { try { await syncAdditionAssets(supabase, book.id, l); } catch { /* best-effort */ } }

  const { data: assets, error: assetErr } = await supabase
    .from('bookkeeping_assets')
    .select('id, ledger, source, description, purchase_date, cost, status, disposal_date, disposal_proceeds')
    .eq('book_id', book.id)
    .order('purchase_date', { ascending: true });
  if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });

  const mapped = (assets ?? [])
    .filter(a => String((a as { ledger: string }).ledger || '').toLowerCase().startsWith('fa -'))
    .map(a => {
      const row = a as {
        id: string; ledger: string; source: string; description: string; purchase_date: string;
        cost: number; status: string; disposal_date: string | null; disposal_proceeds: number | null;
      };
      const m = mapLedger(row.ledger);
      return {
        id: row.id,
        description: row.description,
        cost: row.cost,
        category: row.ledger,
        purchaseDate: row.purchase_date,
        broughtForward: row.source === 'brought_forward',
        disposed: row.status === 'disposed',
        disposalDate: row.disposal_date,
        disposalProceeds: row.disposal_proceeds,
        assetType: m.assetType,
        treatment: m.treatment,
        excluded: m.excluded,
        note: m.note,
      };
    });

  return NextResponse.json({
    found: true,
    book: { id: book.id, name: book.name },
    multipleBooks: books.length > 1,
    assets: mapped,
  });
}
