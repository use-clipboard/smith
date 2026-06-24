-- Bookkeeping — stable account/ledger identity + user-facing account codes
--
-- Three additions to bookkeeping_accounts, all nullable & idempotent:
--
--   • system_role — a semantic ROLE the system resolves special accounts by,
--     instead of by display name. Lets users rename an account freely without
--     breaking the wiring that depends on it (FA depreciation/disposal, VAT
--     routing, year-end retained-earnings). Seeded on book creation; never
--     editable through the account PATCH route. Scoped per (book, ledger) for
--     FA roles (each FA ledger has its own cost/depn movement accounts) and
--     per-book for singletons (vat_output, retained_earnings, …).
--
--   • ledger_key — a stable KEY for the ledger an account sits in, so the
--     report-grouping / FA-detection / VAT-routing conventions can key off a
--     code rather than the ledger's display string. Ledgers are already locked
--     from UI rename, so this is defence-in-depth; the display `ledger` column
--     stays the working grouping label.
--
--   • code — a user-facing, ranged-by-type account number (Sage-style):
--       1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income
--       5xxx cost of sales · 6xxx+ expenses
--     Cosmetic only — never used for system resolution (that's system_role's
--     job). Hidden by default; shown via a per-user preference. Seeded on book
--     creation and assigned to user-created accounts as they're added.

alter table public.bookkeeping_accounts
  add column if not exists system_role text,
  add column if not exists ledger_key  text,
  add column if not exists code         text;

comment on column public.bookkeeping_accounts.system_role is
  'Semantic role the system resolves this special account by (e.g. fa_depn_charge, vat_output, retained_earnings, disposal_pl). NULL for ordinary accounts. Immutable — not exposed in the account PATCH route — so renaming the display name never breaks FA/VAT/year-end wiring. FA roles are unique within a (book, ledger); singleton roles (vat_*, retained_earnings) are unique within a book.';

comment on column public.bookkeeping_accounts.ledger_key is
  'Stable key for the account''s ledger (e.g. fa_plant_machinery, creditors, capital_account). Code-backed alternative to matching the display `ledger` string. NULL on pre-existing rows until back-filled.';

comment on column public.bookkeeping_accounts.code is
  'User-facing ranged-by-type account number (1xxx asset, 2xxx liability, 3xxx equity, 4xxx income, 5xxx cost of sales, 6xxx+ expenses). Display/reporting only — NEVER used for system resolution. Hidden unless the per-user "Show account numbers" preference is on.';

-- Resolver lookups hit (book_id, system_role) and (book_id, ledger_key) hard.
create index if not exists bookkeeping_accounts_book_system_role_idx
  on public.bookkeeping_accounts (book_id, system_role)
  where system_role is not null;

create index if not exists bookkeeping_accounts_book_ledger_key_idx
  on public.bookkeeping_accounts (book_id, ledger_key)
  where ledger_key is not null;
