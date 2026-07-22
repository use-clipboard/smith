# Companies House filing — plan & iXBRL spike

Accounts Studio → file statutory accounts electronically with Companies House.
Timing matters: CH moves to **software-only filing from 1 April 2027** and
**all‑iXBRL by 1 April 2028**, so this is well‑timed.

## How CH software filing works

- **Channel:** CH **Software Filing via the XML Gateway** —
  `https://xmlgw.companieshouse.gov.uk/v1-0/xmlgw/Gateway`
  (test flag `1` for test submissions). A REST/JSON API is planned as a future
  replacement; the XML Gateway is the live route today.
- **Accounts payload:** **iXBRL**, tagged against the **FRC 2023 taxonomy suite**
  (v1.0.1, usable from 5 Apr 2023).
  > ⚠ **Verify the taxonomy version before correcting any QNames.** CH publish
  > *"Companies House technical interface specification (TIS) for accounts"*
  > **v5.9**, last updated **1 April 2026** — newer than the research this spike
  > was built on. It may mandate a later FRC suite than 2023. Read v5.9 first:
  > validating the concept map against the wrong taxonomy means doing it twice.
  > (ODT download from the TIS page linked below.)
- **Auth:** presenter ID + MD5‑coded authentication value; plus the company's
  authentication code for the specific filing.
- **Validation:** CH provides an **iXBRL accounts test validation service**
  (validates zip + single submissions, renders an image).
- **Go‑live / "recognition":** after successful test filing, apply for a **live
  online‑filing presenter account** → live presenter ID → CH sign‑off.

## Three phases

1. **iXBRL generation** (largest, the critical path) — tag the pack against
   FRC 2023, starting with **FRS 105 micro** + **FRS 102 Section 1A small**
   (smallest tag sets, highest volume). Validate against the taxonomy + CH rules.
2. **Sandbox submission** — register the test presenter, build the XML Gateway
   envelope (presenter ID + MD5 auth, test flag 1, company auth code, iXBRL
   attachment), submit, poll accept/reject, surface CH validation errors in the
   Publish stage. Pre‑validate via the iXBRL test service.
3. **Recognition + go‑live** — pass CH test sign‑off, apply for a live presenter
   account, store live/per‑firm credentials + per‑company auth codes securely,
   wire the "Submit to Companies House" action to the live path.

## iXBRL spike (started)

`lib/accounts-studio/ixbrl.ts` — `buildIxbrl(input)` produces a real Inline‑XBRL
XHTML document from an engagement's structured `FinancialStatements`:

- Correct **structure**: XHTML wrapper, `ix:header` with `link:schemaRef`
  (FRC entry point), `ix:resources` with `xbrli:context`s (entity id = company
  number under the CH scheme `http://www.companieshouse.gov.uk/`; current +
  prior duration/instant; creditor‑maturity dimensioned instants), a GBP unit,
  and inline `ix:nonFraction` / `ix:nonNumeric` facts.
- Tagged facts: company name + number, turnover, gross/operating profit, tax,
  profit for the year, fixed assets, current assets, creditors (within/after via
  the maturity dimension), net current assets, total assets less current
  liabilities, provisions, net assets, total equity.
- Try it: Accounts Studio → an engagement with imported statements → **Approve &
  Publish → iXBRL Accounts → Download (beta)**.

### ⚠ What still needs validating (the point of the spike)

The **CONCEPTS table + entry‑point URLs + the maturity dimension/members** are
best‑known and must be checked against the actual FRC 2023 taxonomy. Next step:
run a sample output through the **CH iXBRL test validation service** (or Arelle
loaded with the FRC 2023 taxonomy), then correct the QNames in the one table in
`ixbrl.ts` until it passes. The generator structure shouldn't need to change.

---

## Reference

- **Read first (the test-account requirements):**
  <https://www.gov.uk/government/publications/technical-interface-specifications-for-companies-house-software/important-information-for-software-developers-read-first>
- **Technical interface specifications (schemas):**
  <https://www.gov.uk/government/publications/technical-interface-specifications-for-companies-house-software>
  — *TIS* v5.3 · ***TIS for accounts* v5.9** (updated 1 Apr 2026) — the one we need.

## What CH require for a test account

Exactly five details — nothing more. From the "read first" guidance:

> the presenter's **name**, **contact name**, **address**, **email address**,
> **telephone number**

And on whose details to give:

> "Apart from the address, these are usually the developer's details. Our main
> contact during testing is usually the development team, and not the presenter
> or company."

So: address = the firm's office; the rest = whoever actually does the testing.

## Obligations once testing starts

- **Test flag = 1** on every test submission.
- **A unique submission (envelope) number per submission.**
- **Email CH when you've made test submissions** — they are reviewed **manually**
  and sit **pending** until someone at CH looks at them.

That last point matters for planning: this is not a self-serve sandbox with a
fast feedback loop. Every round trip costs a human at CH. Validate the iXBRL as
far as possible offline (CH iXBRL test validation service, or Arelle + the
correct FRC taxonomy) before spending submissions.

## Timeline

### 1. Request — SENT 09 Jul 2026

Sent to `xml@companieshouse.gov.uk` by Christos Marneros (Marneros Marcus & Co
Limited). Written as the firm (the presenter) developing its own filing
software.

> **To:** xml@companieshouse.gov.uk
> **Subject:** Request for XML Gateway test account — software accounts filing
>
> Dear Companies House XML team,
>
> We are **Marneros Marcus & Co Limited**, a UK accountancy practice developing
> our own software to file our clients' statutory accounts (iXBRL) electronically.
> We would like to request a **test account and test presenter credentials** for
> the XML Gateway, so we can develop and test accounts submissions against the
> test environment.
>
> Our presenter/organisation details are:
>
> - **Organisation / presenter name:** Marneros Marcus & Co Limited
> - **Contact name:** Christos Marneros
> - **Address:** [Firm registered office / business address]
> - **Email:** christos@marnerosmarcus.co.uk
> - **Telephone:** [Firm telephone]
>
> We intend to file **small‑company and micro‑entity accounts** (FRS 102
> Section 1A and FRS 105) tagged in iXBRL against the **FRC 2023 taxonomy suite**.
> Please could you activate a test account and send the **test presenter ID and
> authentication value**, along with any current **schema/version notes** for the
> accounts submission service and access to the **iXBRL accounts test validation
> service**.
>
> Many thanks,
>
> Christos Marneros
> Marneros Marcus & Co Limited

Note the address was filled in but the **telephone was left as a placeholder and
dropped**, and the email given (`christos@marnerosmarcus.co.uk`) differed from
the address it was sent from (`christos@mmandco.com`).

### 2. CH reply — received ~16 Jul 2026

From **Cloideach, Software Liaison Manager, XML Team**:

> Before we can issue a test account, please read the following guidance as you
> have not provided some key details we require before a test account can be
> created: *Important information for software developers - read first*
> […] Once I receive the full information, I will request a test account.

**Diagnosis:** of the five required details we supplied four. **The missing one
was the telephone number.** No other information is required — CH did not ask for
software name/version, transaction types, volumes or filing-agent status, and the
guidance doesn't request them.

### 3. Our reply — sent 16 Jul 2026

All five details restated in one block (CH asked for "the full information", so
re-sending the lot beats making them cross-reference the first email). The
`mmandco.com` / `marnerosmarcus.co.uk` split was resolved in favour of
**`christos@mmandco.com`** — the address CH already replied to — with a line
explaining that MM&Co is the trading name of Marneros Marcus & Co Limited so the
domain mismatch doesn't look like an error.

> - Presenter name:  Marneros Marcus & Co Limited
> - Contact name:    Christos Marneros
> - Address:         First Floor, Hagley Court, 40 Vicarage Road, Edgbaston,
>                    Birmingham, B15 3EZ
> - Email address:   christos@mmandco.com
> - Telephone:       0121 440 0800

Deliberately did **not** re-ask for schema/version notes or the validation
service — that's all on the page they pointed us at.

### 4. CH issued the test account — received 21 Jul 2026

From **Cloideach, Software Liaison Manager, XML Team**. Test presenter credentials
(store server-side only — they're in `.env.local` locally):

| Field | Value | Env var |
|---|---|---|
| Test Presenter ID | `66666651000` | `CH_XMLGW_PRESENTER_ID` |
| Authentication Value | `W2JKbT5LXjr` | `CH_XMLGW_AUTH_VALUE` |
| Test Flag | `1` | (derived from `CH_XMLGW_ENV=test`) |
| Test Package Reference | `0012` | `CH_XMLGW_PACKAGE_REF` |

Cloideach's rules: **submission numbers must be unique and incremental** (a reused
or out-of-order number = immediate rejection), and **email him when a test has
been submitted** so he can review it manually. Next step per CH: "tell me when
you have submitted tests so I can review them."

## Gateway plumbing — BUILT 21 Jul 2026

The XML Gateway submission layer is implemented (transport only — the iXBRL
payload's QNames still need validating, see below):

- **`lib/companiesHouse/config.ts`** — env-based presenter creds + `test`/`live`
  switch; `isChGatewayConfigured()`.
- **`lib/companiesHouse/gateway.ts`** — the wire format in one file. Builds the
  GovTalk envelope + FormSubmission, computes the **CHMD5** token
  (`md5(SenderID + AuthValue + TransactionID)`, lowercase hex — confirmed against
  the php-govtalk CompaniesHouse extension), POSTs to the gateway, parses the
  GovTalk response (Qualifier / CorrelationID / `<Error><Text>`).
- **`lib/accounts-studio/ixbrlFromEngagement.ts`** — single Engagement→iXBRL
  mapper shared by the Publish "Download (beta)" button and the submit route, so
  the reviewed document and the filed document are identical. Also holds the CH
  `CompanyType` code map (⚠ enum best-known).
- **`app/api/accounts-studio/engagements/[id]/ch-submit`** — regenerates the
  iXBRL server-side, allocates the next submission number, submits, and logs
  every attempt (success or rejection, with raw response + filed iXBRL).
- **Migration `20260778_ch_gateway_submissions.sql`** — audit-log table +
  `ch_gateway_submission_seq` sequence + `next_ch_submission_number()` allocator
  (one monotonic source feeds both SubmissionNumber and TransactionID).
- **Publish UI** — "File iXBRL to Companies House (Test)" with a company
  authentication-code input; shows the submission number on acceptance, or the
  CH rejection reason.

### ⚠ Verify against the schema on the first round-trip

The envelope structure + CHMD5 are from authoritative sources, but a few
`FormHeader` specifics are best-known and isolated with `⚠` comments — the CH
**`CompanyType`** enumeration, whether `CustomerReference` is required, and the
`Document` Category/ContentType casing. The first CH validation response is the
oracle: correct the flagged fields in `gateway.ts` / `ixbrlFromEngagement.ts`.

## iXBRL offline validation — DONE (FRS 102 1A + FRS 105) 21–22 Jul 2026

Validated with **Arelle 2.42.1** against the live **FRC 2023** taxonomy
(`--validate --calcDecimals`, i.e. XBRL Dimensions + calculation checks on).

- **FRS 102 Section 1A: CLEAN** — no errors, warnings or inconsistencies. Two
  real bugs were found and fixed in `lib/accounts-studio/ixbrl.ts`:
  1. `<xbrli:scenario>` was emitted **inside `<xbrli:entity>`** (invalid — XBRL
     2.1 puts scenario as a child of `<context>` after `<period>`). Fixed.
  2. `<style>` was missing the required `type="text/css"` attribute. Fixed.
- **Every concept QName resolved** against the taxonomy (no `missingReferences`),
  and the creditor-maturity dimension passed XBRL Dimensions validation — so the
  CONCEPTS table + maturity dimension in `ixbrl.ts` are confirmed correct. The
  `core`/`bus` namespace URIs match what the FRS-102 entry point imports.
- **How to reproduce:** `pip install arelle-release`, generate a sample from
  Publish → iXBRL → Download (beta), then
  `python -m arelle.CntlrCmdLine --validate --calcDecimals --file sample.html`.
  Articulate the figures (NetCurrentAssets = CurrentAssets − CreditorsWithin,
  etc.) or the calc linkbase flags inconsistencies.

- **FRS 105 (micro): CLEAN too** (fixed 22 Jul 2026). There is **no separate
  FRS-105 taxonomy** — micro-entity accounts tag against the **FRS-102 entry
  point** (the FRC "UK GAAP" taxonomy carries both small-company and micro
  concepts). That's why every `/FRS-105/…` URL 403'd — it doesn't exist. Fixed
  `ENTRY_POINTS['frs105']` to point at the FRS-102 entry point; the FRS 105 sample
  now validates clean under Arelle (dims + calc). Confirmed via SureFile Accounts'
  supported-taxonomy list (lists "FRS 102/FRS 105" under one entry point) + FRC
  digital-reporting guidance.

### ⚠ Still outstanding on the iXBRL

- **Companies House business rules** are a separate layer ON TOP of taxonomy
  validity — CH require mandatory content (balance-sheet statements, director
  approval name, accountant's report, etc.) that a minimal fact set omits. The CH
  iXBRL validation service / first test submission is what surfaces those; extend
  the tagged facts in `ixbrl.ts` to satisfy them.

## Envelope schema-validated — DONE 22 Jul 2026

The generated GovTalk submission validates CLEAN offline (Python `xmlschema`)
against BOTH CH schemas: the envelope (`Egov_ch-v2-0.xsd`) and the FormSubmission
body (`FormSubmission-v2-11.xsd`). Three real bugs were found from the schema and
fixed before any submission:

- **`CompanyType`** — the LLP mapping returned `'LLEW'` (invalid). Valid enum is
  `EW/SC/NI/R/OC/SO/NC`; `chCompanyType()` now derives it from the entity type +
  company-number prefix (LLP → `OC`/`SO`/`NC`; company → `EW`/`SC`/`NI`).
- **`SubmissionNumber`** — schema requires EXACTLY 6 chars; the sequence value is
  now zero-padded (`000001`). The raw numeric value remains the GovTalk
  TransactionID / CHMD5 nonce.
- **`Filename`** — schema caps it at 32 chars; now `accounts-<number>.xhtml`.
- Also: `CompanyNumber` is `xs:integer` (digits only) → the jurisdiction prefix
  is stripped (conveyed by `CompanyType` instead). ⚠ For real Scottish/NI/LLP
  companies confirm CH wants the digits without the prefix (fine for dummy tests).

## CH confirmed: use dummy data — reply 22 Jul 2026 (Ioan, XML Team)

> For XML Gateway testing, you can use dummy company data and authentication
> codes… There is no specific test company number or authentication code you must
> use… Once you have submitted your test filing, please send us the submission
> number and we will review the submission.

So we are **unblocked for the first test submission** — no dependency on CH
providing a test company. Use any dummy 8-digit company number + a 6–8 char
dummy auth code.

## Next steps (in order)

1. **First test submission** — with `.env.local` creds set (they are), use the
   Publish → "File iXBRL to Companies House (Test)" button on a prepared FRS 102
   1A engagement, with a dummy company auth code. Read the gateway response.
2. **Email the XML team** (xml@companieshouse.gov.uk) with the submission number
   so they review it. Iterate on any CH business-rule feedback.
3. **Read *TIS for accounts* v5.9** (2023 suite still accepted, so not urgent).
4. **Fix the FRS-105 entry point** — DONE (shares the FRS-102 entry point).
5. **Poll for outcome** — add a GetSubmissionStatus poll using the stored
   CorrelationID (not built yet; manual review means the ack is the realistic
   first signal). Then apply for the **live** presenter account.
