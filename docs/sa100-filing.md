# Legacy SA100 online filing (Tax Studio)

Status: **Phase 1 ~half (5 of ~10 pages); Phase 2 (IRmark + gateway) DONE** · Next: remaining pages + Phase 3 submit route · Target tax year: **2025/26** · Owner: Tax Studio

Tax Studio's Self Assessment section files the **legacy SA100** return to HMRC —
the traditional Government Gateway route used by TaxCalc/Taxfiler/IRIS, for
clients who are **not** on Making Tax Digital. (MTD-ITSA is handled by the
separate **MTD IT** tool via the modern REST API; do not conflate the two.)

## The two regimes (why this is separate from MTD)

| | MTD for Income Tax | Legacy SA100 (this project) |
|---|---|---|
| Home in SMITH | **MTD IT tool** | **Tax Studio → SA** |
| Transport | REST/OAuth/JSON, `api.service.hmrc.gov.uk` | GovTalk XML over HMRC Transaction Engine |
| The "return" | quarterly updates + Final Declaration (crystallisation) | one SA100 XML document (core + supplementary pages) |
| Integrity | OAuth bearer token | Government Gateway credentials + **IRmark** |
| Who | MTD-mandated clients (£50k+ Apr-2026, £30k+ 2027…) | everyone else still on SA online filing |

## Wire protocol (GovTalk Transaction Engine — same family as our CH filer)

The HMRC Transaction Engine speaks the **same GovTalk dialect** as the Companies
House gateway we already run (`lib/companiesHouse/gateway.ts`): a
`<GovTalkMessage>` envelope with `request`/`acknowledgement`/`response`/`error`
qualifiers, a `CorrelationID` and a `PollInterval`. So we copy that shape and
change the specifics:

- `EnvelopeVersion` **2.0**; `MessageDetails/Class` = **`HMRC-SA-SA100`**;
  `Qualifier` = `request`→`poll`→(on success)`delete`; `Function` = `submit`;
  `GatewayTest` flag for TPVS.
- `SenderDetails/IDAuthentication` = the **agent's Government Gateway** SA
  credentials (SenderID = gateway user id; `Method` `clear`/`MD5`; Value =
  password). NB this is the *old-style* SA-agent account, **not** the MTD Agent
  Services Account.
- `GovTalkDetails/Keys` = the taxpayer **UTR**; `ChannelRouting` = our
  vendor product + **Vendor ID** (from HMRC recognition).
- `Body` = `<IRenvelope>` → `<IRheader>` (Keys/UTR, PeriodEnd, DefaultCurrency,
  **IRmark**, Sender) + the `<SA100>` return per HMRC's year-specific schema.

**Asynchronous:** submit → HMRC returns an *acknowledgement* with a CorrelationID
+ PollInterval → we **poll** until `response` (success + receipt) or `error` →
`delete` to clear the queue. (Reuse the CH poll pattern; bounded in-request loop
+ a cron fallback for deferred responses.)

Endpoints (confirm current URLs with HMRC docs):
- **TPVS** (Third Party Validation Service, test): `https://test-transaction-engine.tax.service.gov.uk/submission`
- **Live**: `https://transaction-engine.tax.service.gov.uk/submission`

## IRmark (the trickiest new piece)

HMRC requires an **IRmark** integrity hash inside `IRheader`:
`<IRmark Type="generic">{base64}</IRmark>`. Algorithm: take the `<IRenvelope>`,
strip any existing IRmark, **exclusive XML canonicalisation (xml-exc-c14n)**,
**SHA-1** digest, **base64**. HMRC recomputes and compares. Canonicalisation
byte-exactness is the classic gotcha — plan to use a battle-tested c14n library
rather than hand-rolling.

## What we reuse vs. build new

**Reuse:** GovTalk envelope/poll/response machinery (`lib/companiesHouse/gateway.ts`
as the template); Tax Studio's existing box model + `computeSa100Full` (every
SA100 box is already modelled — this is *mapping*, not modelling); the
`hmrc_connections` / `*_submissions` / audit-log patterns; the `StageSubmit.tsx`
card layout.

**New:** IRmark module; SA100 XSD mapping (core + SA102/103/104/105/106/108/109/110/101);
Gov Gateway SA-agent auth + per-client 64-8 authorisation; the async submission
route + receipts table; HMRC **SA** software recognition (separate approval from
MTD/VAT).

## Phases

- **Phase 0 — HMRC groundwork (long pole, start now):** register with HMRC SDS as
  a recognised SA developer; obtain Vendor ID, the **2025/26 SA100 XSD**, test
  scenarios, and TPVS access. Confirm the firm's Gov Gateway SA-agent creds and
  which clients have 64-8 authorisation.
- **Phase 1 — SA100 XML generator (~half):** `lib/hmrc-sa/pages/` — DONE: core
  SA100 + SA102/103/104/105/108. TODO: SA106 (foreign), SA101 (additional info),
  SA109 (residence), SA110 (tax calc — needs computed boxes from
  `computeSa100Full`), SA107 (trusts). Validate against the XSD offline once
  obtained (Phase 0).
- **Phase 2 — GovTalk envelope + IRmark + auth: DONE.** `lib/hmrc-sa/irmark.ts`
  (inclusive C14N via xml-crypto, byte-exact + validated) and
  `lib/hmrc-sa/gateway.ts` + `config.ts` (GovTalkMessage build, Gov-Gateway clear
  auth, submit/poll/delete, response parse — modelled on the CH gateway). Full
  pipeline smoke-tests end to end. Header ordering / auth Role / ChannelRouting
  shape provisional pending TPVS.
- **Phase 3 — Submission route:** `app/api/tax-studio/returns/[id]/sa-submit` —
  build → wrap → IRmark → submit → poll/delete; `tax_studio_sa_submissions`
  receipts table; encrypted Gov-Gateway cred storage.
- **Phase 4 — StageSubmit UI:** "File SA100 online with HMRC" card (preview →
  submit → progress → receipt); make legacy SA the primary path; retire the MTD
  card from Tax Studio (MTD lives in the MTD IT tool).
- **Phase 5 — TPVS → recognition → live:** iterate against TPVS test scenarios
  (first response is the oracle for business rules, as with CH), get recognition,
  then production creds + a pilot on our own firm (**first live submit is
  irreversible**).

## Risks
1. **IRmark canonicalisation** — byte-exactness is fiddly.
2. **SA100 schema is large** + has business rules beyond the XSD → expect TPVS iteration.
3. **HMRC recognition** — external lead time (Phase 0 starts immediately).
4. **XSD is year-specific** — mapping + recognition may repeat per year.

## Decisions
- 2026-08-18: Target **2025/26** first. Tax Studio SA = **legacy SA100 only**;
  MTD stays in the MTD IT tool. Existing MTD final-declaration code in Tax Studio
  (`lib/tax-studio/hmrc.ts`, `hmrc-calculate`/`hmrc-submit` routes, LiveHmrcCard)
  left intact for now; the MTD card gets retired from the Tax Studio Submit UI at
  Phase 4.
