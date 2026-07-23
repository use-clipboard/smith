import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/vat-status ───────────────────────────────────
// GET  → the book's VAT status history (newest first).
// POST → record a VAT status change effective from a date. If the change is the
//        one in effect as of today, the book's denormalised current vat_* fields
//        are updated to match.

const VAT_SCHEMES = ['standard', 'flat_rate', 'cash', 'annual', 'margin', 'partial_exemption'] as const;

const SELECT = `
  id, book_id, effective_from, vat_registered, vat_scheme, flat_rate_percentage,
  vat_number, note, created_by, created_at,
  creator:users!bookkeeping_vat_status_changes_created_by_fkey(id, full_name, email)
`;

const Body = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vat_registered: z.boolean(),
  vat_scheme: z.enum(VAT_SCHEMES).nullable().optional(),
  flat_rate_percentage: z.number().min(0).max(100).nullable().optional(),
  vat_number: z.string().max(50).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_vat_status_changes')
    .select(SELECT)
    .eq('book_id', params.id)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ changes: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, admin_locked').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  // Normalise: scheme/rate/number only meaningful when registered.
  const scheme = body.vat_registered ? (body.vat_scheme ?? 'standard') : null;
  const rate = body.vat_registered && scheme === 'flat_rate' ? (body.flat_rate_percentage ?? null) : null;
  const vrn = body.vat_registered ? (body.vat_number ?? null) : null;

  const { data: inserted, error: insErr } = await supabase
    .from('bookkeeping_vat_status_changes')
    .insert({
      book_id: params.id,
      effective_from: body.effective_from,
      vat_registered: body.vat_registered,
      vat_scheme: scheme,
      flat_rate_percentage: rate,
      vat_number: vrn,
      note: body.note ?? null,
      created_by: ctx.userId,
    })
    .select(SELECT)
    .single();
  if (insErr || !inserted) return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });

  // Recompute the book's denormalised "current" fields from the change in
  // effect as of today (the most recent effective_from <= today).
  const today = new Date().toISOString().slice(0, 10);
  const { data: current } = await supabase
    .from('bookkeeping_vat_status_changes')
    .select('vat_registered, vat_scheme, flat_rate_percentage, vat_number')
    .eq('book_id', params.id)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    // Same-day changes tie on effective_from — the latest-recorded one wins.
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (current) {
    await supabase.from('bookkeeping_books').update({
      vat_registered: current.vat_registered,
      vat_scheme: current.vat_scheme,
      flat_rate_percentage: current.flat_rate_percentage,
      vat_number: current.vat_number,
      updated_at: new Date().toISOString(),
    }).eq('id', params.id);
  }

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id, user_id: ctx.userId, entity_type: 'book', entity_id: params.id, action: 'create',
    diff: { kind: 'vat_status_change', effective_from: body.effective_from, vat_registered: body.vat_registered, vat_scheme: scheme, flat_rate_percentage: rate },
  }).then(() => {}, () => {});

  return NextResponse.json({ change: inserted });
}
