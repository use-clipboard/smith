-- ============================================================
--  VAT status history — time-varying VAT registration/scheme
-- ============================================================
--  Records each change to a book's VAT status with an effective date, so the
--  VAT-return calculation can resolve the status that applied for a period and
--  the timeline can show when things changed. The book's current vat_* columns
--  remain as the denormalised "latest" for convenience.
-- ============================================================

create table if not exists public.bookkeeping_vat_status_changes (
  id                   uuid primary key default gen_random_uuid(),
  book_id              uuid not null references public.bookkeeping_books(id) on delete cascade,
  effective_from       date not null,
  vat_registered       boolean not null,
  vat_scheme           text,            -- null when not registered
  flat_rate_percentage numeric(5,2),    -- only when scheme = flat_rate
  vat_number           text,
  note                 text,
  created_by           uuid references public.users(id),
  created_at           timestamptz not null default now()
);

create index if not exists bk_vat_status_changes_book_idx
  on public.bookkeeping_vat_status_changes (book_id, effective_from desc);

comment on table public.bookkeeping_vat_status_changes is
  'Effective-dated VAT status history per book (registration on/off, scheme, flat rate %, VRN). The compute resolves the status as-of a return period.';

alter table public.bookkeeping_vat_status_changes enable row level security;

create policy "vat_status_select_same_firm"
  on public.bookkeeping_vat_status_changes for select
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_vat_status_changes.book_id and b.firm_id = public.my_firm_id()
  ));

create policy "vat_status_modify_same_firm"
  on public.bookkeeping_vat_status_changes for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_vat_status_changes.book_id and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_vat_status_changes.book_id and b.firm_id = public.my_firm_id()
  ));
