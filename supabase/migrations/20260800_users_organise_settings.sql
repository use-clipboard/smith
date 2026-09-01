-- Per-user "Organise my day" planner preferences (the working-day shape the
-- planner schedules into). Null = use defaults (see lib/tasks/organiseSettings.ts).
-- Shape: { workStartMin, workEndMin, lunchStartMin, lunchMinutes, bufferMinutes, wrapMinutes }.

alter table users
  add column if not exists organise_my_day_settings jsonb;

comment on column users.organise_my_day_settings is
  'Organise-my-day planner prefs (minutes-from-midnight working day, lunch, buffer, end-of-day wrap). Null = defaults.';
