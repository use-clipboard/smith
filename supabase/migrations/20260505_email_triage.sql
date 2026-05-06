-- Email Triage: Gmail connections, allocations, and task links

-- Gmail OAuth tokens per user
CREATE TABLE IF NOT EXISTS public.email_connections (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  firm_id           uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  google_email      text        NOT NULL,
  access_token      text,
  refresh_token     text,
  token_expiry      timestamptz,
  history_id        text,              -- last known Gmail historyId for incremental polling
  inbox_label       text        NOT NULL DEFAULT 'INBOX',
  show_as_threads   boolean     NOT NULL DEFAULT true,
  connected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Link emails (by Gmail thread ID) to client timeline entries
CREATE TABLE IF NOT EXISTS public.email_allocations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES public.users(id),
  thread_id         text        NOT NULL,
  client_id         uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  timeline_entry_id uuid        REFERENCES public.client_timeline_notes(id) ON DELETE SET NULL,
  subject           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, client_id, firm_id)
);

-- Link emails to tasks
CREATE TABLE IF NOT EXISTS public.email_task_links (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid        NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.users(id),
  thread_id  text        NOT NULL,
  task_id    uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  subject    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, task_id)
);

-- Row Level Security
ALTER TABLE public.email_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_task_links   ENABLE ROW LEVEL SECURITY;

-- email_connections: own row only
CREATE POLICY "email_connections_own"
  ON public.email_connections
  FOR ALL
  USING (user_id = auth.uid());

-- email_allocations: firm members
CREATE POLICY "email_allocations_firm"
  ON public.email_allocations
  FOR ALL
  USING (
    firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    )
  );

-- email_task_links: firm members
CREATE POLICY "email_task_links_firm"
  ON public.email_task_links
  FOR ALL
  USING (
    firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Index for fast thread lookups
CREATE INDEX IF NOT EXISTS email_allocations_thread_idx ON public.email_allocations (firm_id, thread_id);
CREATE INDEX IF NOT EXISTS email_task_links_thread_idx  ON public.email_task_links  (firm_id, thread_id);
