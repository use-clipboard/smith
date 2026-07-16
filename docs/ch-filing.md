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

**→ AWAITING** test presenter ID + authentication value.

## Next steps (in order)

1. **Read *TIS for accounts* v5.9** (1 Apr 2026) and confirm which FRC taxonomy
   suite it mandates — this gates step 3, so do it first even while waiting.
2. When the test presenter credentials arrive, download a sample from
   Accounts Studio → Approve & Publish → iXBRL → **Download (beta)**.
3. Run it through the CH iXBRL test validation service (or Arelle + the correct
   FRC taxonomy) and correct the CONCEPTS / entry-point / dimension QNames in
   `lib/accounts-studio/ixbrl.ts` until it passes. The generator's structure
   shouldn't need to change — only that one table.
4. Build the XML Gateway envelope (presenter ID + MD5 auth, **test flag 1**,
   unique envelope number, company auth code, iXBRL attachment); submit; email CH
   to have it reviewed; surface their validation errors in the Publish stage.
