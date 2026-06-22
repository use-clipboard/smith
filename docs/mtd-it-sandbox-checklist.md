# MTD IT — HMRC Sandbox Verification Checklist

**Purpose:** methodically prove the MTD IT tool works end-to-end against the HMRC
**sandbox** before (a) applying for HMRC production access and (b) filing for any
real client. Every box should be green in sandbox first.

> **Golden rule:** nothing points at production (`api.service.hmrc.gov.uk`) until
> this whole checklist passes **and** HMRC has granted production approval +
> the fraud-header check. Sandbox base URL is `test-api.service.hmrc.gov.uk`
> (`HMRC_ENV=sandbox`).

Legend: 🔴 = critical / never verified before · 🟡 = important · ⚪ = confidence check

---

## 0. Environment & test data (one-time setup)

- [ ] HMRC Developer Hub application exists with the **Income Tax (MTD)** API subscribed.
- [ ] Sandbox env vars set: `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`, `HMRC_ENV=sandbox`.
- [ ] Redirect URI registered on the Dev Hub **matches** the running host (local: `http://localhost:3000/api/hmrc/callback`).
- [ ] Created HMRC **sandbox test users**: one **agent** + at least 2 **individual** test users (with NINO/UTR), via the Dev Hub "Create Test User" API.
- [ ] Recorded the sandbox NINOs/UTRs for use below.
- [ ] App builds & deploys clean; `isHmrcConfigured()` returns true (Submit modal leaves the "not set up" state).

## 1. Agent connection (OAuth)

- [ ] From MTD IT → onboarding, click **Connect HMRC** (agent) → completes OAuth round-trip → returns with "connected".
- [ ] `agent/status` reports connected; token persisted in `hmrc_connections` (service-role only).
- [ ] Disconnect works; reconnect works.

## 2. Onboarding: identifiers → discover → auto-map

- [ ] Import NINO/UTR for the test clients (manual + CSV `client_ref,nino,utr`).
- [ ] **Discover businesses** returns the sandbox businesses for each client.
- [ ] Test-scenario coverage: a client with **no businesses found**, and one with **multiple** business types.
- [ ] **Auto-map** links discovered businesses to local trades/properties; mismatches flagged for review.
- [ ] Manual link (a trade/property → HMRC business id) works.

## 3. Obligations

- [ ] "Check obligations" in the submit modal returns the open quarterly obligation periods.
- [ ] If empty, set a `Gov-Test-Scenario` and confirm obligations appear (sandbox quirk).
- [ ] A filed quarter shows as **Fulfilled**; an open one shows **Open**.

## 4. Quarterly submission — per business type 🔴

For each, do a **setup → analyse/manual entry → review → submit** pass and confirm
HMRC accepts it (2xx) and `mtd_it_submissions` records the response.

### Self-employment
- [ ] Single trade — itemised expenses.
- [ ] Single trade — **consolidated** expenses (below £90k).
- [ ] **Multiple trades** — each files as its own business; figures correct per trade.

### UK property 🔴 (aggregation fix — verify carefully)
- [ ] Single UK property.
- [ ] **Two+ UK properties** — confirm they file as **ONE** UK-property business with the **combined** total (not one property's figures). This was a correctness fix — prove it.
- [ ] **Unallocated** UK rental entries are included in the combined total.

### Foreign property 🔴 (NEVER verified against HMRC — highest priority)
- [ ] Single foreign property, single country (e.g. France/FRA) — body shape accepted by HMRC.
- [ ] **Multiple foreign properties, different countries** — files as ONE business with a per-country array.
- [ ] Property with an **unrecognised/blank country** → skipped with a clear message, NOT filed with a bad code.
- [ ] Consolidated vs itemised foreign expenses both accepted.
- [ ] **If HMRC rejects the body:** adjust ONLY `lib/mtdIt/hmrcBody.ts` (the envelope is isolated there) and re-test.

## 5. Cumulative / amendment behaviour 🟡

- [ ] File Q1, then file Q2 — confirm Q2 carries the **year-to-date cumulative** figures (not just Q2's).
- [ ] Re-submit an already-filed quarter (after an edit) — confirm it **amends** at HMRC and records a new `mtd_it_submissions` row.
- [ ] Quarter flips to `submitted` only when **every** business filed successfully (partial filing leaves status as-is).

## 6. Figures match what was approved 🟡

- [ ] Submit-modal preview figures == the P&L the client approved == the email/PDF == what HMRC receives.
- [ ] Flagged (unresolved) entries are **excluded** from the filed figures.
- [ ] FX-converted foreign amounts file in GBP at the entered rate.

## 7. Pre-submit sanity checks (non-blocking warnings) ⚪

- [ ] Flagged-excluded warning shows when a stream has unresolved flags.
- [ ] Nil-update, zero-income-with-expenses, and loss (expenses > income) warnings each appear in the right cases.
- [ ] Co-owner share < 100% warning shows.
- [ ] Consolidated-over-£90k warning shows when combined income ≥ limit.

## 8. Status integrity 🟡

- [ ] Re-open a **submitted** quarter → it opens **read-only** ("Filed with HMRC — view only"); Expenses/Flagged tabs and rows can be **viewed**; nothing editable until **Amend**.
- [ ] Re-opening / saving a submitted quarter does **not** regress its status (stays `submitted`).
- [ ] A stale approval link clicked on an already-submitted quarter does **not** drag it back to `approved`.

## 9. Client approval flow (end-to-end) 🟡

- [ ] Send approval → client receives email (from the preparer's Gmail) + PDF.
- [ ] Approval page shows only **active** streams (a removed stream must not appear).
- [ ] Client **Approves** → preparer gets bell notification + email; quarter → `approved`; dashboard shows it.
- [ ] Bell notification **deep-links** to the quarter with the Submit modal open (`?submit=1`).
- [ ] Client **Requests changes** (with a note) → preparer notified with the note; quarter stays `sent`.
- [ ] "Ready to file" dashboard pill counts approved-but-unfiled quarters and filters to them.

## 10. Data integrity 🟡

- [ ] Toggling a stream **off** that has entries → confirm dialog → entries **deleted**; approval page & filing no longer include them.
- [ ] Save-to-records (Drive/Vault) writes the P&L + pack + source docs.

## 11. Fraud-prevention headers 🔴 (required for production)

- [ ] Run submissions through HMRC's **"Test Fraud Prevention Headers"** API and confirm the `Gov-Client-*` / `Gov-Vendor-*` headers **pass validation**.
- [ ] Headers describe the **agent's** device/connection (collected in the agent's browser at submit time) — not the client's.

## 12. Exit criteria → ready to request production

- [ ] All 🔴 items green (esp. foreign property + multi-UK-property + fraud headers).
- [ ] At least one clean end-to-end run per business type.
- [ ] Fraud-header check passed.
- [ ] Team SOP written (when to submit, reading the warnings, handling HMRC rejections).
- [ ] Go-live URL checklist actioned for the production domain (redirect URI, site URL, OAuth callbacks).
- [ ] **Then:** apply for HMRC production approval. After approval → set `HMRC_ENV=production` + production credentials → pilot on 1–2 low-risk real clients for one quarter before team-wide rollout.

---

### Sandbox tips
- Empty obligations? Add a `Gov-Test-Scenario` header (the submit/obligations routes already support a `testScenario` opt — there's a scenario selector in the submit modal).
- Submissions are **irreversible in production** — never point at production until every box above is green and HMRC has approved.
- The foreign-property cumulative body is the one piece never validated by HMRC; treat section 4 (foreign) as the make-or-break.
