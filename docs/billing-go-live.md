# Billing — Live Rollout Checklist

Order matters: DB → env → deploy → Stripe → configure → smoke test. Keep the risky
automation OFF until you've verified the basics.

## 1. Database (apply in order)
- [ ] `20260740_billing.sql` — invoices / lines / payments / allocations / credit-notes / settings
- [ ] `20260741_recurring_invoices.sql` — recurring schedules + `firm_proposal_settings.auto_create_billing`
- [ ] `20260742_credit_control.sql` — chaser stages / events + chase columns
- [ ] `20260743_payments_stripe.sql` — Stripe linkage columns
- [ ] `20260744_billing_portal.sql` — client statement-portal tokens

## 2. Environment variables (Vercel)
- [ ] `CRON_SECRET` — secures both billing crons (without it the endpoints run unauthenticated)
- [ ] `RESEND_API_KEY` + `RESEND_FROM_ADDRESS` — chaser + transactional email
- [ ] `NEXT_PUBLIC_SITE_URL` — must be the real domain (portal + Stripe return URLs use it)
- [ ] Stripe (only for card / Direct Debit / portal pay):
  - [ ] `STRIPE_SECRET_KEY`
  - [ ] `STRIPE_WEBHOOK_SECRET`
  - [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## 3. Deploy
- [ ] Push/redeploy `main` (brings the restored sidebar entry + all routes live)
- [ ] Confirm the two crons are registered (Vercel → Settings → Cron): `/api/billing/recurring/run` (07:00) and `/api/billing/credit-control/run` (08:00)

## 4. Stripe (skip if not using card/DD yet)
- [ ] Start in **test mode** with test keys
- [ ] Create a webhook → `https://<domain>/api/billing/stripe/webhook`
- [ ] Subscribe to events: `checkout.session.completed`, `setup_intent.setup_failed`
- [ ] Copy the signing secret into `STRIPE_WEBHOOK_SECRET`
- [ ] Billing → Settings → "Card payments (Stripe)" shows **Connected** (+ webhook OK)

## 5. Firm configuration (Billing → Settings)
- [ ] Business name, address, VAT number, **bank details** (these print on invoices/statements)
- [ ] Invoice numbering prefixes + default VAT / payment terms
- [ ] Review the **auto-chaser ladder** wording; leave the global **auto-chaser OFF** for now
- [ ] Leave Proposals → **"Set up billing from the proposal fees" OFF** until verified

## 6. Smoke tests (safe, no external effects)
- [ ] Create a draft invoice → mark sent → **Download PDF** looks right
- [ ] Record a manual payment → status → paid; Overview KPIs update
- [ ] Recurring: create a schedule → **Generate now** → invoice appears
- [ ] Payments → **Import bank CSV** → matches → confirm → payment recorded
- [ ] Reports render (recovery shows once Timesheets has billable time)
- [ ] Clients tab → **Share portal link** → open `/statement/<token>` → PDF downloads

## 7. Live tests (real emails / money — do deliberately)
- [ ] Credit Control → one invoice → **Send reminder** to a *test* client address
- [ ] Stripe test-mode card payment via a portal "Pay" button → webhook records it
- [ ] Only then: turn on the global **auto-chaser**, and (optionally) proposal auto-billing

## 8. Go-live gate
- [ ] Billing still SOON-badged? Drop `comingSoon` in `config/navItems.ts` when ready for the team
- [ ] Switch Stripe to live keys + a live-mode webhook
- [ ] Announce to staff

**Rollback:** the tool is gated by tier/`active_modules`; to pull it, remove `billing`
from a firm's active modules (or re-add the `comingSoon` badge). Data is additive —
no destructive migrations to undo.
