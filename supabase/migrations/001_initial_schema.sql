-- ============================================================
-- Agent Smith — Initial Schema Migration
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Firms
create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subscription_tier text not null default 'internal',
  created_at timestamptz not null default now()
);

-- Users (extends Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users on delete cascade,
  firm_id uuid references public.firms on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

-- Clients
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms on delete cascade,
  name text not null,
  client_ref text,
  business_type text,
  contact_email text,
  risk_rating text,
  created_at timestamptz not null default now()
);

-- Documents (metadata only — files stored in Google Drive)
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  uploaded_by uuid references public.users on delete set null,
  file_name text not null,
  drive_file_id text,
  file_url text,
  document_type text,
  created_at timestamptz not null default now()
);

-- AI Outputs (one row per job run)
create table public.outputs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients on delete cascade,
  user_id uuid references public.users on delete set null,
  feature text not null,
  target_software text,
  result_data jsonb,
  created_at timestamptz not null default now()
);

-- AI Usage Log
create table public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users on delete set null,
  client_id uuid references public.clients on delete set null,
  feature text not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

-- Chat Messages (Ask Smith)
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users on delete cascade,
  client_id uuid references public.clients on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.firms enable row level security;
alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.documents enable row level security;
alter table public.outputs enable row level security;
alter table public.ai_logs enable row level security;
alter table public.chat_messages enable row level security;

-- Helper: get the firm_id of the currently authenticated user
create or replace function public.my_firm_id()
returns uuid
language sql stable
as $$
  select firm_id from public.users where id = auth.uid()
$$;

-- firms: users can only see their own firm
create policy "firms: own firm only"
  on public.firms for all
  using (id = public.my_firm_id());

-- users: users can see others in the same firm
create policy "users: same firm"
  on public.users for all
  using (firm_id = public.my_firm_id());

-- clients: same firm
create policy "clients: same firm"
  on public.clients for all
  using (firm_id = public.my_firm_id());

-- documents: via client's firm
create policy "documents: same firm"
  on public.documents for all
  using (
    exists (
      select 1 from public.clients c
      where c.id = client_id
      and c.firm_id = public.my_firm_id()
    )
  );

-- outputs: via client's firm
create policy "outputs: same firm"
  on public.outputs for all
  using (
    client_id is null
    or exists (
      select 1 from public.clients c
      where c.id = client_id
      and c.firm_id = public.my_firm_id()
    )
  );

-- ai_logs: own logs only
create policy "ai_logs: own firm"
  on public.ai_logs for all
  using (user_id = auth.uid());

-- chat_messages: own messages only
create policy "chat_messages: own messages"
  on public.chat_messages for all
  using (user_id = auth.uid());

-- ============================================================
-- Auto-create user profile on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
