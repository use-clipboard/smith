import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { seedBookCoa } from '@/lib/bookkeeping/seedCoa';
import { seedBookFunds } from '@/lib/bookkeeping/seedFunds';
import { parseYearEndMd, enumerateFys } from '@/lib/bookkeeping/financialYears';

const TEMPLATE_TYPES = ['basic','ltd','llp','partnership','self_employed','sole_trader','trust','charity'] as const;
const VAT_SCHEMES = ['standard','flat_rate','cash','annual','margin','partial_exemption'] as const;

const CreateBody = z.object({
  client_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  template_type: z.enum(TEMPLATE_TYPES),
  base_currency: z.string().min(3).max(3).default('GBP'),
  vat_registered: z.boolean().default(false),
  vat_scheme: z.enum(VAT_SCHEMES).nullable().optional(),
  vat_number: z.string().max(50).nullable().optional(),
  /** MM-DD year-end pattern, e.g. '03-31' for 31 March. Optional — when set,
   *  the create endpoint also generates the implied FY rows (see PATCH for
   *  the same logic; we inline a copy here to keep create idempotent). */
  year_end_md: z.string().regex(/^\d{2}-\d{2}$/).nullable().optional(),
  /** Explicit start of the first FY. Defaults to today when omitted. */
  first_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// ── GET /api/bookkeeping/books ───────────────────────────────────────────────
// Lists all books in the firm. Optional ?archived=true to include archived.
// Optional ?unallocated=true for client-less books only.
export async function GET(req: NextRequest) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get('archived') === 'true';
  const unallocatedOnly = url.searchParams.get('unallocated') === 'true';

  const supabase = createClient();
  let q = supabase
    .from('bookkeeping_books')
    .select(`
      id, firm_id, client_id, name, template_type, base_currency,
      vat_registered, vat_scheme, vat_number, period_lock_date, vat_lock_date,
      admin_locked, archived, created_by, created_at, updated_at,
      client:clients(id, name, client_ref),
      creator:users!bookkeeping_books_created_by_fkey(id, full_name, email)
    `)
    .eq('firm_id', ctx.firmId)
    .order('updated_at', { ascending: false });

  if (!includeArchived) q = q.eq('archived', false);
  if (unallocatedOnly)  q = q.is('client_id', null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ books: data ?? [] });
}

// ── POST /api/bookkeeping/books ──────────────────────────────────────────────
// Creates a new book. Anyone with bookkeeping access can create.
export async function POST(req: NextRequest) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // VAT scheme must be set when registered; null it out when not registered
  if (body.vat_registered && !body.vat_scheme) {
    return NextResponse.json({ error: 'VAT scheme is required when VAT registered' }, { status: 400 });
  }
  const vatScheme = body.vat_registered ? body.vat_scheme ?? null : null;
  const vatNumber = body.vat_registered ? (body.vat_number ?? null) : null;

  // Year-end pattern is optional at create time. When set, we also stamp
  // the first-period anchor so the FY generator below has somewhere to begin.
  const yearEndMd = body.year_end_md && parseYearEndMd(body.year_end_md) ? body.year_end_md : null;
  const firstPeriodStart = yearEndMd ? (body.first_period_start ?? new Date().toISOString().slice(0, 10)) : null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('bookkeeping_books')
    .insert({
      firm_id: ctx.firmId,
      client_id: body.client_id ?? null,
      name: body.name.trim(),
      template_type: body.template_type,
      base_currency: body.base_currency.toUpperCase(),
      vat_registered: body.vat_registered,
      vat_scheme: vatScheme,
      vat_number: vatNumber,
      year_end_md: yearEndMd,
      first_period_start: firstPeriodStart,
      created_by: ctx.userId,
    })
    .select(`
      id, firm_id, client_id, name, template_type, base_currency,
      vat_registered, vat_scheme, vat_number, period_lock_date, vat_lock_date,
      year_end_md, first_period_start, retained_earnings_account_id,
      admin_locked, archived, created_by, created_at, updated_at,
      client:clients(id, name, client_ref),
      creator:users!bookkeeping_books_created_by_fkey(id, full_name, email)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit: book created
  await supabase.from('bookkeeping_audit').insert({
    book_id: data.id,
    user_id: ctx.userId,
    entity_type: 'book',
    entity_id: data.id,
    action: 'create',
    diff: { name: data.name, template_type: data.template_type, client_id: data.client_id },
  });

  // Seed the Chart of Accounts from the template default (Ltd shipped in
  // Phase 2A; other templates land as their VT defaults are added). Failures
  // here don't roll back the book — the user can manually add accounts. We
  // log the seed result in the audit trail.
  try {
    const seedResult = await seedBookCoa(supabase, data.id, data.template_type, {
      vatRegistered: data.vat_registered,
    });
    if (seedResult.inserted > 0 || seedResult.vat_skipped > 0) {
      await supabase.from('bookkeeping_audit').insert({
        book_id: data.id,
        user_id: ctx.userId,
        entity_type: 'coa_template',
        entity_id: data.id,
        action: 'create',
        diff: { seeded: seedResult },
      });
    }
  } catch (seedError) {
    console.error('[bookkeeping] COA seed failed for book', data.id, seedError);
  }

  // Charity books get a default "General" unrestricted fund so fund accounting
  // works out of the box. Restricted / endowment funds are added by the user.
  if (data.template_type === 'charity') {
    try {
      await seedBookFunds(supabase, data.id, ctx.userId);
    } catch (fundError) {
      console.error('[bookkeeping] Fund seed failed for book', data.id, fundError);
    }
  }

  // Generate the implied financial-year rows when a year-end was supplied.
  // We use the helper here too so create + patch share the exact same logic.
  if (yearEndMd && firstPeriodStart) {
    const pattern = parseYearEndMd(yearEndMd)!;
    const oneYearForward = new Date();
    oneYearForward.setUTCFullYear(oneYearForward.getUTCFullYear() + 1);
    const desired = enumerateFys(pattern, firstPeriodStart, oneYearForward.toISOString().slice(0, 10));
    if (desired.length > 0) {
      await supabase.from('bookkeeping_financial_years').insert(
        desired.map(r => ({
          book_id: data.id,
          start_date: r.start,
          end_date:   r.end,
          status: 'open' as const,
        })),
      );
    }
  }

  return NextResponse.json({ book: data });
}
