import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

const VAT_TREATMENTS = ['no_vat','standard_20','reduced_5','zero','exempt','outside_scope'] as const;

const SplitSchema = z.object({
  account_id: z.string().uuid(),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  entry_details: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).refine(s => s.debit === 0 || s.credit === 0, {
  message: 'A split cannot be both a debit and a credit',
});

const PatchBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payee_text: z.string().max(200).nullable().optional(),
  details: z.string().max(500).nullable().optional(),
  total: z.number().min(0).optional(),
  vat_total: z.number().min(0).optional(),
  vat_rate: z.number().min(0).max(100).nullable().optional(),
  vat_treatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  primary_account_id: z.string().uuid().nullable().optional(),
  splits: z.array(SplitSchema).min(1).optional(),
  /** Late-entry flag — same semantics as POST. The user has acknowledged the
   *  edited date lands in a filed VAT period and wants the VAT carried into
   *  the next return. */
  late_entry: z.boolean().optional(),
});

/** Add one day to a YYYY-MM-DD string. */
function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const TX_SELECT = `
  id, book_id, type, ref_no, ref_seq, date, payee_text, details,
  total, vat_total, vat_rate, vat_treatment, vat_period_override,
  primary_account_id, status, created_by, created_at, updated_at, posted_at,
  primary_account:bookkeeping_accounts!bookkeeping_transactions_primary_account_id_fkey(id, name, ledger, account_type),
  splits:bookkeeping_transaction_splits(
    id, transaction_id, line_no, account_id, debit, credit, entry_details, notes,
    account:bookkeeping_accounts(id, name, ledger, account_type)
  )
`;

// ── GET single transaction ───────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string; txId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_transactions')
    .select(TX_SELECT)
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ transaction: data });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
// Header fields can be edited; splits are replaced wholesale when provided
// (simpler than diffing — splits are small per transaction).
// Does NOT change ref_no — once allocated, refs are immutable (audit trail).
export async function PATCH(req: NextRequest, { params }: { params: { id: string; txId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, period_lock_date, vat_lock_date, vat_registered')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data: existing, error: exErr } = await supabase
    .from('bookkeeping_transactions')
    .select('id, date, vat_total, vat_period_override')
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Period lock blocks edits to/from a locked date.
  if (book.period_lock_date && !isAdmin) {
    const oldDate = existing.date;
    const newDate = body.date ?? oldDate;
    if (oldDate <= book.period_lock_date || newDate <= book.period_lock_date) {
      return NextResponse.json(
        { error: `Period locked through ${book.period_lock_date}` },
        { status: 403 },
      );
    }
  }

  // ── VAT late-entry handling on edit ──────────────────────────────────────
  // If the new (or unchanged) date is in a filed VAT period AND the
  // transaction carries VAT, we treat it the same as a new post: require the
  // user to acknowledge the late-entry flag. Otherwise we clear the override.
  const newDate = body.date ?? existing.date;
  const newVatTotal = body.vat_total ?? Number(existing.vat_total ?? 0);
  const carriesVat = newVatTotal > 0;
  let vatPeriodOverride: string | null | undefined = undefined; // undefined = don't change
  if (book.vat_registered && book.vat_lock_date) {
    if (newDate <= book.vat_lock_date && carriesVat) {
      if (!body.late_entry) {
        return NextResponse.json(
          {
            error: 'late_entry_required',
            message: `${newDate} falls in a filed VAT period (locked through ${book.vat_lock_date}). Tick "Include in next VAT return" to save as a late entry.`,
            vat_lock_date: book.vat_lock_date,
          },
          { status: 409 },
        );
      }
      vatPeriodOverride = addOneDay(book.vat_lock_date);
    } else {
      // Date is no longer in the locked period → clear any prior override.
      vatPeriodOverride = null;
    }
  }

  // Validate split balance if splits are being replaced.
  if (body.splits) {
    const totalDr = body.splits.reduce((s, x) => s + x.debit, 0);
    const totalCr = body.splits.reduce((s, x) => s + x.credit, 0);
    if (Math.abs(totalDr - totalCr) > 0.005) {
      return NextResponse.json(
        { error: `Out of balance: Dr ${totalDr.toFixed(2)} vs Cr ${totalCr.toFixed(2)}` },
        { status: 400 },
      );
    }
  }

  // Header patch
  const patch: Record<string, unknown> = {};
  if (body.date !== undefined)               patch.date = body.date;
  if (body.payee_text !== undefined)         patch.payee_text = body.payee_text;
  if (body.details !== undefined)            patch.details = body.details;
  if (body.total !== undefined)              patch.total = body.total;
  if (body.vat_total !== undefined)          patch.vat_total = body.vat_total;
  if (body.vat_rate !== undefined)           patch.vat_rate = body.vat_rate;
  if (body.vat_treatment !== undefined)      patch.vat_treatment = body.vat_treatment;
  if (body.primary_account_id !== undefined) patch.primary_account_id = body.primary_account_id;
  if (vatPeriodOverride !== undefined)       patch.vat_period_override = vatPeriodOverride;
  patch.updated_at = new Date().toISOString();

  const { error: updErr } = await supabase
    .from('bookkeeping_transactions')
    .update(patch)
    .eq('id', params.txId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Replace splits wholesale if provided
  if (body.splits) {
    const { error: delErr } = await supabase
      .from('bookkeeping_transaction_splits')
      .delete()
      .eq('transaction_id', params.txId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    const newRows = body.splits.map((s, i) => ({
      transaction_id: params.txId,
      line_no: i + 1,
      account_id: s.account_id,
      debit: s.debit,
      credit: s.credit,
      entry_details: s.entry_details ?? null,
      notes: s.notes ?? null,
    }));
    const { error: insErr } = await supabase
      .from('bookkeeping_transaction_splits')
      .insert(newRows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Audit
  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: params.txId,
    action: 'update',
    diff: body,
  });

  const { data: full, error: refetchErr } = await supabase
    .from('bookkeeping_transactions')
    .select(TX_SELECT)
    .eq('id', params.txId)
    .single();
  if (refetchErr) return NextResponse.json({ error: refetchErr.message }, { status: 500 });

  return NextResponse.json({ transaction: full });
}

// ── DELETE ───────────────────────────────────────────────────────────────────
// Hard delete (cascades to splits). ref_seq is NEVER decremented — the gap
// in the sequence is the audit trail.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; txId: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, period_lock_date')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = ctx.userRole === 'admin';
  if (book.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data: existing, error: exErr } = await supabase
    .from('bookkeeping_transactions')
    .select('id, date, type, ref_no')
    .eq('id', params.txId)
    .eq('book_id', params.id)
    .single();
  if (exErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (book.period_lock_date && existing.date <= book.period_lock_date && !isAdmin) {
    return NextResponse.json(
      { error: `Period locked through ${book.period_lock_date}` },
      { status: 403 },
    );
  }

  const { error: delErr } = await supabase
    .from('bookkeeping_transactions')
    .delete()
    .eq('id', params.txId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'transaction',
    entity_id: params.txId,
    action: 'delete',
    diff: { type: existing.type, ref_no: existing.ref_no, date: existing.date },
  });

  return NextResponse.json({ ok: true });
}
