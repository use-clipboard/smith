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

## Draft — CH test‑account request email

> **To:** xml@companieshouse.gov.uk
> **Subject:** Request for XML Gateway test account — software accounts filing
>
> Dear Companies House XML team,
>
> We are developing software to file statutory accounts (iXBRL) electronically
> and would like to request a **test account and test presenter credentials** for
> the XML Gateway so we can develop and test accounts submissions against the
> test environment.
>
> Our presenter/organisation details are:
>
> - **Organisation / presenter name:** [Firm name — e.g. Marneros Marcus & Co]
> - **Contact name:** Christos Marneros
> - **Address:** [Firm registered office address]
> - **Email:** christos@marnerosmarcus.co.uk
> - **Telephone:** [Firm telephone]
>
> We intend to file **small‑company and micro‑entity accounts** (FRS 102
> Section 1A and FRS 105) tagged in iXBRL against the FRC 2023 taxonomy suite.
> Could you please activate a test account and send the test presenter ID and
> authentication value, along with any current schema/version notes for the
> accounts submission service and access to the iXBRL accounts test validation
> service.
>
> Many thanks,
>
> Christos Marneros
> [Firm name]

_Fill the [bracketed] fields before sending. CH will activate the account and
return test presenter credentials; test submissions use test flag = 1._
