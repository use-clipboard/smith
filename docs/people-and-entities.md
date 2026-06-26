# People ↔ entities — design plan

Link the **individuals** behind each bookkeeping entity (partners, sole traders,
directors, shareholders) to the people, so that in future SMITH can flow
profit / dividends / salary into each person's self-assessment, and generate
dividend vouchers and meeting minutes.

Status: **design only — not built.** Build incrementally (phases below).

## Existing building blocks (reuse these — don't duplicate)

- **`client_links`** (`20260321`, multi-type `20260508`): client-to-client
  relationships with a `link_type` — already used for Director / Shareholder /
  Partner / associated (multiple types allowed between the same two clients).
  This is the richest source: a director/shareholder is a linked client record.
- **`clients.key_contacts`** (JSONB, `20260714`): `[{name, role, email, phone,
  linked_client_id}]` — lighter contacts, manual or snapshot-from-client.
- **`clients`**: the entity/individual record. An individual who's also a client
  is the join to MTD IT / self-assessment.

**Decision:** do NOT introduce a parallel global `people` table — it would
duplicate client records. Instead a person who matters for tax is referenced via
their client record (where one exists) or snapshotted (where it doesn't).

## Data model

### New: `bookkeeping_book_participants`
One row per person attached to a book, with their role + attributes.

```
bookkeeping_book_participants
  id              uuid pk
  book_id         uuid -> bookkeeping_books (cascade)
  firm_id         uuid -> firms
  role            text  -- 'partner' | 'sole_trader' | 'director' | 'shareholder'
  -- Source of the person (the 3-source picker):
  source_type     text  -- 'client_link' | 'key_contact' | 'manual'
  linked_client_id uuid -> clients (nullable; set for source 'client_link')
  -- Snapshot (always filled, from the source or hard-entered):
  name            text
  -- Role attributes:
  profit_share_pct      numeric  -- partnership/LLP profit allocation
  shareholding_pct      numeric  -- shareholder dividends
  shares_held           numeric  -- optional, alternative to %
  annual_salary         numeric  -- director salary (informational)
  -- Optional mapping to the per-partner capital ledger accounts (P1..P9):
  capital_account_id    uuid -> bookkeeping_accounts (nullable)
  effective_from        date
  effective_to          date     -- shares/profit-share change year to year
  created_at, created_by
```

### Change: `client_links`
Add `ownership_percentage numeric` (nullable) so Shareholder/Partner links carry
a % firm-wide and show in the client's Links section. A book participant created
from a link defaults its `shareholding_pct` from this (overridable).

## The 3-source picker (UX)
When adding a participant to a book, the user can:
1. **Hard enter** — type the name (+ optional tax details) → `source_type=manual`.
2. **Select from client links** — pick a linked client of this book's client
   (filtered by relevant `link_type`) → `source_type=client_link`,
   `linked_client_id` set, name snapshotted.
3. **Select a key contact** — pick from `clients.key_contacts` →
   `source_type=key_contact`, name snapshotted (carry `linked_client_id` if the
   contact had one).

`linked_client_id` is the bridge to self-assessment, vouchers and minutes later.

## Phases
1. **Participants model + UI** — the table, the 3-source picker, attach to a book
   with role + %/share. Map partnership P1–P9 capital accounts to participants.
   (Foundation — everything below depends on it.)
2. **Profit allocation** — split partnership/LLP "Profit to be allocated" by
   `profit_share_pct` into each partner's capital account.
3. **Dividends** — declaration (date, total, per-shareholder by holding) →
   dividend voucher PDFs + board-minute document (use docx/pdf generation).
4. **Self-assessment feed** — push each person's profit-share / dividends /
   salary into the MTD IT tool (it already has an "Import from Bookkeeping —
   coming soon" placeholder for the Sole Trader trade).

## Watch-outs
- **Sensitive personal data** (NI/UTR/DOB) where captured → RLS + ensure it's
  covered by the account/firm deletion flow.
- **Effective-dated** profit shares & shareholdings (change year to year; a
  dividend uses the holding *at declaration date*).
- **Dividend rules** — interim vs final, waivers, distributable-reserves check.
- **Full SA filing** is a separate regulatory lift (like the HMRC MTD work);
  producing the figures + documents is the high-value 80% and doesn't require it.
