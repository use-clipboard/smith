-- ============================================================
--  Landlord settings parity with MTD IT + per-approval reminder control
-- ============================================================
--  1. landlord_firm_settings gains the auto-reminder schedule and its own
--     brand logo, mirroring mtd_it_firm_settings.
--  2. landlord_approvals gains the reminder counters.
--  3. BOTH tools' approval rows gain `reminders_paused` — when a client is
--     going to sign a paper copy, chasing them by email is wrong, so the
--     preparer can switch it off for that one approval without disabling
--     reminders for the whole firm.
--  4. Private `landlord-branding` bucket for the logo.
-- ============================================================

-- ── Firm settings: reminders + logo ─────────────────────────
alter table public.landlord_firm_settings
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_days    integer not null default 7  check (reminder_days between 1 and 60),
  add column if not exists reminder_max     integer not null default 1  check (reminder_max between 1 and 5),
  add column if not exists brand_logo_path  text,
  add column if not exists reminder_subject text not null default
    'Reminder — property income computation for approval ({{client_name}})',
  add column if not exists reminder_body text not null default
    'Hi {{person_name}},

Just a gentle reminder that your property income computation for {{period_from}} to {{period_to}} is still waiting for your approval.

If you''ve already dealt with this, please ignore this email.

Many thanks,
{{preparer_name}}
{{firm_name}}';

-- ── Approval rows: reminder counters ────────────────────────
alter table public.landlord_approvals
  add column if not exists reminder_count   integer not null default 0,
  add column if not exists last_reminder_at timestamptz;

-- ── Per-approval reminder opt-out (both tools) ──────────────
-- Set when the client is signing physically (or has said they'll come back to
-- us), so the daily cron leaves this one alone. Firm-level reminder_enabled
-- still gates everything above it.
alter table public.landlord_approvals
  add column if not exists reminders_paused boolean not null default false;

alter table public.mtd_it_quarter_approvals
  add column if not exists reminders_paused boolean not null default false;

comment on column public.landlord_approvals.reminders_paused is
  'True = never auto-chase this approval (e.g. the client is signing a paper copy).';
comment on column public.mtd_it_quarter_approvals.reminders_paused is
  'True = never auto-chase this approval (e.g. the client is signing a paper copy).';

-- ── Branding bucket (private; mirrors mtd-it-branding) ──────
insert into storage.buckets (id, name, public)
values ('landlord-branding', 'landlord-branding', false)
on conflict (id) do nothing;
