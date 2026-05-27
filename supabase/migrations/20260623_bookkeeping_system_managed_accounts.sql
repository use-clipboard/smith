-- Bookkeeping — system-managed accounts
--
-- Some accounts shouldn't be touched directly by the user — they're posted
-- to ONLY via specific server actions (e.g. the CTX auto-balance button
-- which posts the contra leg of a write-off / cash transaction to
-- "Bank: Petty cash"). Letting users post manually to those accounts via
-- the picker would silently break the auto-match flow.
--
-- The flag works in two layers:
--   • AccountPicker hides system_managed accounts from the dropdown so
--     the user never sees Petty cash as a choice.
--   • The Properties / Move / Delete / Rename right-click actions disable
--     themselves for system_managed accounts so an admin can't fat-finger
--     it.
-- The server-side auto-match endpoint can still post to these accounts —
-- it doesn't go through the picker.

alter table public.bookkeeping_accounts
  add column if not exists system_managed boolean not null default false;

comment on column public.bookkeeping_accounts.system_managed is
  'When true, the account is hidden from the user-facing AccountPicker and protected from rename/move/delete in the right-click menu. Used for accounts like Bank: Petty cash that get populated exclusively by automated server actions (CTX auto-balance, etc.) — manual posting would corrupt the auto-match flow.';
