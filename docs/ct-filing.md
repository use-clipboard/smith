# CT600 filing — `lib/hmrc-ct` build plan

Tax Studio → file **CT600 Company Tax Returns** electronically with HMRC's
Corporation Tax Online service.

Where we are today: the CT600 module is a **preparation + computation** tool. The
calculation engine (`computeCt600`) and the on-screen box-for-box facsimile are
built and correctness-reviewed (marginal relief with prorated limits / associated
companies / augmented profits, boxes 165/225/230/235/600, filing-date maths — all
fixed Aug 2026). The `StageSubmitCt600` "online filing" card is **"coming soon"**;
the only working action is **mark-as-filed**. Nothing is transmitted to HMRC yet.

This plan builds the transmission stack, mirroring the **working SA100 pipeline**
(`lib/hmrc-sa`, `app/api/tax-studio/returns/[id]/sa-submit`). Read that first — it
is the template for almost everything here.

## How CT600 software filing works

- **Channel:** HMRC **Corporation Tax Online** over the **GovTalk / Transaction
  Engine** — the same transport as SA100 (`lib/hmrc-sa/gateway.ts`), a different
  **message class** (`CT-CT600`) and endpoint. Test (TPVS) vs production is an env
  switch, exactly like `HMRC_SA_ENV`.
- **Payload:** the CT600 return as HMRC-schema XML **plus two embedded iXBRL
  attachments** — the **statutory accounts** and the **tax computation**. This
  attachment requirement is the one real difference from SA100 (SA100 is form XML
  only).
- **Accounts iXBRL:** tagged to the **FRC taxonomy suite** — we already generate
  this in Accounts Studio (`lib/accounts-studio/ixbrl.ts`). Task is to source the
  right accounts for the company/period and attach, not build anew.
- **Computation iXBRL:** tagged to HMRC's **CT computational taxonomy** — **net
  new.** Today only the human-readable `components/features/tax-studio/ct600ComputationPdf.ts`
  exists. This is the biggest single work item and the main technical risk.
- **Auth:** per-firm Government Gateway credentials + an HMRC-issued **CT vendor /
  product ID** (separate from the SA100 vendor `9626`, the CH presenter account,
  and the MTD OAuth creds).
- **IRmark:** a digest over the submission — algorithm is common with SA
  (`lib/hmrc-sa/irmark.ts`), reusable as-is.
- **Recognition / "permission":** after a valid submission passes HMRC's CT test
  scenarios (test-in-live), register the vendor product for recognition, then go
  live on a pilot company. This is the actual permission step and **cannot start
  until a valid submission exists** (Phases A–E).

## The SA100 → CT600 mirror

| SA100 (exists) | CT600 (to build) | Reuse |
|---|---|---|
| `lib/hmrc-sa/config.ts` | `lib/hmrc-ct/config.ts` — `HMRC_CT_ENV`, CT Online URLs, CT vendor id | copy + retarget |
| `lib/hmrc-sa/xml.ts` | `lib/hmrc-ct/xml.ts` | mostly reusable |
| `lib/hmrc-sa/sa100Return.ts` + `pages/*` | `lib/hmrc-ct/ct600Return.ts` — `Ct600Data` → CT600 schema (box→element) | new; data model ready |
| `lib/hmrc-sa/irmark.ts` | `lib/hmrc-ct/irmark.ts` | **as-is** |
| `lib/hmrc-sa/gateway.ts` | `lib/hmrc-ct/gateway.ts` — GovTalk, class `CT-CT600` | copy + swap class/endpoint |
| `getSaCredsForFirm.ts` + `firms_sa_filing_credentials` | `getCtCredsForFirm.ts` + `firms_ct_filing_credentials` | copy (same `lib/crypto/secretBox.ts` AES-GCM) |
| `sa-submit/route.ts` | `ct-submit/route.ts` | copy orchestration |
| `cron/sa-poll` + `tax_studio_sa_submissions` | `cron/ct-poll` + `tax_studio_ct_submissions` | copy |
| Settings → SA credentials (`app/api/firms/sa-filing`) | Settings → CT credentials (`app/api/firms/ct-filing`) | copy UI |
| — (SA100 has no attachments) | **accounts iXBRL + computation iXBRL** | ★ the new work |

## Proposed layout

```
lib/hmrc-ct/
  config.ts             env + CT Online endpoints + vendor id
  ct600Return.ts        Ct600Data → CT600 schema XML (box → element)
  computationIxbrl.ts   computeCt600 result → iXBRL (CT computational taxonomy)   ★ new/hard
  accountsIxbrl.ts      adapter over lib/accounts-studio/ixbrl.ts (source + attach)
  gateway.ts            GovTalk envelope (class CT-CT600) + submit/poll/delete
  irmark.ts             lifted from lib/hmrc-sa/irmark.ts
  getCtCredsForFirm.ts  per-firm Gateway creds (secretBox)
app/api/tax-studio/returns/[id]/ct-submit/route.ts
app/api/cron/ct-poll/route.ts
app/api/firms/ct-filing/route.ts                    settings CRUD
supabase/migrations/…_tax_studio_ct_submissions.sql
supabase/migrations/…_firms_ct_filing_credentials.sql
```

## Phases

- **Phase A — CT600 XML** (medium). `ct600Return.ts`: box→element serialiser,
  validated against HMRC's CT600 XSD. Low-risk — the box audit (Aug 2026) already
  reconciled the return.
- **Phase B — Computation iXBRL** (large, critical path). `computationIxbrl.ts`
  tagged to the CT computational taxonomy. The hard part; HMRC's validator is
  strictest here. Budget the most time and a tight validator loop.
  > ⚠ **Verify the taxonomy version before tagging.** Pin the exact HMRC CT
  > computational taxonomy version current at build time and validate the concept
  > map against it — tagging against the wrong suite means doing it twice.
- **Phase C — Accounts iXBRL wiring** (small–medium). Source the period's accounts
  from Accounts Studio and attach. Decide the fallback for companies not in SMITH.
- **Phase D — Transport** (small). Lift `gateway.ts` / `irmark.ts`, swap message
  class + endpoint, assemble the envelope with both iXBRL attachments.
- **Phase E — Persistence + creds + UI** (medium). `tax_studio_ct_submissions`
  table, `cron/ct-poll` fallback, encrypted per-firm CT credentials + settings
  tab, and wire `StageSubmitCt600` to a real submit (replace "coming soon" /
  mark-as-filed). Add a hard pre-submission validation gate (required boxes: UTR,
  CRN, period, declaration) — the soft "readiness" gate is not enough for filing.
- **Phase F — Recognition + test-in-live** (external, gated). Register the CT600
  vendor product with HMRC, pass the CT test scenarios against the test endpoint,
  then go live on a pilot company. Up to "Mark as filed" already exists; this is
  the actual permission.

## Decisions before starting

1. **Accounts source for the iXBRL** — always Accounts Studio, or allow an uploaded
   iXBRL/PDF for companies whose accounts aren't in SMITH?
2. **Vendor ID** — CT600 needs its own HMRC vendor/product registration. Start that
   paperwork **in parallel with Phase A** — it's the long pole.
3. **First live filing scope** — a **micro-entity (FRS 105)** pilot keeps the
   accounts-iXBRL tagging simplest for the first real (irreversible) submission.

## Not modelled by the calc engine (out of scope until needed)

`computeCt600` notes these on-screen; they are not computed: **group relief**,
**quarterly instalment payments**, **ring-fence profits**. A CT600 that needs any
of these should not be filed from SMITH until the engine covers them.

## Critical path

**B (computation iXBRL) → F (recognition testing).** Everything else is
well-trodden SA100 ground. Cross-refs: `lib/hmrc-sa/*`,
`app/api/tax-studio/returns/[id]/sa-submit/route.ts`, `docs/sa100-filing.md`,
`docs/ch-filing.md` (the other iXBRL channel).
