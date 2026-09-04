-- Tax Studio — distinguish SA100 from SA800 submissions in the shared receipts
-- table. Both file through the same GovTalk Transaction Engine (vendor 9626) and
-- are recorded in tax_studio_sa_submissions; the `form` column selects the GovTalk
-- message class (HMRC-SA-SA100 vs HMRC-SA-SA800) when the cron polls/deletes a
-- pending submission.

alter table public.tax_studio_sa_submissions add column if not exists form text not null default 'SA100';

comment on column public.tax_studio_sa_submissions.form is 'Return form: SA100 or SA800 — selects the GovTalk message class on poll/delete.';
