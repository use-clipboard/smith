-- Document Vault tables
-- Run this migration in the Supabase SQL editor

-- vault_documents: one row per document indexed from Google Drive
create table if not exists vault_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  client_id uuid references clients(id) on delete set null,

  -- Google Drive metadata (nullable — agent_smith_tool documents have no Drive file)
  google_drive_file_id text,
  google_drive_url text,
  file_name text not null,
  file_mime_type text,
  file_size_bytes bigint,
  google_drive_folder_path text,

  -- AI-extracted tags
  tag_supplier_name text,
  tag_client_code text,
  tag_client_name text,
  tag_document_date date,
  tag_amount numeric,
  tag_currency text default 'GBP',
  tag_document_type text,
  tag_tax_year text,
  tag_accounting_period text,
  tag_hmrc_reference text,
  tag_vat_number text,
  tag_additional jsonb,
  tag_summary text,
  tag_confidence text,
  tags_array text[],

  -- Status
  tagging_status text default 'untagged'
    check (tagging_status in ('untagged','pending','tagged','failed','manually_reviewed')),
  tagging_error text,
  manually_edited boolean default false,

  -- Source tracking
  source text default 'google_drive'
    check (source in ('google_drive','agent_smith_tool')),
  source_tool text,

  -- Timestamps
  drive_created_at timestamptz,
  drive_modified_at timestamptz,
  indexed_at timestamptz default now(),
  tagged_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- vault_sync_state: one row per user tracking last sync
create table if not exists vault_sync_state (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('success','partial','failed')),
  total_files_indexed int default 0,
  last_page_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (firm_id, user_id)
);

-- Enable RLS
alter table vault_documents enable row level security;
alter table vault_sync_state enable row level security;

-- RLS policies: users can only access data for their own firm
create policy "vault_documents_firm_select"
  on vault_documents for select
  using (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "vault_documents_firm_insert"
  on vault_documents for insert
  with check (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "vault_documents_firm_update"
  on vault_documents for update
  using (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "vault_documents_firm_delete"
  on vault_documents for delete
  using (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "vault_sync_state_firm_select"
  on vault_sync_state for select
  using (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "vault_sync_state_firm_insert"
  on vault_sync_state for insert
  with check (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

create policy "vault_sync_state_firm_update"
  on vault_sync_state for update
  using (
    firm_id = (
      select firm_id from users where id = auth.uid()
    )
  );

-- Service role bypass (for server-side operations that use service key)
create policy "vault_documents_service_all"
  on vault_documents for all
  using (auth.role() = 'service_role');

create policy "vault_sync_state_service_all"
  on vault_sync_state for all
  using (auth.role() = 'service_role');

-- Index for common query patterns
create index if not exists vault_docs_firm_id on vault_documents(firm_id);
create index if not exists vault_docs_client_id on vault_documents(client_id);
create index if not exists vault_docs_tagging_status on vault_documents(tagging_status);
create index if not exists vault_docs_drive_modified on vault_documents(drive_modified_at desc);
-- Partial unique index: only enforce uniqueness when Drive file ID is present
create unique index if not exists vault_docs_drive_file_id_unique on vault_documents(google_drive_file_id) where google_drive_file_id is not null;
create index if not exists vault_docs_tags_array on vault_documents using gin(tags_array);
