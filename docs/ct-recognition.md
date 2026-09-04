# CT600 — HMRC recognition & schema-validation brief

Phase F of the CT600 e-filing work (see `docs/ct-filing.md`). The `lib/hmrc-ct`
code is built end-to-end but its wire format is **provisional**. This is what to
validate it against, and how to get HMRC recognition to file. Nothing here is a
code change — it's the external, HMRC-facing track.

> All version numbers below were current as of Sept 2026 — re-check the GOV.UK
> pages before you start; HMRC bump the artefacts and taxonomies periodically.

## 1. What to validate our output against

Our three provisional wire-format surfaces and the authoritative source that
corrects each:

| Our file (provisional) | Validate against | Current version |
|---|---|---|
| `lib/hmrc-ct/ct600Return.ts` — CT600 XML element names | **CT600 RIM artefacts** (XML Schema/XSD + Schematron) | CT600 V3 (2026) Artefacts **V1.994**, 10 Oct 2025 — live |
| `lib/hmrc-ct/computationIxbrl.ts` — `COMP_CONCEPTS` QNames + namespace + schemaRef | **CT computational taxonomy** (validate with Arelle) | **CT computational 2025** (periods from 1 Apr 2025); pack e.g. `CT20xx-v1.x.x.zip` |
| `lib/hmrc-ct/attachments.ts` + `gateway.ts` — `<AttachedFiles>` / GovTalk shapes | **CT Online XBRL & iXBRL Technical Pack** + **valid XML samples** | Technical Pack updated 15 May 2026; samples 25 Jan 2023 |

⚠ **Known likely-wrong today:** the computation-iXBRL namespace is a placeholder
`http://www.hmrc.gov.uk/schemas/ct/comp/2023-01-01`. The real namespace + entry
point come from the **CT computational 2024/2025** taxonomy pack — replace both
`NS['ct-comp']` and `COMP_SCHEMA_REF` in `computationIxbrl.ts` with the values the
pack declares, then re-resolve every `COMP_CONCEPTS` QName against it in Arelle.

**Accounts iXBRL note:** HMRC now accepts **FRC 2024/2025/2026** account
taxonomies. Accounts Studio (`lib/accounts-studio/ixbrl.ts`) currently emits FRC
2023 — confirm that's still accepted for the target period, or bump it. This is an
Accounts Studio concern, surfaced here because the CT600 attaches its output.

### Sources
- CT600 RIM artefacts (XSD + Schematron): https://www.gov.uk/government/publications/corporation-tax-technical-specifications-ct600-rim-artefacts
- CT600 valid XML samples: https://www.gov.uk/government/publications/corporation-tax-technical-specifications-ct600-valid-xml-samples
- CT600 appendices: https://www.gov.uk/government/publications/corporation-tax-technical-specifications-ct600-appendices
- CT technical specs in XBRL/iXBRL format: https://www.gov.uk/government/publications/corporation-tax-technical-specifications-in-xbrl-and-ixbrl-format
- Taxonomies accepted by HMRC (CT computational + FRC versions): https://www.gov.uk/government/publications/taxonomies-accepted-by-hm-revenue-and-customs/taxonomies-accepted-by-hmrc
- Developer collection hub: https://www.gov.uk/government/collections/corporation-tax-online-support-for-software-developers
- Local Test Service (LTS) + update manager: search "Local Test Service and LTS update manager" on GOV.UK

## 2. The recognition process (SDST)

HMRC "approval to file" = **software recognition**, run by the **Software
Developers Support Team (SDST)** — the same team behind the SA100/TPVS work.

1. **Register as a software developer** → SDST allocates a **4-digit CT vendor ID**
   and issues **test credentials**. This is a SEPARATE vendor ID from the SA100
   one (`9626`) and the Companies House presenter account.
   - Register: https://www.gov.uk/government/collections/register-as-a-software-developer
   - Contact: **SDSTeam@hmrc.gov.uk** (aim to reply within 2 working days)
2. **Test against LTS / TPVS.** The RIM artefacts V1.994 support both the Local
   Test Service (offline validation) and the Third Party Validation Service.
   Iterate the wire format until submissions validate clean.
3. **Apply for recognition** — submit the SDST-provided **test scenarios** through
   the test service. Passing them is recognition; recognised products are listed
   on GOV.UK.
4. **Production credentials** — create a Production application in the HMRC
   Developer Hub, accept the terms of use, get production creds. Then set
   `HMRC_CT_ENV=production` + the firm's real Gateway CT-agent creds and file one
   real return (irreversible) on a pilot company.
   - Basic XML developer guide: https://www.gov.uk/guidance/basic-guide-for-xml-software-developers
   - Software developers enquiries: https://www.gov.uk/find-hmrc-contacts/software-developers-enquiries

> SA100 precedent (2026-08): HMRC/SDST told us recognition was **not** a strict
> go-live prerequisite for SA — production creds + one real return sufficed. CT
> may differ; confirm the CT-specific gate with SDST when you register.

## 3. Checklist

**Start now (long pole — HMRC-side lead time):**
- [ ] Email SDSTeam@hmrc.gov.uk / register as a software developer for **Corporation Tax Online (CT600)**.
- [ ] Obtain the **4-digit CT vendor ID** + LTS/TPVS test credentials.
- [ ] Download the SDST **test scenarios** for CT600 V3.

**Validation loop (our side — before/while HMRC responds):**
- [ ] Download **CT600 RIM artefacts V1.994**; validate `ct600Return.ts` output against the XSD + Schematron.
- [ ] Download the **CT computational 2025** taxonomy; in Arelle, fix `computationIxbrl.ts` namespace/schemaRef + every `COMP_CONCEPTS` QName.
- [ ] Confirm the **accounts iXBRL** (Accounts Studio) validates against an accepted FRC taxonomy for the period.
- [ ] Diff our GovTalk envelope + `<AttachedFiles>` against the **valid XML samples** + iXBRL Technical Pack.
- [ ] Set env: `HMRC_CT_VENDOR_ID`, `HMRC_CT_SENDER_ID`, `HMRC_CT_PASSWORD` (test), keep `HMRC_CT_ENV` unset (→ test endpoint).

**Recognition + go-live:**
- [ ] Submit the SDST test scenarios via TPVS until they pass.
- [ ] Apply for recognition; create a Developer Hub Production application; accept terms.
- [ ] Get production credentials; `HMRC_CT_ENV=production` + firm CT-agent creds.
- [ ] File one real CT600 on a **pilot company** (irreversible).

## Where the corrections land in code

Every provisional surface is isolated so a fix is one place:
- CT600 element names → `lib/hmrc-ct/ct600Return.ts`
- Computation taxonomy → `lib/hmrc-ct/computationIxbrl.ts` (`NS`, `COMP_SCHEMA_REF`, `COMP_CONCEPTS`)
- AttachedFiles shape → `lib/hmrc-ct/attachments.ts`
- GovTalk header/auth/ChannelRouting → `lib/hmrc-ct/gateway.ts`
- Vendor ID / endpoints / env → `lib/hmrc-ct/config.ts`
