# Tax Studio — HMRC MTD ITSA sandbox verification runbook

The live SA100 filing uses the HMRC **Individual Calculations (MTD) API v8.0** final-declaration
journey. The code paths match the published v8.0 spec, but **the retrieve-calculation response
shape has not been confirmed against a live sandbox response** — that's the main thing this runbook
verifies. Once you capture a real retrieve response, share it and the field mapping in
`summariseCalculation` (`lib/tax-studio/hmrc.ts`) can be locked exactly.

## The flow the code implements
1. **Trigger** — `POST /individuals/calculations/{nino}/self-assessment/{taxYear}/trigger/intent-to-finalise` → returns a `calculationId`.
2. **Retrieve** — `GET /individuals/calculations/{nino}/self-assessment/{taxYear}/{calculationId}` → the figures shown next to our computation.
3. **Final declaration** — `POST /individuals/calculations/{nino}/self-assessment/{taxYear}/{calculationId}/final-declaration` → crystallises (expect HTTP 204).

`{taxYear}` is HMRC format `2025-26`. Version is pinned in the `Accept` header; override with
`HMRC_ITSA_CALC_VERSION` if HMRC ships a newer one.

## 1. Environment (sandbox)
Set in `.env.local` (local) or Vercel env (deployed):
- `HMRC_ENV=sandbox`  ← keeps everything on `test-api.service.hmrc.gov.uk`
- `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET` — your HMRC sandbox application credentials
- `HMRC_REDIRECT_URI` — must match the redirect registered on the HMRC app (optional if auto-resolved)
- `HMRC_VENDOR_PUBLIC_IP` — optional; set to the server egress IP for cleaner fraud headers
- `HMRC_ITSA_CALC_VERSION` — optional; only if you need to pin a version other than `8.0`

Confirm the app has the **`read:self-assessment write:self-assessment`** scope (the existing MTD IT
connection already uses it — no new scope needed).

## 2. Create an HMRC sandbox test user
On the HMRC Developer Hub, create an **Individual** test user with MTD ITSA enrolment
(Create Test User API, or the hub's "Create test user" tool). Note its **NINO** and **UTR**.

## 3. Wire the test user into SMITH
1. Create (or pick) a client and set its **National Insurance number** (and UTR) to the test user's.
2. Connect HMRC Income Tax for that client via the existing HMRC connect flow (`/hmrc` → connect,
   or the MTD IT tool's connect). This stores the token in `hmrc_connections` (service `mtd_it`,
   kind `individual` by client, or the firm `agent` connection).
3. So HMRC has something to finalise, submit the test user's quarterly + annual updates for
   `2025/26` first (via the MTD IT tool). In sandbox you can also drive responses with
   `Gov-Test-Scenario` — see the HMRC API's test-scenario list.

## 4. Run it in Tax Studio
1. New SA100 return for that client, tax year **2025/26** → step to **Submit** (record client
   approval first, or the live button stays disabled).
2. **Calculate with HMRC** → triggers `intent-to-finalise`, retrieves the calc, and shows HMRC's
   figures next to our computation.
   - **Capture the retrieve response.** Easiest: watch the server logs / add a temporary
     `console.log(JSON.stringify(calc.json))` in `retrieveCalculation`, or inspect the HMRC call.
     Paste the `taxCalculation` block back to me — I'll confirm/adjust the field paths in
     `summariseCalculation` (currently probing `calculation.taxCalculation.totalIncomeTaxAndNicsDue`
     and a few fallbacks).
3. **Submit final declaration** → confirm the dialog. Expect HTTP **204**; the return flips to
   *Filed* and a row is written to `tax_studio_submissions` (with `is_test = true`).

## 5. What "passing" looks like
- Trigger returns a `calculationId` (HTTP 202/200).
- Retrieve returns a calculation and our summary shows non-null figures (if null, the field paths
  need adjusting — step 4.2).
- Final declaration returns 204 and a receipt row appears in `tax_studio_submissions`.

## Notes / gotchas
- The UI doesn't currently send a `Gov-Test-Scenario`; both routes accept a `testScenario` field in
  the POST body if you want to add a scenario selector later.
- Final declaration is **irreversible** in production. `HMRC_ENV=sandbox` keeps it a no-op test.
- If HMRC rejects with "business income sources not submitted", the test user's quarterly/annual
  data for the year hasn't been filed yet — complete step 3.3 first.
