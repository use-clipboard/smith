import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getQuarterDates } from '@/lib/mtdIt/quarters';
import type { MtdItQuarterType } from '@/types';

// Import from Landlord (Feed A) — pull a saved Landlord Analysis into this MTD IT
// quarter's UK-property entries, for the transactions whose date falls in the
// quarter window. Mirrors import-bookkeeping / co-owner-import. Capital items are
// excluded; residential finance costs ARE included as an expense (the SA
// restriction is applied later at finalisation, not quarterly).
//
// The saved Landlord analysis stores WHOLE-PROPERTY amounts (its per-person
// split happens at computation time, not in result_data), so we store the full
// amount here and carry the matched property's ownership in share_pct. The row
// therefore still reconciles to its source document, and lib/mtdIt/amounts
// applies the share wherever a figure is totalled, reported or filed.

type DB = ReturnType<typeof createClient>;

const LOCKED = new Set(['sent', 'approved', 'submitted']);

interface IncomeTx { Date?: string; PropertyAddress?: string; Description?: string; Amount?: number }
interface ExpenseTx { DueDate?: string; PropertyAddress?: string; Description?: string; Supplier?: string; Category?: string; Amount?: number; CapitalExpense?: boolean }
interface LandlordResult { income?: IncomeTx[]; expenses?: ExpenseTx[]; dateFrom?: string; dateTo?: string }

interface QuarterCtx { client_id: string; tax_year: number; quarter: 1 | 2 | 3 | 4; status: string; from: string; to: string }

async function loadQuarter(supabase: DB, quarterId: string, firmId: string): Promise<QuarterCtx | null> {
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('client_id, tax_year, quarter, status, clients!inner(firm_id, mtd_it_quarter_type)')
    .eq('id', quarterId)
    .maybeSingle();
  if (!data) return null;
  const client = (data as unknown as { clients?: { firm_id?: string; mtd_it_quarter_type?: MtdItQuarterType | null } }).clients;
  if (client?.firm_id !== firmId) return null;
  const q = data.quarter as 1 | 2 | 3 | 4;
  const range = getQuarterDates(data.tax_year as number, q, client.mtd_it_quarter_type ?? 'calendar');
  return { client_id: data.client_id as string, tax_year: data.tax_year as number, quarter: q, status: data.status as string, from: range.from, to: range.to };
}

const normAddress = (a: string) => (a || '').replace(/\s+/g, ' ').trim().toLowerCase();
const inWindow = (d: string | undefined, from: string, to: string) => !!d && d >= from && d <= to;

interface PreviewLine {
  entry_type: 'income' | 'expense';
  entry_date: string;
  description: string;
  supplier: string;
  category: string;
  property: string;
  amount: number;
}

// Flatten a saved analysis into the entries that fall inside the quarter window
// (capital excluded). Shared by the preview (GET) and the import (POST).
function windowLines(rd: LandlordResult, from: string, to: string): PreviewLine[] {
  const lines: PreviewLine[] = [];
  for (const r of rd.income ?? []) {
    if (!inWindow(r.Date, from, to)) continue;
    lines.push({ entry_type: 'income', entry_date: r.Date!, description: r.Description ?? '', supplier: '', category: 'Total rents and other income from property', property: r.PropertyAddress ?? '', amount: r.Amount ?? 0 });
  }
  for (const r of rd.expenses ?? []) {
    if (r.CapitalExpense) continue;                 // capital is not allowable
    if (!inWindow(r.DueDate, from, to)) continue;
    lines.push({ entry_type: 'expense', entry_date: r.DueDate!, description: r.Description ?? '', supplier: r.Supplier ?? '', category: r.Category ?? '', property: r.PropertyAddress ?? '', amount: r.Amount ?? 0 });
  }
  return lines;
}

// GET → list saved analyses for the client (with in-window counts), or ?output_id= for the preview lines.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const q = await loadQuarter(supabase, params.id, ctx.firmId);
  if (!q) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  const outputId = new URL(req.url).searchParams.get('output_id');

  // Existing landlord-sourced entries on this quarter (for the append/replace hint).
  const { count: existingLandlord } = await supabase
    .from('mtd_it_entries')
    .select('id', { count: 'exact', head: true })
    .eq('quarter_id', params.id).eq('source', 'landlord');

  if (outputId) {
    const { data: out } = await supabase
      .from('outputs')
      .select('id, client_id, result_data')
      .eq('id', outputId).eq('feature', 'landlord_analysis').maybeSingle();
    if (!out || out.client_id !== q.client_id) return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    const lines = windowLines((out.result_data ?? {}) as LandlordResult, q.from, q.to);
    return NextResponse.json({ from: q.from, to: q.to, status: q.status, lines, existing_landlord_count: existingLandlord ?? 0 });
  }

  const { data: outputs } = await supabase
    .from('outputs')
    .select('id, created_at, source_filenames, result_data')
    .eq('feature', 'landlord_analysis').eq('client_id', q.client_id)
    .order('created_at', { ascending: false })
    .limit(50);

  const analyses = (outputs ?? []).map(o => {
    const rd = (o.result_data ?? {}) as LandlordResult;
    const lines = windowLines(rd, q.from, q.to);
    const income = lines.filter(l => l.entry_type === 'income');
    const expense = lines.filter(l => l.entry_type === 'expense');
    return {
      output_id: o.id as string,
      created_at: o.created_at as string,
      period_from: rd.dateFrom ?? '',
      period_to: rd.dateTo ?? '',
      filenames: (o.source_filenames as string[] | null) ?? [],
      income_count: income.length,
      expense_count: expense.length,
      income_total: income.reduce((s, l) => s + l.amount, 0),
      expense_total: expense.reduce((s, l) => s + l.amount, 0),
    };
  }).filter(a => a.income_count + a.expense_count > 0);   // only analyses with entries in this quarter

  return NextResponse.json({ from: q.from, to: q.to, status: q.status, analyses, existing_landlord_count: existingLandlord ?? 0 });
}

const Body = z.object({
  output_id: z.string().uuid(),
  mode: z.enum(['append', 'replace']),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const q = await loadQuarter(supabase, params.id, ctx.firmId);
  if (!q) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  if (LOCKED.has(q.status)) return NextResponse.json({ error: `This quarter is ${q.status} — reopen it before importing.` }, { status: 409 });

  const { data: out } = await supabase
    .from('outputs')
    .select('id, client_id, result_data')
    .eq('id', body.output_id).eq('feature', 'landlord_analysis').maybeSingle();
  if (!out || out.client_id !== q.client_id) return NextResponse.json({ error: 'Analysis not found for this client' }, { status: 404 });

  const lines = windowLines((out.result_data ?? {}) as LandlordResult, q.from, q.to);
  if (lines.length === 0) return NextResponse.json({ error: 'No transactions fall within this quarter.' }, { status: 400 });

  // Match each line's address to the client's property register (mtd_it_properties,
  // shared with the Landlord tool) to tag the entry + carry the ownership share.
  const { data: props } = await supabase
    .from('mtd_it_properties')
    .select('id, address, ownership_pct')
    .eq('client_id', q.client_id).eq('property_type', 'uk');
  const propByAddr = new Map<string, { id: string; ownership_pct: number }>();
  for (const p of props ?? []) propByAddr.set(normAddress(p.address as string), { id: p.id as string, ownership_pct: Number(p.ownership_pct) });

  let replaced = 0;
  if (body.mode === 'replace') {
    const { count } = await supabase
      .from('mtd_it_entries')
      .delete({ count: 'exact' })
      .eq('quarter_id', params.id).eq('source', 'landlord');
    replaced = count ?? 0;
  }

  const rows = lines.map(l => {
    const match = l.property ? propByAddr.get(normAddress(l.property)) : undefined;
    return {
      quarter_id: params.id,
      stream: 'uk_rental',
      trade_id: null,
      property_id: match?.id ?? null,
      source_file_name: null,
      entry_date: l.entry_date,
      description: l.description,
      supplier: l.supplier || null,
      category: l.category,
      entry_type: l.entry_type,
      gross_amount: l.amount,
      net_amount: l.amount,
      currency: 'GBP',
      gbp_amount: l.amount,
      share_pct: match ? match.ownership_pct : 100,
      manual: false,
      source: 'landlord',
    };
  });

  const { data: created, error } = await supabase.from('mtd_it_entries').insert(rows).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('mtd_it_quarters').update({ status: 'draft' }).eq('id', params.id).eq('status', 'not_started');

  return NextResponse.json({ created: created?.length ?? 0, replaced });
}
