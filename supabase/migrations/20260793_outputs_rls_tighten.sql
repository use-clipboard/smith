-- Security fix (pen-test remediation): tighten the outputs RLS policy.
--
-- The previous "outputs: same firm" policy (20260509) granted access to ANY
-- authenticated user for rows where BOTH firm_id IS NULL AND client_id IS NULL —
-- so an orphan output row was cross-tenant readable/deletable by id. Remove that
-- branch. A row is now visible only when:
--   • it belongs to the caller's firm (firm_id = my_firm_id()), or
--   • (legacy rows created before firm_id backfill) it has a client_id whose
--     client belongs to the caller's firm.
-- App routes were also updated to add explicit firm_id scoping as defence-in-depth.

drop policy if exists "outputs: same firm" on public.outputs;

create policy "outputs: same firm"
  on public.outputs for all
  using (
    firm_id = public.my_firm_id()
    or (
      firm_id is null
      and client_id is not null
      and exists (
        select 1 from public.clients c
        where c.id = client_id and c.firm_id = public.my_firm_id()
      )
    )
  );
