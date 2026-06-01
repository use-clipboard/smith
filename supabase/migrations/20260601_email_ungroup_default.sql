-- Email Triage — default to ungrouped (flat) inbox
--
-- The email_connections.show_as_threads column originally defaulted to true,
-- grouping the inbox into Gmail conversations. Gmail's threading merges
-- unrelated same-subject emails (e.g. Capium "Deadline Reminder" notices for
-- different clients) into one row, which makes per-client triage confusing.
-- The firm preference is now a flat, one-row-per-email inbox.
--
-- Flip the column default for any future connections, and reset existing
-- connections to the new default. Individual users can still re-enable
-- grouping from Settings → Email Triage → Display Preferences.

alter table public.email_connections
  alter column show_as_threads set default false;

update public.email_connections
  set show_as_threads = false
  where show_as_threads = true;
