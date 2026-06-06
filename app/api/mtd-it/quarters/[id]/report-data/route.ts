import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getQuarterDates } from '@/lib/mtdIt/quarters';
import type { MtdItQuarterType } from '@/types';

// ── GET /api/mtd-it/quarters/[id]/report-data ────────────────────────────────
// All inputs needed to (re)generate the client approval P&L PDF for a quarter:
// entries, trades, properties, fx rates, streams, period dates and firm
// branding. Used by the submission-summary lightbox's "Download report".
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { data: quarter } = await service
    .from('mtd_it_quarters')
    .select('id, client_id, tax_year, quarter, consolidated, streams_snapshot, fx_rates')
    .eq('id', params.id).single();
  if (!quarter) return NextResponse.json({ error: 'Quarter not found.' }, { status: 404 });

  const { data: client } = await service
    .from('clients').select('id, name, client_ref, mtd_it_quarter_type, mtd_it_streams')
    .eq('id', quarter.client_id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [{ data: entries }, { data: trades }, { data: props }, { data: firm }] = await Promise.all([
    service.from('mtd_it_entries')
      .select('id, stream, trade_id, property_id, source_file_name, page_number, entry_date, description, supplier, category, entry_type, gross_amount, net_amount, vat_amount, currency, fx_rate, gbp_amount, share_pct, flagged_reason, flag_dismissed')
      .eq('quarter_id', params.id),
    service.from('mtd_it_trades').select('id, client_id, name, description, active, created_at').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_properties').select('id, client_id, address, country, currency, ownership_pct, property_type, active, created_at').eq('client_id', client.id).eq('active', true),
    service.from('mtd_it_firm_settings').select('brand_primary_color').eq('firm_id', ctx.firmId).maybeSingle(),
  ]);

  const quarterType: MtdItQuarterType = (client.mtd_it_quarter_type as MtdItQuarterType) ?? 'calendar';
  const range = getQuarterDates(quarter.tax_year as number, quarter.quarter as 1 | 2 | 3 | 4, quarterType);

  return NextResponse.json({
    entries: entries ?? [],
    trades: trades ?? [],
    properties: props ?? [],
    fxRates: (quarter.fx_rates ?? {}) as Record<string, number>,
    streams: (quarter.streams_snapshot ?? client.mtd_it_streams ?? { sole: false, uk_rental: false, foreign_rental: false }),
    consolidated: Boolean(quarter.consolidated),
    clientName: client.name,
    clientRef: client.client_ref,
    rangeFrom: range.from,
    rangeTo: range.to,
    brandPrimaryColor: (firm?.brand_primary_color as string | null) ?? null,
  });
}
