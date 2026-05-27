-- Bookkeeping — account properties (inactive flag + free-form notes)
--
-- Adds two columns to bookkeeping_accounts so the per-account "Properties"
-- dialog (right-click an account in the ledger view) can persist:
--
--   • inactive — when true, the account is hidden from the AccountPicker
--     dropdown so users can't post NEW entries against it. Existing entries
--     stay visible in the ledger view and on reports. This is the soft
--     equivalent of "make this account not allow any more entries" in VT.
--     Distinct from `archived` which we reserve for full hide-from-UI.
--   • notes — small text field for the bookkeeper to jot why this account
--     exists, what it should/shouldn't be used for, etc. Surfaced in the
--     Properties dialog only.

alter table public.bookkeeping_accounts
  add column if not exists inactive boolean not null default false,
  add column if not exists notes    text;

comment on column public.bookkeeping_accounts.inactive is
  'Account is locked for new entries (hidden from AccountPicker). Existing entries remain visible. Soft alternative to archived.';
comment on column public.bookkeeping_accounts.notes is
  'Bookkeeper''s free-form notes shown in the account Properties dialog.';
