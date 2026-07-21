-- MTD IT — brought-forward unrelieved residential finance costs.
--
-- Residential finance costs (mortgage/loan interest on residential lets) are
-- restricted under ITTOIA s.272A: not deductible, relieved instead as a 20%
-- basic-rate tax reducer. Where a year's profit is too low to absorb the
-- reducer, the unrelieved amount is CARRIED FORWARD and treated as a finance
-- cost of the following year.
--
-- That brought-forward figure comes from the PRIOR year's tax computation (Final
-- Declaration), which this tool doesn't yet produce — so the accountant enters
-- it manually, once per tax year, per property business (UK vs foreign). It's
-- reported to HMRC alongside the current-period residential finance cost
-- (`residentialFinancialCostsCarriedForward` for UK / `broughtFwdResidential-
-- FinancialCost` for foreign).

create table if not exists public.mtd_it_finance_bf (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null references public.clients(id) on delete cascade,

  -- Our int tax year (2026 = 2026/27).
  tax_year int not null,

  -- Which property business the b/f belongs to.
  stream text not null check (stream in ('uk_rental', 'foreign_rental')),

  -- Brought-forward unrelieved residential finance cost, in GBP.
  amount numeric(14,2) not null default 0 check (amount >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One figure per client / tax year / business.
  unique (client_id, tax_year, stream)
);

create index if not exists idx_mtd_it_finance_bf_client
  on public.mtd_it_finance_bf(client_id, tax_year);

alter table public.mtd_it_finance_bf enable row level security;

-- Members of the firm that owns the client can read + write.
create policy "mtd_it_finance_bf firm read"
  on public.mtd_it_finance_bf for select
  using (
    client_id in (
      select c.id from public.clients c
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  );

create policy "mtd_it_finance_bf firm write"
  on public.mtd_it_finance_bf for all
  using (
    client_id in (
      select c.id from public.clients c
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  )
  with check (
    client_id in (
      select c.id from public.clients c
      where c.firm_id in (select firm_id from public.users where id = auth.uid())
    )
  );
