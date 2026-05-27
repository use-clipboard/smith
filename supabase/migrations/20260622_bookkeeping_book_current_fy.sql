-- Bookkeeping — remember the currently-selected financial year on the book
--
-- Without this column, BookYearPeriodBar resets to "FY containing today" on
-- every page load. That's annoying for any user looking at a closed prior
-- year and means two people with the same book see different defaults if
-- one of them is in a different month.
--
-- We store the selection on the book itself (rather than per-user) so a
-- whole team that's working on, say, the 2025 year-end together stays on
-- the same year until someone explicitly switches it. Matches the "shared
-- workspace" feel of VT — when the partner picks a different year, the
-- whole staff sees it.
--
-- NULL means "no explicit choice — fall back to FY containing today" which
-- preserves the existing behaviour for brand-new books.

alter table public.bookkeeping_books
  add column if not exists current_fy_id uuid
    references public.bookkeeping_financial_years(id) on delete set null;

comment on column public.bookkeeping_books.current_fy_id is
  'Last-selected financial year for this book. Shared across all users so the team stays on the same year until someone changes it. NULL = use FY containing today.';
