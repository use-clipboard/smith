-- ============================================================
--  Bookkeeping — Fixed asset depreciation & amortisation
-- ============================================================
--  Adds a per-asset register layered on top of the existing
--  FA ledgers (FA - vehicles, FA - plant and machinery, …) plus
--  the rate/method settings and posted-charge history that drive
--  the depreciation engine.
--
--  Model:
--    • Rate + method are set PER FA LEDGER (asset category), not
--      per asset, and are effective-dated — a ledger holds a small
--      history of (effective_from, method, annual_rate) rows.
--    • An asset is either an `addition` (linked to the Cost-additions
--      split that booked it — cost & date come from that split) or a
--      `brought_forward` row (itemised opening assets still being
--      depreciated; cost/date/opening accumulated depn entered by hand
--      and reconciled — warn-only — against the ledger b/fwd balances).
--    • Each posted depreciation run writes one charge row per asset per
--      period (idempotent), linked to the single per-ledger journal it
--      was part of. NBV = cost − (opening_accumulated_depn + Σ charges).
--
--  Locking / posting rules live at the API layer, as elsewhere.
-- ============================================================

-- ── Per-ledger, effective-dated depreciation settings ──────────────────────
create table if not exists public.bookkeeping_ledger_depreciation_settings (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.bookkeeping_books(id) on delete cascade,

  /** The FA ledger this rate applies to, e.g. 'FA - vehicles'. Matches
      bookkeeping_accounts.ledger. */
  ledger        text not null,

  /** The setting takes effect for charges dated on/after this date. The
      row with the latest effective_from <= a given date is the one in force.
      A mid-period change splits the period at this boundary in the engine. */
  effective_from date not null,

  method        text not null
                check (method in ('straight_line', 'reducing_balance')),

  /** Annual rate as a percentage, e.g. 25.000 for 25%. */
  annual_rate   numeric(6,3) not null check (annual_rate >= 0 and annual_rate <= 100),

  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),

  /** One setting per ledger per effective date. */
  unique (book_id, ledger, effective_from)
);

create index if not exists bookkeeping_ledger_depn_settings_idx
  on public.bookkeeping_ledger_depreciation_settings (book_id, ledger, effective_from);

comment on table public.bookkeeping_ledger_depreciation_settings is
  'Effective-dated depreciation rate/method per FA ledger (asset category). Latest effective_from <= the charge date is in force; mid-period changes are segmented by the engine. Changes are prospective — they never restate already-posted periods.';

alter table public.bookkeeping_ledger_depreciation_settings enable row level security;

create policy "depn_settings: same firm via book"
  on public.bookkeeping_ledger_depreciation_settings for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_ledger_depreciation_settings.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_ledger_depreciation_settings.book_id
      and b.firm_id = public.my_firm_id()
  ));


-- ── The asset register ─────────────────────────────────────────────────────
create table if not exists public.bookkeeping_assets (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.bookkeeping_books(id) on delete cascade,

  /** FA ledger this asset belongs to. Drives which rate/method applies. */
  ledger        text not null,

  /** 'addition'        — booked via a Cost-additions posting this/another period.
      'brought_forward' — itemised opening asset captured at first use. */
  source        text not null check (source in ('addition', 'brought_forward')),

  /** For additions: the Cost-additions split that booked this asset. Cost and
      purchase_date mirror that split. NULL for brought-forward rows. When the
      split is deleted the asset row goes with it. */
  split_id      uuid references public.bookkeeping_transaction_splits(id) on delete cascade,

  description   text not null,
  purchase_date date not null,
  cost          numeric(15,2) not null check (cost >= 0),

  /** Accumulated depreciation already charged before this register existed.
      Only meaningful for brought_forward rows; additions start at 0. */
  opening_accumulated_depn numeric(15,2) not null default 0 check (opening_accumulated_depn >= 0),

  /** Disposal. When set, the engine charges depreciation up to disposal_date
      then stops; the asset stays on the schedule as disposed. */
  status            text not null default 'active' check (status in ('active', 'disposed')),
  disposal_date     date,
  disposal_proceeds numeric(15,2),
  disposal_journal_id uuid references public.bookkeeping_transactions(id) on delete set null,

  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  /** One asset per cost split (additions can't be registered twice). */
  unique (split_id)
);

create index if not exists bookkeeping_assets_book_ledger_idx
  on public.bookkeeping_assets (book_id, ledger, status);
create index if not exists bookkeeping_assets_split_idx
  on public.bookkeeping_assets (split_id) where split_id is not null;

comment on table public.bookkeeping_assets is
  'Per-asset fixed-asset register. additions link to the Cost-additions split that booked them; brought_forward rows are itemised opening assets. Rate/method come from bookkeeping_ledger_depreciation_settings for the asset''s ledger. NBV = cost − (opening_accumulated_depn + posted charges).';

alter table public.bookkeeping_assets enable row level security;

create policy "assets: same firm via book"
  on public.bookkeeping_assets for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_assets.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_assets.book_id
      and b.firm_id = public.my_firm_id()
  ));


-- ── Posted depreciation charge history ─────────────────────────────────────
create table if not exists public.bookkeeping_depreciation_charges (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.bookkeeping_books(id) on delete cascade,
  asset_id      uuid not null references public.bookkeeping_assets(id) on delete cascade,

  /** Inclusive period this charge covers. */
  period_from   date not null,
  period_to     date not null,

  amount        numeric(15,2) not null check (amount >= 0),

  /** The per-ledger depreciation journal this charge was posted as part of.
      NULL only transiently / if that journal was later deleted. */
  journal_txn_id uuid references public.bookkeeping_transactions(id) on delete set null,

  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),

  /** Idempotency: one posted charge per asset per period. Re-running a period
      that's already posted is a no-op. */
  unique (asset_id, period_from, period_to)
);

create index if not exists bookkeeping_depn_charges_book_idx
  on public.bookkeeping_depreciation_charges (book_id, period_to);
create index if not exists bookkeeping_depn_charges_asset_idx
  on public.bookkeeping_depreciation_charges (asset_id, period_to);
create index if not exists bookkeeping_depn_charges_journal_idx
  on public.bookkeeping_depreciation_charges (journal_txn_id) where journal_txn_id is not null;

comment on table public.bookkeeping_depreciation_charges is
  'One row per asset per posted depreciation period. Drives NBV, reducing-balance continuity and the per-journal audit breakdown. Unique on (asset, period) makes re-posting idempotent.';

alter table public.bookkeeping_depreciation_charges enable row level security;

create policy "depn_charges: same firm via book"
  on public.bookkeeping_depreciation_charges for all
  using (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_depreciation_charges.book_id
      and b.firm_id = public.my_firm_id()
  ))
  with check (exists (
    select 1 from public.bookkeeping_books b
    where b.id = bookkeeping_depreciation_charges.book_id
      and b.firm_id = public.my_firm_id()
  ));


-- ── Realtime ───────────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.bookkeeping_ledger_depreciation_settings;
  alter publication supabase_realtime add table public.bookkeeping_assets;
  alter publication supabase_realtime add table public.bookkeeping_depreciation_charges;
exception
  when others then null;
end $$;
