-- Client overview redesign: an account manager (a staff member who owns the
-- relationship) and a contact number, both shown on the new client header.
-- Everything else the Overview needs already exists (client fields, tasks,
-- outputs, timeline notes, client_links).

alter table public.clients add column if not exists account_manager_id uuid references public.users(id) on delete set null;
alter table public.clients add column if not exists contact_number text;

create index if not exists clients_account_manager_idx on public.clients (account_manager_id);
