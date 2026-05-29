import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isFixedAssetLedger } from '@/lib/bookkeeping/fixedAssets';

// ── /api/bookkeeping/books/[id]/depreciation/settings ────────────────────────
// Effective-dated rate/method per FA ledger. Changes are prospective — the
// engine segments any period that straddles an effective_from date.

// GET ?ledger=FA - vehicles  → the setting history for that ledger.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const ledger = new URL(req.url).searchParams.get('ledger');
  if (!ledger) return NextResponse.json({ error: 'ledger is required' }, { status: 400 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_ledger_depreciation_settings')
    .select('*')
    .eq('book_id', params.id)
    .eq('ledger', ledger)
    .order('effective_from', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ settings: data ?? [] });
}

// PUT → upsert one effective-dated setting (unique on book+ledger+date).
const PutBody = z.object({
  ledger: z.string().min(1),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['straight_line', 'reducing_balance']),
  annual_rate: z.number().min(0).max(100),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PutBody>;
  try { body = PutBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (!isFixedAssetLedger(body.ledger)) {
    return NextResponse.json({ error: 'Not a fixed-asset ledger' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // Upsert: one setting per (book, ledger, effective_from).
  const { data: existing } = await supabase
    .from('bookkeeping_ledger_depreciation_settings')
    .select('id')
    .eq('book_id', params.id)
    .eq('ledger', body.ledger)
    .eq('effective_from', body.effective_from)
    .maybeSingle();

  let row;
  if (existing) {
    const { data, error } = await supabase
      .from('bookkeeping_ledger_depreciation_settings')
      .update({ method: body.method, annual_rate: body.annual_rate })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  } else {
    const { data, error } = await supabase
      .from('bookkeeping_ledger_depreciation_settings')
      .insert({
        book_id: params.id,
        ledger: body.ledger,
        effective_from: body.effective_from,
        method: body.method,
        annual_rate: body.annual_rate,
        created_by: ctx.userId,
      })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'depreciation_setting',
    entity_id: row.id,
    action: existing ? 'update' : 'create',
    diff: { ledger: body.ledger, effective_from: body.effective_from, method: body.method, annual_rate: body.annual_rate },
  });

  return NextResponse.json({ setting: row });
}

// DELETE ?id=…  → remove one effective-dated setting row.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const settingId = new URL(req.url).searchParams.get('id');
  if (!settingId) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { error } = await supabase
    .from('bookkeeping_ledger_depreciation_settings')
    .delete()
    .eq('id', settingId)
    .eq('book_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'depreciation_setting',
    entity_id: settingId,
    action: 'delete',
    diff: {},
  });

  return NextResponse.json({ ok: true });
}
