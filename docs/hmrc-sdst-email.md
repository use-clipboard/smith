# HMRC SDST — Self Assessment (SA100) recognition request (draft email)

Sent by SMITH (the software developer/vendor) to add Self Assessment to its
existing HMRC developer registration. Fill the **[bracketed]** placeholders
before sending. See `docs/sa100-filing.md` for the wider plan.

**Still to fill before sending:**
- `[contact email]`, `[phone]` — for Christos.
- `[Firm legal name]`, `[firm agent reference]` — your accountancy practice (the
  first filing agent), e.g. Marneros Marcus + its HMRC SA-agent Government
  Gateway ID / agent code.

**Already filled:** developer = SMITH FOR ACCOUNTANTS LIMITED (company number
17263270); signatory = Christos Marneros, Director; Developer Hub app = "SMITH"
(account holder Christos Marneros).

---

**To:** sdsteam@hmrc.gov.uk  *(confirm the current address on GOV.UK — "Self Assessment: commercial software suppliers" / Software Developers Support Team)*

**Subject:** Add Self Assessment (SA100) to our existing developer registration — SMITH, tax year 2025–26

Dear Software Developers Support Team,

We are an existing HMRC software developer. Our software product, **SMITH** (smithforaccountants.co.uk), is developed by **SMITH FOR ACCOUNTANTS LIMITED** (company number 17263270), and is already registered and integrated for **Making Tax Digital for Income Tax (ITSA)** and **Making Tax Digital for VAT**. For reference, our recent correspondence with HMRC includes MTD ITSA ref **2026-DRG358** and VAT fraud-prevention-headers case **CMQAA-827**. Our application on the HMRC Developer Hub is named **SMITH** (account holder: Christos Marneros).

We would like to **add Self Assessment (SA100) individual return online filing** — the legacy Transaction Engine / GovTalk route — to our existing developer account, for the **2025–26** tax year, to serve clients who are not within Making Tax Digital for Income Tax.

**What we're requesting**

1. Addition of the **Self Assessment (SA100)** service to our existing SMITH developer registration.
2. **Vendor ID:** as we have previously integrated only via the MTD REST APIs, we do not hold a legacy Transaction Engine Vendor ID. Please confirm whether one is required for the SA100 GovTalk route and, if so, issue one to us.
3. The **technical pack / schemas (XSD)** for the **2025–26 SA100** return and its supplementary pages (SA101–SA110), together with the current **IRmark** and GovTalk submission specifications.
4. The **test scenarios / test data** required for recognition.
5. Access to the **test services** — TPVS (Third-Party Validation Service) and the Self Assessment test Transaction Engine — so we can validate submissions ahead of recognition.

We have already implemented SA100 return generation, IRmark (per your "IRmark Generation Step-by-Step Guide"), and the GovTalk submission and polling flow, so we are ready to begin validation as soon as we have the schema and test access.

The software will be used first by our associated accountancy practice, **[Firm legal name]** (agent reference **[firm agent reference]**), acting as the filing agent, with wider availability to other accountancy firms planned.

Could you also confirm the current expected timeline for Self Assessment recognition and any additional requirements (for example, a declaration of conformance) that we should prepare?

Many thanks for your help.

Kind regards,

**Christos Marneros**
Director — for and on behalf of SMITH FOR ACCOUNTANTS LIMITED (company number 17263270)
[contact email] · [phone]
