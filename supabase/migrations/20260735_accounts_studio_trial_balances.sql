-- Accounts Studio — saved trial balances (per client, per year-end).
--
-- A reusable library of trial balances so a manually-entered / CSV TB isn't lost
-- and next year's comparatives can be pulled automatically. Every import
-- (bookkeeping, CSV, manual) snapshots its TB here keyed by client + period end,
-- so prior-year figures are available regardless of how each year was produced.

create table if not exists public.accounts_studio_trial_balances (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  period_end  date not null,
  source      text,                 -- 'bookkeeping' | 'manual' | 'clipboard'
  -- [{ name, type, ledger, debit, credit }]
  rows        jsonb not null default '[]',
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (firm_id, client_id, period_end)
);

create index if not exists accounts_studio_tb_client_idx
  on public.accounts_studio_trial_balances (firm_id, client_id, period_end desc);

comment on table public.accounts_studio_trial_balances is
  'Accounts Studio saved trial balances: one row per client per year-end (upserted on import). Enables reuse/edit of entered TBs and automatic prior-year comparatives.';

alter table public.accounts_studio_trial_balances enable row level security;

drop policy if exists "accounts_studio_tb: same firm" on public.accounts_studio_trial_balances;
create policy "accounts_studio_tb: same firm"
  on public.accounts_studio_trial_balances for all
  using (firm_id = public.my_firm_id())
  with check (firm_id = public.my_firm_id());
