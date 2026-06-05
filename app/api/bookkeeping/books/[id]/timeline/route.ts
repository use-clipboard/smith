import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { VAT_SCHEME_LABEL, type VatScheme } from '@/types/bookkeeping';

// ── /api/bookkeeping/books/[id]/timeline ─────────────────────────────────────
// Aggregates the book's lifecycle events from several tables into a single,
// chronologically-sorted feed for the Timeline tab:
//   • book opening              (bookkeeping_books.created_at / created_by)
//   • imports / migrations      (bookkeeping_imports, status='posted')
//   • VAT status changes        (bookkeeping_vat_status_changes)
//   • VAT submissions           (bookkeeping_vat_returns, submitted_at set)
//   • year-end closes / reopens (bookkeeping_financial_years)

export type TimelineKind =
  | 'book_opened' | 'import' | 'vat_status_change'
  | 'vat_submission' | 'year_end_closed' | 'year_end_reopened';

export interface TimelineEvent {
  id: string;
  at: string;            // ISO date/timestamp the event happened
  kind: TimelineKind;
  title: string;
  description: string;
  userName: string | null;
}

type UserRef = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
function nameOf(u: UserRef): string | null {
  const r = Array.isArray(u) ? u[0] : u;
  return r ? (r.full_name ?? r.email ?? null) : null;
}
function uk(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return day && m && y ? `${day}/${m}/${y}` : d;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const bookId = params.id;

  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, name, created_at, creator:users!bookkeeping_books_created_by_fkey(full_name, email)')
    .eq('id', bookId).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const events: TimelineEvent[] = [];

  // 1) Book opened
  events.push({
    id: `book:${book.id}`,
    at: book.created_at,
    kind: 'book_opened',
    title: 'Book created',
    description: `“${book.name}” was opened.`,
    userName: nameOf(book.creator as UserRef),
  });

  // 2) Imports / migrations (posted only)
  const { data: imports } = await supabase
    .from('bookkeeping_imports')
    .select('id, file_name, summary, posted_at, created_at, uploader:users!bookkeeping_imports_uploaded_by_fkey(full_name, email)')
    .eq('book_id', bookId).eq('status', 'posted');
  for (const im of imports ?? []) {
    const s = (im.summary ?? {}) as { transactions?: number; rows?: number };
    const n = s.transactions ?? s.rows;
    events.push({
      id: `import:${im.id}`,
      at: im.posted_at ?? im.created_at,
      kind: 'import',
      title: 'Data imported',
      description: `Imported ${im.file_name}${n ? ` · ${n} transactions` : ''}.`,
      userName: nameOf(im.uploader as UserRef),
    });
  }

  // 3) VAT status changes
  const { data: vatChanges } = await supabase
    .from('bookkeeping_vat_status_changes')
    .select('id, effective_from, vat_registered, vat_scheme, flat_rate_percentage, vat_number, note, created_at, creator:users!bookkeeping_vat_status_changes_created_by_fkey(full_name, email)')
    .eq('book_id', bookId);
  for (const c of vatChanges ?? []) {
    const desc = c.vat_registered
      ? `VAT registered from ${uk(c.effective_from)} · ${VAT_SCHEME_LABEL[(c.vat_scheme ?? 'standard') as VatScheme] ?? c.vat_scheme}${c.vat_scheme === 'flat_rate' && c.flat_rate_percentage != null ? ` ${c.flat_rate_percentage}%` : ''}${c.vat_number ? ` · ${c.vat_number}` : ''}`
      : `De-registered for VAT from ${uk(c.effective_from)}`;
    events.push({
      id: `vatstatus:${c.id}`,
      at: c.created_at,
      kind: 'vat_status_change',
      title: 'VAT status changed',
      description: c.note ? `${desc} — ${c.note}` : desc,
      userName: nameOf(c.creator as UserRef),
    });
  }

  // 4) VAT submissions (filed)
  const { data: returns } = await supabase
    .from('bookkeeping_vat_returns')
    .select('id, ref_no, period_from, period_to, box5, submitted_at, submission_method, filed_at, filer:users!bookkeeping_vat_returns_filed_by_fkey(full_name, email)')
    .eq('book_id', bookId).not('submitted_at', 'is', null);
  for (const r of returns ?? []) {
    const via = r.submission_method === 'mtd_api' ? 'to HMRC (MTD)' : 'manually';
    events.push({
      id: `vatret:${r.id}`,
      at: r.submitted_at ?? r.filed_at,
      kind: 'vat_submission',
      title: 'VAT return submitted',
      description: `${r.ref_no ? `${r.ref_no} · ` : ''}${uk(r.period_from)}–${uk(r.period_to)} · £${Number(r.box5).toLocaleString('en-GB', { minimumFractionDigits: 2 })} due · filed ${via}.`,
      userName: nameOf(r.filer as UserRef),
    });
  }

  // 5) Year-end closes / reopens
  const { data: fys } = await supabase
    .from('bookkeeping_financial_years')
    .select('id, start_date, end_date, status, closed_at, reopened_at, reopen_reason, closer:users!bookkeeping_financial_years_closed_by_fkey(full_name, email), reopener:users!bookkeeping_financial_years_reopened_by_fkey(full_name, email)')
    .eq('book_id', bookId);
  for (const fy of fys ?? []) {
    const range = `${uk(fy.start_date)}–${uk(fy.end_date)}`;
    if (fy.closed_at) {
      events.push({
        id: `fyclose:${fy.id}`,
        at: fy.closed_at,
        kind: 'year_end_closed',
        title: 'Year-end closed',
        description: `Financial year ${range} was closed.`,
        userName: nameOf(fy.closer as UserRef),
      });
    }
    if (fy.reopened_at) {
      events.push({
        id: `fyreopen:${fy.id}`,
        at: fy.reopened_at,
        kind: 'year_end_reopened',
        title: 'Year-end reopened',
        description: `Financial year ${range} was reopened${fy.reopen_reason ? ` — ${fy.reopen_reason}` : ''}.`,
        userName: nameOf(fy.reopener as UserRef),
      });
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return NextResponse.json({ events });
}
