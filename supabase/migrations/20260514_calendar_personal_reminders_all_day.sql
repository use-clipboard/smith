-- Add support for all-day personal reminders.
-- For an all-day reminder, remind_at is stored as 09:00 local on the chosen
-- date (so the notification fires at 9am that morning by default), and the
-- UI hides the time picker / shows day-based lead-time options instead.
alter table calendar_personal_reminders
  add column if not exists is_all_day boolean not null default false;
