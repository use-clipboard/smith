# MTD IT (Income Tax) HMRC Submission — Implementation Plan

> Status: **Phase A + B built (local, awaiting migration apply).** Scope agreed:
> **quarterly cumulative updates only** (Final Declaration / crystallisation deferred),
> supporting **both** agent (ASA) and individual connections. Category mapping led by us
> (fixed mapping + manual override, with a consolidated-expenses fast path).
>
> Progress:
> - **Phase A — DONE (local):** migration `20260626_mtd_it_hmrc.sql`; per-service OAuth
>   scopes; `getHmrcConnection`; version + PUT in `hmrcRequest`; service-aware
>   connect/callback/disconnect (agent · business · individual).
> - **Phase B — DONE (local):** read endpoints (`businesses`, `businesses/link`,
>   `obligations`); bulk agent endpoints (`agent/import-identifiers`,
>   `agent/discover-businesses`, `agent/auto-map`, `agent/status`, `agent/clients`);
>   onboarding UI (`/mtd-it/onboarding` + dashboard "HMRC setup" button).
> - **Phase C — IN PROGRESS (local):**
>   - DONE: category map (`lib/mtdIt/categoryMap.ts`, SE fields verified); cumulative
>     YTD compute (`lib/mtdIt/computeUpdate.ts`, mirrors the approved P&L exactly);
>     read-only preview endpoint (`quarters/[id]/update-preview`).
>   - TODO: the submit endpoint's HMRC PUT envelope (confirm exact body shape against
>     the sandbox/OAS first — isolate in one builder); property itemised field codelist
>     (currently consolidated-expenses only); `mtd_it_submissions` receipt write +
>     status→`submitted`; the "Submit to HMRC" UI/modal in the review phase.
>
> ⚠️ Deploy order: apply `20260626_mtd_it_hmrc.sql` BEFORE pushing — the OAuth callback
> writes the new `service`/`client_id` columns (shared DB).

This plan extends the existing MTD-IT preparation tool (client → tax year → quarters →
entries → AI review → client approval) with **real HMRC submission**, reusing the
`lib/hmrc/` OAuth + fraud-header layer we built for MTD VAT.

---

## 1. Verified HMRC API facts (2025/26 onward)

Confirmed against HMRC's developer hub (adversarially fact-checked). The headline change
vs VAT: **submissions are CUMULATIVE (year-to-date)**, not per-quarter slices. Each
quarter we PUT the YTD totals for each business source.

### Endpoints
| Purpose | Method + path | API / version | Scope |
|---|---|---|---|
| Self-employment update | `PUT /individuals/business/self-employment/{nino}/{businessId}/cumulative/{taxYear}` | Self-Employment Business **v5.0** | `write:self-assessment` |
| UK property update | `PUT /individuals/business/property/uk/{nino}/{businessId}/cumulative/{taxYear}` | Property Business **v6.0** | `write:self-assessment` |
| Foreign property update | `PUT /individuals/business/property/foreign/{nino}/{businessId}/cumulative/{taxYear}` | Property Business **v6.0** | `write:self-assessment` |
| Retrieve (any of above) | `GET …/cumulative/{taxYear}` | same | `read:self-assessment` |
| List businesses | `GET /individuals/business/details/{nino}/list` | Business Details **v2.0** | `read:self-assessment` |
| Retrieve business | `GET /individuals/business/details/{nino}/{businessId}` | Business Details **v2.0** | `read:self-assessment` |
| Obligations | `GET /obligations/details/{nino}/income-and-expenditure?typeOfBusiness=&businessId=` | Obligations **v3.0** | `read:self-assessment` |

### Conventions
- **NINO**: `AA999999A`. **businessId**: `^X[A-Z0-9]IS[0-9]{11}$` (e.g. `XAIS12345678910`).
- **taxYear**: `YYYY-YY` (e.g. `2025-26`).
- **Version header**: `Accept: application/vnd.hmrc.{version}+json` — pinned **per API**
  (2.0 Business Details, 3.0 Obligations, 5.0 Self-Employment, 6.0 Property).
- **typeOfBusiness** enum: `self-employment`, `uk-property`, `foreign-property`,
  `property-unspecified`. (We file against the first three. FHL abolished April 2025 — no
  FHL variants.)
- **Obligation status**: response `open` / `fulfilled`; periods keyed by
  `periodStartDate`, `periodEndDate`, `dueDate`, `receivedDate` (all `YYYY-MM-DD`).
- **OAuth**: scopes `read:self-assessment` / `write:self-assessment` (DIFFERENT from VAT's
  `read:vat`/`write:vat`). Token 4h, single-use refresh, 18-month hard cap — same mechanics
  our VAT layer already handles.
- **Fraud-prevention headers**: legally required for ITSA too — reuse the VAT
  implementation unchanged.

### Self-employment field codelist
- **Income**: `turnover`, `other`, `taxTakenOffTradingIncome`.
- **Expenses**: either `consolidatedExpenses` (single total, allowed when turnover is below
  the VAT-registration threshold) **XOR** the itemised set:
  `costOfGoods`, `paymentsToSubcontractors`, `wagesAndStaffCosts`, `carVanTravelExpenses`,
  `premisesRunningCosts`, `maintenanceCosts`, `adminCosts`, `businessEntertainmentCosts`,
  `advertisingCosts`, `interestOnBankOtherLoans`, `financeCharges`, `irrecoverableDebts`,
  `professionalFees`, `depreciation`, `otherExpenses`.

### Agent authorisation
- Agent must already be authorised for the client (migrated 64-8 **or** digital handshake)
  **before** MTD-IT sign-up. App holds many tokens; must use the correct token per client
  (wrong token → HTTP 401).

### Verify during build (not fully captured in research)
- Property cumulative field codelists (UK non-FHL + foreign) — pull Property Business v6.0
  OAS directly.
- The consolidated-expenses turnover threshold figure in force for 2025/26.
- MTD-IT sandbox test-user creation + IT-specific `Gov-Test-Scenario` values (sandbox base
  URL `https://test-api.service.hmrc.gov.uk` already in `lib/hmrc/config.ts`).
- Final Declaration / crystallisation flow (deferred) — confirm EOPS fully removed.

---

## 2. How it maps to the current tool

Near 1:1 alignment:
- Streams `sole / uk_rental / foreign_rental` → HMRC `self-employment / uk-property /
  foreign-property`.
- `mtd_it_entries` are already per quarter, per stream, with `gbp_amount`, `entry_type`
  (income/expense), `category`, `trade_id`/`property_id` → **YTD cumulative = sum across
  Q1…Qn** for the chosen quarter.
- `lib/hmrc/` (OAuth, refresh, `hmrcRequest`, fraud headers, `clientFraudData`) reusable.
- Existing approval workflow stays as the gate **before** submission (status `approved`).

### Gaps to close
1. Client HMRC identifiers (NINO, UTR) — not yet in DB.
2. Per-business-source `businessId` — not yet stored on trades/properties.
3. Connection model is VAT/book-scoped — needs a `service` discriminator + client linkage.
4. Category → HMRC field mapping — does not exist.
5. Cumulative compute + submissions table + obligations fetch + submit UI — new.

---

## 3. Data model changes (migrations)

```sql
-- clients: HMRC identifiers
alter table public.clients
  add column if not exists nino text,                 -- AA999999A (used in API paths)
  add column if not exists self_assessment_utr text;  -- 10-digit; needed for sign-up

-- business source IDs (one HMRC businessId per trade / property)
alter table public.mtd_it_trades
  add column if not exists hmrc_business_id text;      -- ^X[A-Z0-9]IS[0-9]{11}$
alter table public.mtd_it_properties
  add column if not exists hmrc_business_id text;

-- generalise the HMRC connection store (currently VAT/book-scoped)
alter table public.hmrc_connections
  add column if not exists service text not null default 'vat'  -- 'vat' | 'mtd_it'
    check (service in ('vat','mtd_it')),
  add column if not exists client_id uuid references public.clients(id) on delete cascade;
-- kind already supports 'agent' | 'business'; add 'individual' for MTD-IT individual conns
-- (widen the kind check constraint to include 'individual').

-- submission receipts (audit trail of what was filed)
create table if not exists public.mtd_it_submissions (
  id            uuid primary key default gen_random_uuid(),
  quarter_id    uuid not null references public.mtd_it_quarters(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  business_id   text not null,                 -- HMRC businessId filed against
  type_of_business text not null,              -- self-employment | uk-property | foreign-property
  tax_year      text not null,                 -- '2025-26'
  period_to     date not null,                 -- YTD end (the obligation period end we met)
  payload       jsonb not null,                -- exact body PUT to HMRC
  hmrc_status   int,                           -- HTTP status
  hmrc_response jsonb,                          -- receipt / error body
  submitted_by  uuid references public.users(id),
  submitted_at  timestamptz not null default now()
);
alter table public.mtd_it_submissions enable row level security;
-- RLS: same-firm via client_id → clients.firm_id = my_firm_id()
```

> All migrations idempotent; applied manually in the Supabase SQL editor as usual.

---

## 4. Connection model & OAuth

Generalise the VAT connection helper:

```ts
// lib/hmrc/api.ts (new generic getter; keep getConnectionForBook as a thin wrapper)
getHmrcConnection(service: 'vat' | 'mtd_it', firmId, opts?: { bookId?; clientId? })
//  mtd_it + clientId → prefer kind='individual' for that client, else fall back to kind='agent'
//  mtd_it (no clientId) → kind='agent'
```

- **Agent**: one OAuth connection per firm (`kind='agent'`, `service='mtd_it'`), used for all
  the firm's clients. Per-client NINO + businessIds drive the API paths. This matches how a
  practice actually files.
- **Individual**: per-client connection (`kind='individual'`, `client_id` set) for the rare
  case the client self-files through us.
- **OAuth routes**: reuse `/api/hmrc/connect|callback|disconnect`, parameterised by
  `service` (→ scope set: `read:self-assessment write:self-assessment`) and `kind`.
- **Token refresh / fraud headers**: unchanged — `hmrcRequest` + `buildFraudHeaders` already
  handle these.

---

## 5. Category mapping (our lead)

Approach: **deterministic fixed mapping + manual override**, with a **consolidated-expenses
fast path** for small traders.

1. **Self-employment**: a lookup table from our `entry.category` values → HMRC SE expense
   field (e.g. our "Materials/Stock" → `costOfGoods`, "Subcontractors" → `paymentsToSubcontractors`,
   "Travel" → `carVanTravelExpenses`, "Premises/Rent/Rates" → `premisesRunningCosts`,
   "Accountancy/Legal" → `professionalFees`, fallback → `otherExpenses`). Income →
   `turnover` (trading) with `other`/`taxTakenOffTradingIncome` for the edge cases.
2. **Property**: equivalent lookup to the Property v6.0 field names (pulled at build time).
3. **Manual override**: a per-category mapping screen (firm-level default) + a per-entry
   override when something doesn't fit, so nothing is silently miscategorised.
4. **Consolidated option**: when a business's YTD turnover is below the VAT-registration
   threshold, offer a single `consolidatedExpenses` total instead of itemising (HMRC allows
   this and it's the fastest correct path). Enforce the XOR rule (never send both).
5. **Pre-submit validation**: block submission if any entry lands in an unmapped category;
   surface them for the preparer to map.

---

## 6. Cumulative compute

New `lib/mtdIt/computeUpdate.ts`:

```ts
computeMtdItCumulative(supabase, {
  clientId, taxYear, uptoQuarter, businessSource /* trade or property + typeOfBusiness */
}): Promise<{
  typeOfBusiness, businessId, periodDates,
  body: HmrcCumulativeBody,         // income{} + expenses{} (itemised or consolidated)
  unmapped: Entry[],                // categories needing mapping (blocks submit)
  warnings: string[],
}>
```

- Sum **all entries from the tax-year start through the selected quarter end**, per business
  source (group `mtd_it_entries` by `trade_id` / `property_id`).
- Apply the category mapping → HMRC field totals; respect itemised-vs-consolidated.
- Single source of truth for the live preview, the figures stored at submission, and the
  audit snapshot (mirrors how `computeVatReturn` works).

---

## 7. API routes (new)

```
GET  /api/mtd-it/clients/[clientId]/businesses      → Business Details list (map to trades/properties)
POST /api/mtd-it/clients/[clientId]/businesses/link → persist hmrc_business_id on a trade/property
GET  /api/mtd-it/clients/[clientId]/obligations     → Obligations v3.0 (deadlines + open/fulfilled)
GET  /api/mtd-it/quarters/[id]/update-preview       → computeMtdItCumulative (per business source)
POST /api/mtd-it/quarters/[id]/submit               → PUT cumulative per business source, record receipts

-- Bulk agent onboarding (see §8.1)
POST /api/mtd-it/agent/import-identifiers           → bulk upsert NINO/UTR for many clients (CSV/grid)
POST /api/mtd-it/agent/discover-businesses          → sweep Business Details for all/selected clients
POST /api/mtd-it/agent/auto-map                      → auto-match discovered businesses → trades/properties
POST /api/mtd-it/agent/request-authorisations       → bulk Agent Authorisation invitations (optional)
```

Submit route flow (per business source in the quarter):
1. Auth + load quarter + client (RLS firm scope). Require status `approved`.
2. Resolve connection (`getHmrcConnection('mtd_it', firmId, { clientId })`).
3. `computeMtdItCumulative(...)` server-side (never trust client figures). Abort if `unmapped`.
4. `PUT …/cumulative/{taxYear}` with version header + `buildFraudHeaders(req, fraudData)`.
5. On 2xx: insert `mtd_it_submissions` receipt. When all sources for the quarter succeed →
   quarter status `submitted`. On error: return HMRC error detail; nothing partially flipped.

---

## 8. UI

- **Setup**: a "Connect to HMRC (Income Tax)" action (agent or individual) + a "Match
  businesses" step that lists HMRC businesses and maps each to a trade/property.
- **Quarter page / dashboard**: show real obligations (period + due date + open/fulfilled)
  pulled from the Obligations API.
- **Review phase**: a "Submit to HMRC" button, gated on `approved` + connection present +
  every business source mapped to a `businessId` + an open obligation. Confirmation dialog
  ("year-to-date figures, irreversible"), fraud-data collected client-side, receipt shown on
  success. Reuse the VAT `MtdSubmitModal` patterns.

### 8.1 Bulk agent onboarding (many clients at once)

Key insight: the **agent OAuth is a one-time action** — one agent connection covers every
client the firm is HMRC-authorised for. So per-client work is only (a) NINO/UTR capture and
(b) business-source discovery + mapping. Both are bulk-able. A dedicated **"MTD IT
onboarding" screen** (admin) handles a whole client book in one pass:

1. **Connect once** — agent (ASA) OAuth. Done a single time for the firm.
2. **Bulk identifiers** — a grid of all MTD-IT-flagged clients with inline-editable
   NINO/UTR, plus **CSV import** (`client_ref, nino, utr`) to fill them in one shot.
   (`POST /agent/import-identifiers`.)
3. **Discover businesses for all** — one background sweep over every client that has a
   NINO: call Business Details *List All Businesses*, returning each client's HMRC
   self-employment / property sources. (`POST /agent/discover-businesses`, batched +
   rate-limited, progress-reported like our other long jobs.)
4. **Auto-map + review** — auto-match discovered businesses to existing trades/properties
   (by type, then address/name); present a single review table bucketed as:
   **✓ matched**, **● needs attention** (ambiguous/new → one click to create or link),
   **⚠ not authorised at HMRC** (the per-client call returned 401/403), **○ missing NINO**.
   (`POST /agent/auto-map`.) Only the exceptions need a human — the happy path is zero-touch.
5. **(Optional) Request authorisations in bulk** — for clients not yet authorised, fire
   Agent Authorisation invitations in one batch and track status. *Each client must still
   accept on their side, and the underlying 64-8/digital-handshake authorisation lives in
   HMRC's Agent Services Account — we can request and track, not auto-grant.*
   (`POST /agent/request-authorisations` — verify the Agent Authorisation API supports the
   MTD-IT invitation flow at build time.)

Net effect: connect once, paste/import NINOs once, run one discovery sweep, resolve only the
handful of exceptions — instead of touching every client individually.

> Note: HMRC does **not** expose a "list all my clients" API to software (privacy), so the
> client list is *our* MTD-IT-flagged clients; we detect authorisation status by attempting
> the per-client Business Details call and flagging 401/403.

---

## 9. Build sequence (when we start)

- **Phase A — Plumbing**: migrations (§3); `getHmrcConnection` + IT OAuth scope wiring;
  connect/callback/disconnect for `service='mtd_it'` (agent + individual).
- **Phase B — Read-only**: businesses list + mapping UI; obligations fetch + display; the
  **bulk agent onboarding screen** (§8.1 — bulk NINO/UTR import + discover-businesses sweep +
  auto-map review). *No submission — lets us see real HMRC data safely first.*
- **Phase C — Compute + Submit**: category mapping + `computeMtdItCumulative`; submit route;
  receipts; submit UI gated as above. Verify property field codelists + sandbox test users
  here.

---

## 10. Open decisions / risks
- Confirm property v6.0 field codelists at Phase C start.
- Confirm consolidated-expenses threshold figure for 2025/26.
- Agent authorisation pre-req (64-8/handshake) is outside our app — we surface a clear
  "client not authorised" error rather than trying to automate it.
- Final Declaration / crystallisation explicitly **out of scope** for this build.
