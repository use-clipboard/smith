import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import type { MtdItStreams } from '@/types';

const DEFAULT_STREAMS: MtdItStreams = { sole: false, uk_rental: false, foreign_rental: false };

const StreamsSchema = z.object({
  sole:           z.boolean(),
  uk_rental:      z.boolean(),
  foreign_rental: z.boolean(),
});

// GET /api/mtd-it/quarters?client_id=...&tax_year=2026&quarter=1
//   Idempotent fetch + create. If the row for (client, year, quarter) doesn't
//   exist yet, it's created with the client's current default streams snapshot.
const GetSchema = z.object({
  client_id: z.string().uuid(),
  tax_year:  z.number().int().min(2026),
  quarter:   z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const parsed = GetSchema.safeParse({
    client_id: url.searchParams.get('client_id') ?? '',
    tax_year:  Number(url.searchParams.get('tax_year') ?? 0),
    quarter:   Number(url.searchParams.get('quarter') ?? 0),
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  const { client_id, tax_year, quarter } = parsed.data;

  const supabase = createClient();

  // Firm-scope check by reading the client row
  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, firm_id, mtd_it_streams, mtd_it_quarter_type')
    .eq('id', client_id)
    .maybeSingle();
  if (!clientRow || (clientRow as { firm_id: string }).firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // Try to fetch existing quarter row
  const { data: existing, error: selErr } = await supabase
    .from('mtd_it_quarters')
    .select('*')
    .eq('client_id', client_id)
    .eq('tax_year', tax_year)
    .eq('quarter', quarter)
    .maybeSingle();
  if (selErr) {
    console.error('GET /api/mtd-it/quarters select', selErr);
    return NextResponse.json({ error: 'Failed to load quarter' }, { status: 500 });
  }

  if (existing) return NextResponse.json({ quarter: existing });

  // Create the row, copying the client's default streams
  const defaultStreams = (clientRow as { mtd_it_streams: MtdItStreams | null }).mtd_it_streams ?? DEFAULT_STREAMS;

  // Carry the consolidated-reporting preference forward from the most
  // recent prior quarter for this client (any year / quarter). Firms tend
  // to use the same reporting style quarter to quarter, so making them
  // re-toggle every time is friction. The user can still flip it on the
  // review screen once the quarter loads.
  const { data: lastQuarter } = await supabase
    .from('mtd_it_quarters')
    .select('consolidated')
    .eq('client_id', client_id)
    .order('tax_year', { ascending: false })
    .order('quarter', { ascending: false })
    .limit(1)
    .maybeSingle();
  const inheritedConsolidated = (lastQuarter as { consolidated?: boolean } | null)?.consolidated ?? false;

  const { data: created, error: insErr } = await supabase
    .from('mtd_it_quarters')
    .insert({
      client_id,
      tax_year,
      quarter,
      streams_snapshot: defaultStreams,
      consolidated:     inheritedConsolidated,
      created_by:       ctx.userId,
    })
    .select('*')
    .single();
  if (insErr) {
    console.error('GET /api/mtd-it/quarters insert', insErr);
    return NextResponse.json({ error: 'Failed to create quarter' }, { status: 500 });
  }
  return NextResponse.json({ quarter: created });
}

// PATCH /api/mtd-it/quarters/[id] lives in the [id]/route.ts sibling
