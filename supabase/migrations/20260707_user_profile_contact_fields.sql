-- Team member profile: contact fields shown on the profile screen header.
-- Everything else the profile needs (job_title, manager_id, department_id,
-- employment_start_date, avatar_url, role) already exists on users from the HR
-- migrations; these two are the only additions.

alter table public.users add column if not exists phone  text;
alter table public.users add column if not exists office text;
