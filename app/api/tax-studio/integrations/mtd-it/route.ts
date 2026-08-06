import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { computeFilingUnits, type FilingUnit } from '@/lib/mtdIt/computeUpdate';
import type { MtdItQuarterType } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/tax-studio/integrations/mtd-it?clientId=<uuid>&taxYear=2025/26
//
// Aggregates a client's MTD IT quarterly data into ANNUAL figures for the SA100
// return, reusing the canonical computeFilingUnits() so the figures match what
// was previewed/filed in MTD IT (share-adjusted, FX-converted, flagged-excluded).
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const taxYearLabel = url.searchParams.get('taxYear') ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  // Tax Studio uses the '2025/26' label; MTD IT keys on the int starting year (2025).
  const startYear = parseInt(taxYearLabel.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return NextResponse.json({ error: 'Invalid taxYear' }, { status: 400 });

  const supabase = createServiceClient();

  // Firm scoping: mtd_it_* tables have no firm_id — anchor on the client record.
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('id, firm_id, mtd_it_quarter_type')
    .eq('id', clientId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!client || client.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const quarterType = ((client.mtd_it_quarter_type as string | null) ?? 'calendar') as MtdItQuarterType;

  const empty = { found: false, taxYear: taxYearLabel, quartersFound: 0, selfEmployment: [], ukProperty: null, foreignProperty: null };

  try {
    // Quarters actually worked on (a lazily-created 'not_started' shell doesn't count).
    const { data: quarters } = await supabase
      .from('mtd_it_quarters')
      .select('id, status')
      .eq('client_id', clientId).eq('tax_year', startYear);
    const quartersFound = (quarters ?? []).filter(q => (q.status as string) !== 'not_started').length;

    const { data: tradeRows } = await supabase
      .from('mtd_it_trades')
      .select('id, name, hmrc_business_id')
      .eq('client_id', clientId).eq('active', true);
    const { data: propRows } = await supabase
      .from('mtd_it_properties')
      .select('id, address, property_type, country, hmrc_business_id')
      .eq('client_id', clientId).eq('active', true);

    const trades = (tradeRows ?? []).map(t => ({
      id: t.id as string,
      name: (t.name as string | null) ?? 'Self-employment',
      hmrcBusinessId: (t.hmrc_business_id as string | null) ?? null,
    }));
    const props = (propRows ?? []).map(p => ({
      id: p.id as string,
      address: (p.address as string | null) ?? 'Property',
      propertyType: ((p.property_type as string) === 'foreign' ? 'foreign' : 'uk') as 'uk' | 'foreign',
      country: (p.country as string | null) ?? null,
      hmrcBusinessId: (p.hmrc_business_id as string | null) ?? null,
    }));

    if (trades.length === 0 && props.length === 0) {
      return NextResponse.json({ ...empty, quartersFound });
    }

    const { units, errors } = await computeFilingUnits(supabase, {
      clientId, taxYear: startYear, quarterType, uptoQuarter: 4, trades, props,
    });

    const mk = (u: FilingUnit) => ({
      label: u.name,
      income: Math.round(u.figures.income),
      expenses: Math.round(u.figures.consolidatedExpenses),
      profit: Math.round(u.figures.income - u.figures.consolidatedExpenses),
    });
    const hasData = (u: FilingUnit) => u.figures.income !== 0 || u.figures.consolidatedExpenses !== 0;

    const selfEmployment = units.filter(u => u.typeOfBusiness === 'self-employment' && hasData(u)).map(mk);
    const ukUnit = units.find(u => u.typeOfBusiness === 'uk-property' && hasData(u));
    const fgUnit = units.find(u => u.typeOfBusiness === 'foreign-property' && hasData(u));

    const found = selfEmployment.length > 0 || !!ukUnit || !!fgUnit;

    return NextResponse.json({
      found,
      taxYear: taxYearLabel,
      quartersFound: quartersFound || (found ? 1 : 0),
      selfEmployment,
      ukProperty: ukUnit ? mk(ukUnit) : null,
      foreignProperty: fgUnit ? mk(fgUnit) : null,
      note: errors.length ? errors[0] : undefined,
    });
  } catch (err) {
    console.error('[/api/tax-studio/integrations/mtd-it]', err);
    return NextResponse.json({ error: 'Could not read MTD IT figures.' }, { status: 500 });
  }
}
