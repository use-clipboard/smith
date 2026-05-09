-- Add firm_id and metadata columns to outputs so the Full Analysis history dashboard
-- can list & filter without parsing result_data on every row.

alter table public.outputs
  add column if not exists firm_id uuid references public.firms on delete cascade,
  add column if not exists client_name text,
  add column if not exists transaction_count int,
  add column if not exists source_filenames text[];

-- Backfill firm_id from client_id where possible
update public.outputs o
set firm_id = c.firm_id
from public.clients c
where o.client_id = c.id and o.firm_id is null;

create index if not exists outputs_firm_feature_created_idx
  on public.outputs (firm_id, feature, created_at desc);

create index if not exists outputs_user_idx
  on public.outputs (user_id);

-- Replace RLS so listing is firm-scoped via firm_id (not just via client)
drop policy if exists "outputs: same firm" on public.outputs;

create policy "outputs: same firm"
  on public.outputs for all
  using (
    firm_id = public.my_firm_id()
    or (
      firm_id is null and (
        client_id is null
        or exists (
          select 1 from public.clients c
          where c.id = client_id and c.firm_id = public.my_firm_id()
        )
      )
    )
  );
