import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Brought-forward unrelieved residential finance costs, per client / tax year /
// property business (uk_rental | foreign_rental). A manual figure the accountant
// carries over from the prior year's computation; reported to HMRC alongside the
// current-period residential finance cost. See migration 20260776.

async function clientBelongsToFirm(clientId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from('clients').select('firm_id').eq('id', clientId).maybeSingle();
  return (data as { firm_id?: string } | null)?.firm_id === firmId;
}

// GET /api/mtd-it/finance-bf?client_id=...&tax_year=2026
// → { uk_rental: number, foreign_rental: number }
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const taxYear = Number(url.searchParams.get('tax_year'));
  if (!clientId || !Number.isInteger(taxYear)) return NextResponse.json({ error: 'client_id and tax_year required' }, { status: 400 });
  if (!(await clientBelongsToFirm(clientId, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_finance_bf')
    .select('stream, amount')
    .eq('client_id', clientId).eq('tax_year', taxYear);
  if (error) return NextResponse.json({ error: 'Failed to load' }, { status: 500 });

  const out: Record<string, number> = { uk_rental: 0, foreign_rental: 0 };
  for (const r of data ?? []) out[r.stream as string] = Number(r.amount ?? 0);
  return NextResponse.json({ broughtForward: out });
}

const PutSchema = z.object({
  client_id: z.string().uuid(),
  tax_year:  z.number().int(),
  stream:    z.enum(['uk_rental', 'foreign_rental']),
  amount:    z.number().min(0),
});

// PUT /api/mtd-it/finance-bf — upsert one client/tax-year/stream figure.
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  if (!(await clientBelongsToFirm(parsed.data.client_id, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { error } = await supabase
    .from('mtd_it_finance_bf')
    .upsert(
      { ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: 'client_id,tax_year,stream' },
    );
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
