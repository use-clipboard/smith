import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { seedBookCoa } from '@/lib/bookkeeping/seedCoa';
import { parseYearEndMd, enumerateFys } from '@/lib/bookkeeping/financialYears';
import type { BookTemplateType } from '@/types/bookkeeping';

const VAT_SCHEMES = ['standard','flat_rate','cash','annual','margin','partial_exemption'] as const;

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  client_id: z.string().uuid().nullable().optional(),
  base_currency: z.string().min(3).max(3).optional(),
  vat_registered: z.boolean().optional(),
  vat_scheme: z.enum(VAT_SCHEMES).nullable().optional(),
  vat_number: z.string().max(50).nullable().optional(),
  admin_locked: z.boolean().optional(),
  archived: z.boolean().optional(),
  period_lock_date: z.string().nullable().optional(),
  /** MM-DD year-end pattern. When set/changed, the API generates missing FY
   *  rows in `bookkeeping_financial_years` (no-op once they're already
   *  there). The first FY starts at `first_period_start` (if already set)
   *  or at the body's `first_period_start` value, or — as a last resort —
   *  the earliest existing transaction date / today. */
  year_end_md: z.string().regex(/^\d{2}-\d{2}$/, 'year_end_md must be MM-DD').nullable().optional(),
  first_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  retained_earnings_account_id: z.string().uuid().nullable().optional(),
  // Currently-selected FY — persisted on the book so the whole team sees the
  // same default until someone changes it. Driven by BookYearPeriodBar.
  current_fy_id: z.string().uuid().nullable().optional(),
});

const BOOK_SELECT = `
  id, firm_id, client_id, name, template_type, base_currency,
  vat_registered, vat_scheme, vat_number, period_lock_date, vat_lock_date,
  year_end_md, first_period_start, retained_earnings_account_id, current_fy_id,
  admin_locked, archived, created_by, created_at, updated_at,
  client:clients(id, name, client_ref),
  creator:users!bookkeeping_books_created_by_fkey(id, full_name, email)
`;

// ── GET /api/bookkeeping/books/[id] ──────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('bookkeeping_books')
    .select(BOOK_SELECT)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ book: data });
}

// ── PATCH /api/bookkeeping/books/[id] ────────────────────────────────────────
// Updates allowed fields. admin_locked and period_lock_date are admin-only.
// Writes one audit row per call, diff = the patch payload.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  // Pull the existing row to enforce admin-only fields + admin-lock writes
  // (also need vat_registered + template_type for the back-fill check below)
  const { data: existing, error: loadErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked, vat_registered, template_type, year_end_md, first_period_start')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (loadErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Year-end is locked once any FY has been closed — that audit chain is
  // immutable and changing the pattern under it would silently break old
  // year boundaries.
  if (body.year_end_md !== undefined && body.year_end_md !== existing.year_end_md) {
    const { data: closedFy } = await supabase
      .from('bookkeeping_financial_years')
      .select('id')
      .eq('book_id', params.id)
      .eq('status', 'closed')
      .limit(1)
      .maybeSingle();
    if (closedFy) {
      return NextResponse.json({
        error: 'year_end_locked',
        message: 'Year-end can’t be changed once a financial year has been closed.',
      }, { status: 409 });
    }
  }

  const isAdmin = ctx.userRole === 'admin';
  if ((body.admin_locked !== undefined || body.period_lock_date !== undefined) && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can change lock or period-lock' }, { status: 403 });
  }
  // If the book is admin-locked and the caller isn't an admin, block all writes
  if (existing.admin_locked && !isAdmin) {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined)             patch.name = body.name.trim();
  if (body.client_id !== undefined)        patch.client_id = body.client_id;
  if (body.base_currency !== undefined)    patch.base_currency = body.base_currency.toUpperCase();
  if (body.vat_registered !== undefined)   patch.vat_registered = body.vat_registered;
  if (body.vat_scheme !== undefined)       patch.vat_scheme = body.vat_scheme;
  if (body.vat_number !== undefined)       patch.vat_number = body.vat_number;
  if (body.admin_locked !== undefined)     patch.admin_locked = body.admin_locked;
  if (body.archived !== undefined)         patch.archived = body.archived;
  if (body.period_lock_date !== undefined) patch.period_lock_date = body.period_lock_date;
  if (body.year_end_md !== undefined)      patch.year_end_md = body.year_end_md;
  if (body.first_period_start !== undefined) patch.first_period_start = body.first_period_start;
  if (body.retained_earnings_account_id !== undefined) patch.retained_earnings_account_id = body.retained_earnings_account_id;
  if (body.current_fy_id !== undefined) patch.current_fy_id = body.current_fy_id;

  // Normalise: when VAT is being turned off, clear scheme + number
  if (patch.vat_registered === false) {
    patch.vat_scheme = null;
    patch.vat_number = null;
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('bookkeeping_books')
    .update(patch)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select(BOOK_SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit: pick the right action for the most material change so the History
  // view doesn't drown in noise. Lock/unlock/archive get their own action.
  let action: 'update' | 'lock' | 'unlock' | 'archive' | 'unarchive' = 'update';
  if (body.admin_locked === true)  action = 'lock';
  if (body.admin_locked === false) action = 'unlock';
  if (body.archived === true)      action = 'archive';
  if (body.archived === false)     action = 'unarchive';

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'book',
    entity_id: params.id,
    action,
    diff: body,
  });

  // ── Generate financial-year rows when the year-end is set or changed ──
  // Only runs when there are no closed FYs (guarded earlier). The
  // first-period start is derived in priority order:
  //   1. The body's explicit `first_period_start` (if the user picked one)
  //   2. The book's existing `first_period_start` column
  //   3. The earliest existing transaction date
  //   4. Today's date (fresh book)
  if (body.year_end_md !== undefined && body.year_end_md !== null) {
    const pattern = parseYearEndMd(body.year_end_md);
    if (pattern) {
      // Wipe any pre-existing open FY rows for this book so we don't double
      // up after a year-end change. Closed FYs already block this codepath.
      await supabase
        .from('bookkeeping_financial_years')
        .delete()
        .eq('book_id', params.id)
        .eq('status', 'open');

      // Resolve first-period start.
      let firstStart =
        (body.first_period_start as string | null | undefined) ||
        (existing.first_period_start as string | null) ||
        null;
      if (!firstStart) {
        const { data: firstTxn } = await supabase
          .from('bookkeeping_transactions')
          .select('date')
          .eq('book_id', params.id)
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle();
        firstStart = firstTxn?.date ?? new Date().toISOString().slice(0, 10);
      }

      // Stamp the first-period anchor onto the book so future generations
      // are deterministic.
      await supabase
        .from('bookkeeping_books')
        .update({ first_period_start: firstStart })
        .eq('id', params.id);

      // Generate FYs through one year past today (so forward-looking budget
      // views have something to bind against).
      const oneYearForward = new Date();
      oneYearForward.setUTCFullYear(oneYearForward.getUTCFullYear() + 1);
      const throughIso = oneYearForward.toISOString().slice(0, 10);

      const desired = enumerateFys(pattern, firstStart, throughIso);
      if (desired.length > 0) {
        await supabase
          .from('bookkeeping_financial_years')
          .insert(desired.map(r => ({
            book_id: params.id,
            start_date: r.start,
            end_date:   r.end,
            status: 'open' as const,
          })));
      }
    }
  }

  // VAT back-fill: when a book is flipped from non-VAT to VAT-registered,
  // seed the missing VAT accounts. seedBookCoa is idempotent — it only inserts
  // accounts that don't already exist, so this won't duplicate anything.
  if (body.vat_registered === true && existing.vat_registered === false) {
    try {
      const seedResult = await seedBookCoa(
        supabase,
        params.id,
        existing.template_type as BookTemplateType,
        { vatRegistered: true },
      );
      if (seedResult.inserted > 0) {
        await supabase.from('bookkeeping_audit').insert({
          book_id: params.id,
          user_id: ctx.userId,
          entity_type: 'coa_template',
          entity_id: params.id,
          action: 'update',
          diff: { vat_backfill: seedResult },
        });
      }
    } catch (seedError) {
      console.error('[bookkeeping] VAT back-fill failed for book', params.id, seedError);
    }
  }

  return NextResponse.json({ book: data });
}

// ── DELETE /api/bookkeeping/books/[id] ───────────────────────────────────────
// Soft-delete via archived = true. Hard delete is intentionally not exposed in
// Phase 1 — financial data should never disappear without an admin path.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only admins can archive a book' }, { status: 403 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('bookkeeping_books')
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'book',
    entity_id: params.id,
    action: 'archive',
    diff: { archived: true },
  });

  return NextResponse.json({ ok: true });
}
