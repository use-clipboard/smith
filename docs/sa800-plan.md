# SA800 Partnership Tax Return — build plan

New Tax Studio module: prepare (and later file) the **SA800 Partnership Tax
Return**, following the same shape as the SA100 and CT600 modules already in the
tool. UI/layout mirror those; income can be **linked from Accounts Studio
(partnership accounts) or the Bookkeeping tool**, with tabs auto-filled from the
link or completed manually — populating the return's boxes.

Source of truth for boxes: **SA800 (2026) form** + **SA850 Partnership Tax Return
Guide (2026)**. Box numbers below are the HMRC ones.

## What SA800 is

A partnership is **tax-transparent** — it pays no tax itself. The SA800 reports
the partnership's income, then a **Partnership Statement** allocates each partner
their share. Each partner reports their share on the **SA104** of their own SA100
(or a CT600 for a corporate partner). SMITH already does the *downstream* half
(entity→SA104 feed); SA800 is the missing upstream, and becomes the authoritative
source for that feed.

## The form (SA800 core = pages 1–8)

- **Page 2 — Partnership details + trigger questions.** Business name (box), trade
  description, started/ceased (3.7/3.8), traditional-accounting tick (3.9),
  accounting period (3.4/3.5), Q1–Q7 supplementary-page triggers.
- **Page 3 — Trading (short) + capital allowances.** 3-line account for turnover
  < £90k (3.24–3.26); CA summary 3.13A–3.23 (AIA 3.14A, 18% 3.16, 6% 3.18,
  zero-emission 3.16A/3.18A, SBA 3.20/3.21, charge-point 3.18B, total 3.22 /
  balancing charges 3.23). **The CA boxes map onto `computeCapitalAllowances`.**
- **Page 4 — Trading (full) P&L** for turnover £90k–£15m (boxes 3.29–3.73):
  sales, cost of sales/subcontractor/other-direct, gross profit, 16 expense rows
  with a disallowable column (3.30–3.45 disallowable / 3.51–3.63 total), tax
  adjustments → net business profit for tax 3.73. **Mirrors SA103F.**
- **Page 5 — Taxable profit + balance sheet + charges.** Adjustment on change of
  basis 3.82, net profit 3.83 / allowable loss 3.84, provisional 3.93, CIS 3.97,
  tax taken off 3.98, balance sheet 3.99–3.115, net partnership charges 3.117.
- **Pages 6–7 — Partnership Statement (short).** Per-partner (boxes 1–31): name/
  address, UTR (box 3), NINO, appointed/ceased dates (7/9), share, profit (11,
  from 3.83), adjustment (11A, from 3.82), loss (12, from 3.84), untaxed savings
  (24), CIS (24A, from 3.97), charges (29, from 3.117). Boxes explicitly
  "**copy to**" the partner's SA104 → **this is the SA104 feed.**
- **Page 8 — Q7 other income** (untaxed interest 7.9A), Q8–Q10 (provisional/DOTAS),
  **Q11 declaration** (nominated partner).

### Supplementary pages (separate forms — later phases)
- **SA801** Partnership UK property · **SA802** Foreign · **SA803** Chargeable-asset
  disposals · **SA804** Savings, investments & other income · **Partnership
  Statement (Full)** (full-income allocation, when income isn't just trade +
  untaxed interest).

## Architecture — mirror SA100/CT600 (heavy reuse)

- **Return type:** flip `sa800` to `enabled: true` (`data.ts`); `ret.sa800?:
  Sa800Data` alongside `income`/`ct600`; branch `returnType === 'sa800'` (exactly
  like CT600).
- **Model/calc:** `Sa800Data` (details + `Sa800Trading` + balance sheet +
  `Sa800Statement`/partners + supplementary flags); `computeSa800`. Trading calc
  reuses SA103 adjust-profit + **`computeCapitalAllowances`** (via
  `capitalAllowancesCalc?: CapitalAllowancesState`); allocation reuses the
  `PartnershipStatement`/`partnerAllocatedShare` helpers.
- **Dashboard/wizard:** new `homeService === 'partnership'` +
  `PartnershipTaxDashboard` (mirrors Personal/Company); wizard = partnership
  client + accounting period.
- **Stages (mirror CT600's dedicated set):** `StageSetupSa800`, `StageAnalyseSa800`,
  `StageReviewSa800` (tabs: Details / Trading / Balance sheet / Partners /
  Supplementary), `StageApprovalSa800`, `StageSubmitSa800`. Dispatch in
  `TaxStudioModule` by `returnType`.
- **Linking (the user's ask):** ConnectedImports-style cards to pull the
  partnership's trade/property from **Accounts Studio** (partnership engagement)
  or **Bookkeeping** (`bkToPartnershipSummary` exists) → auto-fill the boxes;
  partner list + shares from `bookkeeping_book_participants` / profit-allocation.
- **Filing preview:** SA800 + Partnership Statement facsimiles on shared
  `formPrimitives` (box-for-box), in `FilingPreview` via a `returnType==='sa800'`
  branch.
- **★ SA104 feed:** the filed SA800's Partnership Statement pushes each partner's
  allocated share to their SA104 (redirect the existing entity→SA104 feed to read
  the SA800 instead of raw Bookkeeping).
- **E-filing:** SA800 return builder + pages in `lib/hmrc-sa` — reuses the
  IRmark/gateway/transport; **vendor ID `9626` already covers SA100/SA800/SA900**,
  and SA800 was flagged to SDST as "to follow". Legacy GovTalk, not MTD.

## Phasing

1. **Foundation** — enable type; `Sa800Data` model + `emptySa800`; spine branch.
2. **Preparation MVP** — wizard + `PartnershipTaxDashboard` + the five stage
   shells + `computeSa800` (trading + CAs) + Review tabs (Details/Trading/Balance
   sheet) + Partners tab with the Partnership Statement allocation + save/history.
3. **Linking** — Accounts Studio + Bookkeeping pull → auto-fill; partner shares
   from participants.
4. **Supplementary** — SA801/804/802/803 + Partnership Statement (Full), in the
   order the firm's clients need.
5. **Filing preview** — SA800 + PS facsimiles.
6. **★ SA104 feed** — push each partner's share to their SA104.
7. **E-filing** — SA800 XML/pages in `lib/hmrc-sa` + TPVS/recognition (vendor 9626).

## Design notes / decisions
- **Basis-period reform:** from 2024/25 partnerships are taxed on a **tax-year
  basis**. The calc must handle a non-5-April accounting period apportioned to the
  tax year (transition mostly complete).
- **Corporate / non-resident partners** (Q5): a company partner's share goes to a
  **CT600**, not an SA104; flag and handle in the allocation.
- **Short vs Full Partnership Statement:** short covers trade + untaxed interest
  only; anything else needs the Full statement (Phase 4).
- **Turnover paths:** < £90k → 3-line (page 3); £90k–£15m → full P&L (page 4);
  > £15m → 3-line + attach accounts. The Review UI should follow the same fork.
