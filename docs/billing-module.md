# Billing Module — Build Spec

> The firm's **commercial engine**: invoicing, recurring billing, direct debits, payments,
> bank reconciliation, credit control and proposal-driven automation in one workflow.
> Status: **planning** (2026-07-09). No code written yet.

---

## 0. Naming & the two-directions-of-billing problem

There are **two** billing concepts in SMITH and they must never blur:

| Concept | Direction | Where it lives today |
|---|---|---|
| **Subscription** | SMITH charges the firm | `settings/tabs/BillingTab.tsx`, tiers, Stripe (Phase 2) |
| **Billing** (this module) | The firm charges *its* clients | net-new |

**Decision:** the new module is **Billing**. To free the name, rename the existing Settings
tab `BillingTab.tsx` → **"Subscription"** (label + nav string only; logic unchanged).
Everyday verb inside the module is "billing"; the Settings→Subscription tab keeps the
"what SMITH costs you" content.

---

## 1. Why this is cheaper to reach than it looks

**The proposals module already contains the billing data model.**

- `supabase/migrations/20260511_proposals.sql` → `proposal_line_items` carries
  `unit_price`, `frequency` (`one_off | monthly | quarterly | annual`), `total_monthly`,
  `total_annual`; plus `proposal_service_tiers`, `proposal_packages`, discounts
  (`20260606_proposals_discount_type.sql`). **This is the fee source of truth.**
- `app/api/p/[token]/accept/route.ts` already flips `proposals.status='accepted'`,
  records `proposal_signatures`, and branches on `post_acceptance_action`.
- `app/api/p/[token]/onboarding/submit/route.ts` already fans out 5 side-effects on
  acceptance (graduate prospect→`clients`, map answers, AML stub, tasks via
  `instantiateTaskFromTemplate`, and a **Letter-of-Engagement placeholder explicitly
  deferred**). **This is the hook point** — the "create recurring billing on acceptance"
  killer feature is one more side-effect in a route that already does five, reading fee
  data that already exists.

**Timesheets' recovery number is currently fake.** `lib/timesheets/compute.ts`
`recoveryFactor()` hashes the client ID → a plausible 0.70–1.02. There is no stored billed
amount. Billing is what makes recovery real (see §7).

---

## 2. How it slots into the existing architecture

| Concern | Pattern to reuse | File(s) |
|---|---|---|
| Module registration | Add `ModuleConfig` to `MODULES`; add id to `COMPLIANCE_MODULE_IDS`/`PRACTICE_ONLY_MODULE_IDS` | `config/modules.config.ts` |
| Server gating | `isModuleActiveForFirm` / `buildModuleChecker` / `moduleNotActive()` (403) | `lib/modules.ts` |
| Client gating | `useModules().isModuleActive(id)` | `components/ui/ModulesProvider.tsx` |
| Nav / launcher | `MODULES`-driven, gated by `isModuleActive` | `Sidebar.tsx`, `TabPanels.tsx`, `newtab/page.tsx` |
| Migrations | Plain SQL `YYYYMMDD_*.sql`, `create table if not exists` + RLS scoped by `firm_id IN (SELECT firm_id FROM users WHERE id = auth.uid())` | `supabase/migrations/` (next ≈ `20260740_billing.sql`) |
| Email | `lib/email.ts` (Resend default + per-firm Gmail path), merge tags `lib/emailMergeTags.ts` | — |
| Cron producers | Idempotent per-parent producer + cron consumer route (GET + Bearer) | `lib/tasks/recurrence.ts`, `app/api/tasks/reminders/process/route.ts`, `vercel.json` |
| PDF | Accounts Studio PDF stack | `lib/accounts-studio/*`, existing pack HTML→PDF |
| Bank matching | Bank-to-CSV tool | Capture / bank-to-csv module |
| AI | Existing server-side Anthropic client (`claude-sonnet-4-6`), per-firm key | `lib/anthropic.ts`, `getAnthropicForFirm` |

**Module gating note:** gating is *not* name-based (`'christos'`) — it's the `alwaysOn` flag
plus per-firm `active_modules`. Ship Billing gated (not `alwaysOn`) so we can preview it on
our own firm before rollout.

---

## 3. Data model (v1 sketch — refine at build time)

All tables: `firm_id` FK, RLS by firm, `created_at`, soft-delete where it matters.

```sql
-- Settings (one row per firm)
billing_settings (
  firm_id uuid primary key,
  invoice_prefix text default 'INV-',
  next_invoice_number int default 1,
  credit_note_prefix text default 'CN-',
  next_credit_note_number int default 1,
  default_payment_terms_days int default 14,
  default_vat_rate numeric default 20,
  post_to_bookkeeping boolean default false,   -- §4 the toggle
  bookkeeping_sales_account text,              -- which nominal, when toggle on
  reminder_schedule jsonb,                     -- [{day:1,template:'friendly'}, ...]
  auto_chase_default boolean default false,
  payment_provider text default 'stripe',      -- v1: Stripe only (card + Bacs DD + subscriptions)
  stripe_account_id text                        -- connected Stripe account
)

invoices (
  id uuid pk, firm_id, client_id,
  number text,                    -- rendered from prefix + seq at issue
  status text,                    -- draft|sent|viewed|part_paid|paid|overdue|cancelled|bad_debt
  issue_date date, due_date date,
  currency text default 'GBP',
  subtotal_pence int, vat_pence int, total_pence int,
  amount_paid_pence int default 0,
  balance_pence int,              -- generated / maintained
  source text,                    -- 'manual'|'recurring'|'proposal'|'timesheet'|'advisory'
  source_id uuid,                 -- e.g. recurring_invoices.id / proposal_line_items.id
  notes text, terms text,
  sent_at timestamptz, viewed_at timestamptz, paid_at timestamptz,
  created_by uuid
)

invoice_lines (
  id uuid pk, invoice_id, description text,
  quantity numeric, unit_price_pence int,
  vat_rate numeric, vat_pence int, net_pence int, gross_pence int,
  service_id uuid,                -- optional link back to a saved product/service
  time_entry_ids uuid[]           -- when billed from Timesheets (§7)
)

payments (
  id uuid pk, firm_id, client_id,
  method text,                    -- manual|stripe_card|stripe_bacs_dd|csv_import
  amount_pence int, received_date date,
  reference text, provider_ref text,
  matched boolean default false, matched_by text  -- 'ai'|'user'
)

payment_allocations (               -- part-payment / one payment across many invoices
  payment_id uuid, invoice_id uuid, amount_pence int
)

credit_notes (
  id uuid pk, firm_id, client_id, invoice_id,
  number text, amount_pence int, reason text, status text
)

recurring_invoices (
  id uuid pk, firm_id, client_id,
  frequency text,                 -- monthly|quarterly|annual|custom
  interval_days int,              -- for custom
  next_run_date date, status text,-- active|paused
  amount_pence int, template jsonb,   -- line snapshot
  proposal_line_item_id uuid,     -- provenance / drift detection
  last_invoice_id uuid, day_of_month int
)

-- Credit control
credit_control_events (
  id uuid pk, firm_id, client_id, invoice_id,
  type text,                      -- reminder_sent|call_logged|promise_to_pay|escalated|legal|note
  body text, promised_date date, promised_amount_pence int,
  created_by uuid, created_at
)

-- Direct debit (Phase D)
dd_mandates (                       -- Stripe Bacs Direct Debit mandates
  id uuid pk, firm_id, client_id,
  provider text default 'stripe', provider_mandate_id text,  -- Stripe SetupIntent/mandate id
  status text,                    -- pending|active|failed|cancelled
  bank_last4 text, created_at, activated_at
)
```

**Reusable AI/logging:** log every AI call to the existing `ai_logs` table
(`feature='billing'`).

---

## 4. The Bookkeeping-sales-ledger toggle (per-firm option)

`billing_settings.post_to_bookkeeping` (default **false**).

- **Off (default):** Billing is its own self-contained sales ledger. Simpler, faster,
  no coupling. This is what ships in Phase A.
- **On:** issuing an invoice posts a corresponding **sale** into the firm's Bookkeeping
  module (against `bookkeeping_sales_account`), and recording a payment posts the receipt.
  Reversal on cancel/credit-note. Revenue becomes the firm's *real* sales ledger.

Build the write path behind a single `postInvoiceToBookkeeping(invoice)` seam so the toggle
is a clean branch, not scattered `if`s. Ship the seam in Phase A (no-op when off); wire the
real posting when the toggle work is scheduled.

---

## 5. Phasing (front-load the differentiator, not the plumbing)

### Phase A — Real invoice ledger *(ship internally first)*
Tables `invoices` / `invoice_lines` / `payments` / `payment_allocations` / `credit_notes` /
`billing_settings`. Manual invoice builder (live PDF preview via Accounts Studio stack),
record manual payment (with allocation), credit notes, statements, the Linear-style invoice
list + slide-out side panel (timeline / activity / payments / email history), and the
Overview KPIs computed from **real** data. Numbering sequences in Settings. The
`postInvoiceToBookkeeping` seam (no-op). **No payment providers yet.** Replaces spreadsheets
on day one.

### Phase B — Recurring + Proposal automation *(the moat / the demo)*
`recurring_invoices` generated from `proposal_line_items` (frequency already modelled).
Add the billing side-effect to `app/api/p/[token]/onboarding/submit/route.ts` alongside the
existing five. Cron producer that mints invoices on schedule — **reuse the idempotent
per-parent pattern from `lib/tasks/recurrence.ts`** (we already solved double-firing there)
+ a GET/Bearer cron consumer in `vercel.json`. Pause / resume / skip / clone. Price-increase
& RPI/CPI wizard (bulk % across a filter). This is the "Proposal Accepted → zero clicks"
story.

### Phase C — Credit control
Reminder schedule + editable templates (reuse `lib/email.ts` + merge tags + the
`task_email_reminders` cron consumer we just built). Day-1 / 7 / 21 / 45 / 60 ladder,
per-client auto-chase toggle, `credit_control_events` (reminders, call logs, promise-to-pay,
escalation, legal stage), aged-debtors views, and AI payment-risk scoring via the existing
Anthropic client. "Today's actions" queue on Overview.

### Phase D — Payments *(heaviest, most external — do last)*
**Stripe only** — one integration covers **card + Bacs Direct Debit + subscriptions**, so the
whole "mandate → auto-collect" story lives on a single set of webhooks (no second provider).
- Card payments (Stripe Checkout / Payment Intents) — pay-invoice link + client portal.
- **Bacs Direct Debit** (Stripe) — mandate-on-proposal-accept, collections, failures, retries.
  This is what powers the **Direct Debits** tab; "mandate" = Stripe SetupIntent.
  - **First-invoice timing = firm option** (`billing_settings.first_invoice_mode`:
    `'card_now'` = collect first invoice by card immediately then hand to DD from month 2, vs
    `'wait_for_dd'` = wait for the ~3-day Bacs mandate confirmation). User's call, not hard-coded.
- **CSV import** — reuse the **Bank-to-CSV** tool for bank statements; AI match →
  `payments` with `matched_by='ai'`, one-click confirm. Feeds the "Cash in the bank" KPI +
  reconciliation panel (no live Open Banking feed in v1 → panel CTA is "Upload CSV").
- Manual payment entry (with allocation) is already in Phase A.

Deferred: GoCardless, Open Banking / live bank feeds, PayPal / Square / Worldpay.

### Phase E — Reports, deeper AI, client invoice portal
MRR/ARR, revenue by client/manager/service, aged debtors, debtor days, bad debt, cash
forecast, proposal conversion, **recovery rate (real, from Timesheets)**, profitability by
client. Client-facing invoice view — follow either existing token pattern
(`task_client_tokens` or `proposals.public_token`); there is **no authenticated client
portal today**, so this is net-new.

---

## 6. Proposals integration (the automation chain)

On proposal acceptance / onboarding submit, gated by new `firm_proposal_settings` flags
(mirror the existing `auto_*` flags):

```
Proposal accepted
  → client created            (exists: auto_create_client / auto_graduate_client)
  → recurring billing created (NEW: from proposal_line_items → recurring_invoices)
  → DD mandate sent           (Phase D: Stripe Bacs Direct Debit)
  → onboarding tasks created  (exists: instantiateTaskFromTemplate)
  → portal activated          (Phase E)
  → welcome email             (exists: sendProposalOnboardingEmail pattern)
  → first invoice scheduled   (NEW: recurring_invoices.next_run_date)
```

**Drift:** `recurring_invoices.proposal_line_item_id` keeps provenance so we can detect when
a proposal's fee later changes and offer to sync. Don't hard-link — snapshot into
`recurring_invoices.template` and reconcile on demand.

---

## 7. Timesheets integration (make recovery real)

The best cross-module story in the app.

- **Recovery becomes truth:** replace `recoveryFactor()` hash in `lib/timesheets/compute.ts`
  with `billed (invoices) ÷ chargeable time (time_entries.minutes × rate_pence)` per client.
  Timesheets instantly gets honest recovery %; Billing gets profitability-by-client free.
- **Bill from time:** draft `invoice_lines` from unbilled billable `time_entries`
  (`entry_type='billable'`), stamping `invoice_lines.time_entry_ids` so time is marked
  billed. This is the "suggest invoices from completed work" AI feature — data already there.
- **Under-billing / write-off:** Timesheets flags "logged £600 on a £400 fixed fee";
  Billing raises the top-up or records the write-off. The two modules point at each other.

---

## 8. AI features (all via existing server-side Anthropic client)

Suggest invoices from completed work · detect under-billing (vs Timesheets) · recommend
price increases (no rise in N years) · draft reminder emails · predict late payers (per-client
payment history) · suggest DD switch · cash-flow forecast · flag unusual payment behaviour ·
credit-risk score. Each is a server API route, structured JSON out, logged to `ai_logs`.

---

## 8a. Design language — match Timesheets

Billing must read as the **same family** as Timesheets (`components/features/timesheets/**`).
Reuse its primitives; do not invent a new look. A rough Overview mockup exists (2026-07-09,
in transcript) — good IA, but pull it toward the Timesheets *finish*.

- **Tabs:** Overview / Invoices / Recurring / Payments / Direct Debits / Clients / Reports /
  Settings. Icon + label, active tab underlined purple (Timesheets tab bar).
  - In-module **Clients** tab = per-client billing view (distinct from the global Clients nav).
  - **Direct Debits** tab stays (Stripe Bacs DD powered) — see §5 Phase D.
- **KPI cards (glass, ~20px radius, gradient corner):** Sales this month (Δ%) · Outstanding
  (n invoices) · Overdue (n) · Paid this month (n) · Average days to pay (Δ) · Cash in the
  bank (CSV-fed, sparkline). Each card carries a soft **gradient corner chip / ring chart**
  in the Timesheets palette (green %, purple ring, blue, amber £, red). This is the
  "coloured corners" the user wants — copy the KPI card component from Timesheets, don't
  rebuild flat icons.
- **Hero charts (interactive, Timesheets chart style):** Outstanding-by-age **donut** +
  Cash-flow **stacked bars** (Invoiced vs Paid) with legend chips. Let these two dominate;
  push Recent invoices / Top clients / Direct debits panels lower or into their tabs
  (Timesheets breathes — avoid the dense multi-panel grid).
- **Purple AI hero:** the **Credit control assistant** is the purple-gradient hero card with
  the sparkle icon + a "Scan / Review now" CTA — the Timesheets "AI suggested time" treatment.
  This is the SMITH signature; don't leave it a plain white panel.
- **Right rail (Overview):** Invoice details (Details/Payments/Activity/Notes tabs + Send
  reminder/Download) · Recurring invoices mini-list · Bank feed & reconciliation
  (Matched/Unmatched/To review, CTA "Upload CSV"). Mirrors Timesheets' right rail.
- **View toggle + period pills:** "My clients / Whole firm" toggle + This week/month/year
  pills, for the manager view (Timesheets `My activity / Whole firm`).
- **Automate your billing:** three action cards (Proposal accepted · Recurring invoices ·
  Credit control) surfacing the moat on the home screen.
- Floating **Ask Smith** sparkle button bottom-right (as elsewhere).
- Invoice list uses the shared **`TaskTable`** shell (bounded scroll, sticky head, resizable
  persisted columns, Actions col) — do not roll a bespoke table.

## 9. Explicitly cut from v1

**GoCardless** (Stripe Bacs DD covers direct debit) · multi-currency / FX · CIS &
reverse-charge VAT · PayPal / Square / Worldpay · Open Banking / live bank feeds (CSV import
only) · QuickBooks / Xero / Sage / FreeAgent / VT two-way sync (CSV import only) ·
authenticated multi-feature client portal (invoice view only, tokenised).

---

## 10. Open decisions still to make

1. **VAT / MTD:** do the firm's *own* sales invoices feed the firm's VAT return, or is that
   out of scope? (v1: store VAT lines, no return feed.)
2. **Permissions:** who can raise / approve / **write off** an invoice? (admin vs staff)
3. **Numbering:** per-firm single sequence vs per-year reset vs per-entity.
4. **When to flip `alwaysOn`:** preview on our firm through Phases A–C, then decide tiering
   (Compliance vs Practice-only — likely Practice given the automation depth).
5. **Recurring cadence anchoring:** issue on `day_of_month` vs anniversary of acceptance.

---

## 11. First build session (when we start Phase A)

1. `supabase/migrations/20260740_billing.sql` — tables in §3 (core subset) + RLS.
2. `config/modules.config.ts` — register `billing` module (route `/billing`, gated).
3. Rename `settings/tabs/BillingTab.tsx` label → "Subscription".
4. `app/(app)/billing/` route + nav + `ModulesProvider` gating.
5. `lib/billing/` — `numbering.ts`, `totals.ts` (pence math), `postInvoiceToBookkeeping.ts`
   (seam, no-op).
6. Invoice list + side panel + builder (reuse `TaskTable` shell pattern for the list;
   Accounts Studio PDF stack for preview).
7. Overview KPIs from real data.
