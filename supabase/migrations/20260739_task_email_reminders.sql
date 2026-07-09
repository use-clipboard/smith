-- Task email reminders queue.
--
-- The reminder consumer (app/api/tasks/reminders/process) has always read from
-- this table, but nothing created it and nothing populated it — so scheduled
-- per-step email reminders never sent. This adds the table + the producer wires
-- rows in from lib/tasks/reminderProducer.ts.
--
-- One row = one email to send to one recipient at send_at. status moves
-- pending → sent | failed. The UNIQUE(step_id, recipient_email, timing)
-- constraint lets the producer regenerate pending rows (delete + re-insert with
-- ignore-duplicates) without ever re-sending an email that already went out.

CREATE TABLE IF NOT EXISTS public.task_email_reminders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid        NOT NULL REFERENCES public.firms(id)      ON DELETE CASCADE,
  task_id         uuid        NOT NULL REFERENCES public.tasks(id)      ON DELETE CASCADE,
  step_id         uuid        NOT NULL REFERENCES public.task_steps(id) ON DELETE CASCADE,
  recipient_email text        NOT NULL,
  recipient_name  text,
  timing          text        NOT NULL
    CHECK (timing IN ('on_assign', '1_day_before_due', '3_days_before_due', '1_week_before_due', 'on_due_date')),
  send_at         timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, recipient_email, timing)
);

-- The cron pulls `status = 'pending' AND send_at <= now()`.
CREATE INDEX IF NOT EXISTS idx_task_email_reminders_due  ON public.task_email_reminders(status, send_at);
CREATE INDEX IF NOT EXISTS idx_task_email_reminders_step ON public.task_email_reminders(step_id);
CREATE INDEX IF NOT EXISTS idx_task_email_reminders_firm ON public.task_email_reminders(firm_id);

-- RLS: firm members manage their own firm's reminders (producer runs as the
-- user). The cron consumer uses the service-role client, which bypasses RLS.
ALTER TABLE public.task_email_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_access_task_email_reminders" ON public.task_email_reminders;
CREATE POLICY "firm_access_task_email_reminders"
  ON public.task_email_reminders FOR ALL
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));
