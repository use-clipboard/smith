// Tax Studio — domain types.
//
// A `TaxReturn` is the Tax Studio analog of an Accounts Studio `Engagement`:
// the whole record is stored verbatim in a jsonb `data` column and only a few
// fields are asserted server-side, so the shape can evolve without a migration.
//
// Phase 1 focuses on SA100 (Personal Tax). Other return types are modelled in
// the enums so the UI can adapt, but their income shapes land in later
// increments.

export type ReturnTypeId =
  | 'sa100'        // Personal Tax
  | 'ct600'        // Company Tax
  | 'sa800'        // Partnership
  | 'sa900'        // Trust & Estate
  | 'cgt'          // Capital Gains (standalone)
  | 'non_resident'; // Non-resident

/** The five guided stages of a return workspace. */
export type StageId = 'setup' | 'analyse' | 'review' | 'approval' | 'submit';

export type StageState = 'complete' | 'active' | 'upcoming';

/** Practice-wide workflow status (Kanban columns / list badges). */
export type ReturnStatus =
  | 'not-started'
  | 'waiting-info'
  | 'analysing'
  | 'review'
  | 'ready-to-send'
  | 'awaiting-approval'
  | 'approved'
  | 'ready-to-file'
  | 'filed'
  | 'amended'
  | 'archived';

// ─── SA100 income model (Phase 1) ────────────────────────────────────────────
// SA102 Employment — one per employment. Box numbers follow the Capium
// Employment layout (Details / Income / Benefit / Expenses tabs).
export interface EmploymentSource {
  id: string;
  // ── Employment Details (boxes 1–5.5) ──
  employer: string;        // box 1 — employer's name
  payeRef?: string;        // box 2 — employer's PAYE tax reference (NNN/XXXXXX)
  isDirector?: boolean;    // box 3 — is the employee a company director?
  directorCeasedDate?: string; // box 4 — date ceased being a director (YYYY-MM-DD)
  isCloseCompany?: boolean;    // box 5 — is this a close company?
  closeCompanyName?: string;   // box 5.1
  closeCompanyReg?: string;    // box 5.2 — registration number
  closeCompanyDividends?: number; // box 5.3 — dividends received from this close company (memo)
  closeCompanyShareholding?: number; // box 5.4 — percentage shareholding
  teachersLoanOffPayroll?: boolean;  // box 5.5 — Teachers' Loans scheme / off-payroll working
  // ── Employment Income (boxes 6–8 + Class 1 NIC) ──
  pay: number;             // box 6 — pay from this employment before tax (gross)
  payrolledBenefitsStudentLoan?: number; // box 6.1 — payrolled benefits in box 6 affecting SL
  taxDeducted: number;     // box 7 — UK tax taken off box 6
  tips?: number;           // box 8 — tips & other payments not on the P60
  class1Nic?: number;      // Class 1 NIC (memo — already deducted via payroll)
  // Benefits from P11D (boxes 9–16)
  benCar?: number;           // 9  — company cars and vans
  benFuel?: number;          // 10 — fuel for company cars and vans
  benMedical?: number;       // 11 — private medical and dental insurance
  benVouchers?: number;      // 12 — vouchers, credit cards, excess mileage allowance
  benAssets?: number;        // 13 — goods and other assets provided
  benAccommodation?: number; // 14 — accommodation provided
  benOther?: number;         // 15 — other benefits (incl. interest-free/low-interest loans)
  benExpPayments?: number;   // 16 — expenses payments received & balancing charges
  // Allowable expenses (boxes 17–20)
  expTravel?: number;        // 17 — business travel and subsistence
  expFixed?: number;         // 18 — fixed deductions for expenses (flat rate)
  expProfessional?: number;  // 19 — professional fees and subscriptions
  expOther?: number;         // 20 — other expenses and capital allowances
  // Legacy aggregate fields — kept so previously-saved returns and simple
  // imports still compute; superseded by the itemised boxes above when present.
  benefits?: number;
  expenses?: number;
}
// SA104 Partnership — this partner's share of the partnership's income.
// One partner's slice in a Partnership Statement (name + profit share %).
export interface PartnerAllocation {
  id: string;
  name: string;
  sharePct: number;      // 0–100
  isTaxpayer?: boolean;  // the partner whose SA104 this is — receives box 8
}

// A lightweight Partnership Statement: the partnership's total trade profit and
// how it is split between the partners. Applying it sets this return's box 8 to
// the taxpayer partner's share, and records the full split for the accountant.
export interface PartnershipStatement {
  profit: number;               // partnership's total taxable trade profit (100%)
  partners: PartnerAllocation[];
}

// SA104 Partnership. Box numbers follow the Capium Partnership (full) layout:
// Partnership details / Trading, NICs & Untaxed income / UK, Foreign Incomes &
// Offshore funds / Partnership's taxed income. Blue "total" boxes are computed
// (see calc.ts). 'short' (SA104S) is a slimmer view of the same data.
export interface PartnershipSource {
  id: string;
  name: string;
  /** Which SA104 form this is presented as. Undefined = 'full' (back-compat). */
  form?: 'full' | 'short';
  /** Optional Partnership Statement — the whole-partnership profit and how it's
   *  split between partners. When present, box 8 is the taxpayer partner's share. */
  statement?: PartnershipStatement;

  // ── Partnership details (boxes 1–4) ──
  utr?: string;                    // box 1 — partnership reference number (required)
  description?: string;            // box 2 — description of partnership trade or profession
  becamePartner?: boolean;         // box 3Q — became a partner after 5 April?
  dateJoined?: string;             // box 3 — date joined (YYYY-MM-DD)
  ceasedPartner?: boolean;         // box 4Q — ceased being a partner in the year?
  dateLeft?: string;               // box 4 — date left (YYYY-MM-DD)
  periodStart?: string;            // accounting-period start (import metadata; YYYY-MM-DD)
  periodEnd?: string;              // accounting-period end (import metadata; YYYY-MM-DD)

  // ── Share of trading / professional profits (boxes 8–20.1) ──
  profit: number;                  // box 8 — share of profit/(loss)
  adjustmentPeriod?: number;       // box 9 — adjustment for short/long accounting period
  accountingAdjustment?: number;   // box 10 — accounting adjustment
  averagingAdjustment?: number;    // box 11 — averaging adjustment
  foreignTaxDeduction?: number;    // box 12 — foreign tax claimed by deduction
  // box 16 — adjusted profit (computed)
  transitionProfit?: number;       // box 16.3 — spread of transition profit this year
  transitionLossBfwd?: number;     // box 16.4 — loss b/fwd set off vs transition profit
  lossBroughtForward?: number;     // box 17 — loss b/fwd used
  unusedLossCarriedForward?: number; // box 17.1 — unused loss b/fwd to carry forward
  // box 18 — taxable profit (computed)
  otherBusinessIncome?: number;    // box 19 — other business income
  // box 20 — total taxable profits (computed)
  figClaim?: number;               // box 20.1 — amount claimed under FIG regime

  // ── Loss allocation (boxes 21–24) ──
  // box 21 — adjusted loss this year (computed)
  lossFigAdjustment?: number;      // box 21.1 — adjustment to losses under FIG regime
  lossAgainstOtherIncome?: number; // box 22 — loss against other income
  lossCarriedBack?: number;        // box 23 — loss carried back to previous year
  // box 24 — total loss to carry forward (computed)

  // ── NICs (boxes 25–27) ──
  class2Voluntary?: boolean;       // box 25 — pay Class 2 NIC voluntarily
  class4Exempt?: boolean;          // box 26 — exempt from Class 4 NIC
  class4Adjustment?: number;       // box 27 — adjustment to profits chargeable to Class 4
  willingClass2?: boolean;         // self-employed all year & willing to pay Class 2 (Yes/No)

  // ── Untaxed savings income (boxes 28–35.1) ──
  ukSavings?: number;              // box 28 — share of UK untaxed savings income
  ukSavingsAdjustment?: number;    // box 29 — adjustment to UK untaxed savings
  // box 30 — adjusted UK savings income (computed)
  foreignSavings?: number;         // box 31 — share of foreign untaxed savings income
  foreignSavingsAdjustment?: number; // box 32 — adjustment to foreign untaxed savings
  foreignSavingsTax?: number;      // box 33 — total foreign tax taken off (savings)
  // box 34 — adjusted foreign savings income (computed)
  // box 35 — total untaxed savings income (computed)
  savingsFigClaim?: number;        // box 35.1 — amount claimed under FIG regime

  // ── Income from UK property (boxes 36–41.2) ──
  propertyProfit?: number;         // box 36 — share of profit or loss from UK property
  propertyAdjustment?: number;     // box 37 — adjustment to UK property income
  propertyLossBfwd?: number;       // box 38 — losses brought forward
  propertyLossAgainstOther?: number; // box 39 — loss used against other income
  propertyLossCarryForward?: number; // box 40 — loss to carry forward
  // box 41 — taxable profit (computed)
  propertyFinanceCosts?: number;   // box 41.1 — residential property finance costs
  propertyFinanceCostsBfwd?: number; // box 41.2 — unused residential finance costs b/fwd

  // ── Other untaxed UK income (boxes 45–51) ──
  otherUkIncome?: number;          // box 45 — share of other untaxed UK income
  otherUkIncomeAdjustment?: number; // box 46 — adjustment to other untaxed UK income
  otherUkLossBfwd?: number;        // box 47 — losses brought forward
  // box 48 — taxable profit (computed)
  otherUkIncomeB?: number;         // box 49 — other untaxed UK income
  otherUkLossAdjustment?: number;  // box 50 — adjustment to loss for other untaxed UK income
  // box 51 — total loss to carry forward after all other set-offs (computed)

  // ── Income from offshore funds (boxes 52–55.1) ──
  offshoreIncome?: number;         // box 52 — share of income from offshore funds
  offshoreAdjustment?: number;     // box 53 — adjustment to offshore funds income
  offshoreTax?: number;            // box 54 — foreign tax taken off
  // box 55 — taxable profit (computed)
  offshoreFigClaim?: number;       // box 55.1 — amount claimed under FIG regime

  // ── Other untaxed foreign income (boxes 56–63.2) ──
  foreignIncome?: number;          // box 56 — share of other untaxed foreign income
  foreignIncomeAdjustment?: number; // box 57 — adjustment to other untaxed foreign income
  foreignLossBfwd?: number;        // box 58 — losses brought forward
  foreignTax?: number;             // box 59 — total foreign tax taken off
  // box 60 — taxable profit (computed)
  foreignFigClaim?: number;        // box 60.1 — amount claimed under FIG regime
  foreignIncomeB?: number;         // box 61 — other untaxed foreign income
  foreignLossAdjustment?: number;  // box 62 — adjustment to loss for other untaxed foreign
  // box 63 — total loss to carry forward after all other set-offs (computed)
  foreignFinanceCosts?: number;    // box 63.1 — residential property finance costs
  foreignFinanceCostsBfwd?: number; // box 63.2 — unused residential finance costs b/fwd

  // ── Partnership's taxed income ──
  // box 67 — untaxed income from this business (other than liable at 20%) (computed)
  taxedIncome10?: number;          // box 68 — share of taxed income taxable at 10%
  taxedIncome10ForeignTax?: number; // box 69 — total foreign tax taken off
  // box 70 — taxed income taxable at 10% (computed)
  taxedIncome10Fig?: number;       // box 70.1 — amount claimed under FIG regime
  taxedIncome20?: number;          // box 71 — share of taxed income taxable at 20%
  taxedIncome20ForeignTax?: number; // box 72 — total foreign tax taken off
  // box 73 — taxed income taxable at 20% (computed)
  otherTaxedIncome?: number;       // box 74 — share of other taxed income
  otherTaxedIncomeForeignTax?: number; // box 75 — foreign tax taken off
  otherTaxedFig?: number;          // box 75.1 — amount claimed under FIG regime
  // box 76 — other taxed income taxable (computed)
  totalFig?: number;               // box 76.1 — total amount claimed under FIG regime

  // ── Tax paid and deductions (boxes 77–80) ──
  incomeTaxTaken?: number;         // box 77 — share of income tax taken off partnership income
  cisDeductions?: number;          // box 78 (full) / box 30 (short) — share of CIS deductions
  taxTakenTradingIncome?: number;  // box 79 (full) / box 31 (short) — share of tax off trading income
  // box 80 — total tax taken off (computed)
  otherInformation?: string;       // SA104S box 32 — other information (short form only)

  // ── Legacy fields (older imports) — folded into the computed helpers ──
  adjustments?: number;            // legacy basis-period adjustment (→ box 9/10)
  taxTaken?: number;               // legacy tax deducted at source (→ box 80)
  savingsInterest?: number;        // legacy savings share (→ box 28)
  dividends?: number;              // legacy dividend share (routed to dividend income)
}
// SA103F Self-employment (full). Box numbers follow the Capium Self Employment
// (full) layout: Business details / Business Expenses / Net profit(loss) /
// Losses, CIS / Balance Sheet. Blue "total" boxes are computed (see calc.ts).
export interface TradeSource {
  id: string;
  /** Which SA103 form this trade is presented as. 'short' (SA103S) is a slimmer
   *  view of the same data, allowed when turnover < the VAT threshold; 'full'
   *  (SA103F) is required above it. Undefined = 'full' (back-compat). */
  form?: 'full' | 'short';
  fosterCarer?: boolean;     // SA103S box 4 — foster / shared-lives carer
  // ── Business details (boxes 1–10) ──
  name: string;              // box 1 — business name
  description?: string;      // box 2 — description of business
  addressLine?: string;      // box 3 — first line of business address
  postcode?: string;         // box 4 — postcode of business address
  detailsChanged?: boolean;  // box 5 — name/address details changed in last 12 months
  startedInYear?: boolean;   // box 6Q — did this business start after 5 April?
  dateStarted?: string;      // box 6 — date business started (YYYY-MM-DD)
  ceasedInYear?: boolean;    // box 7Q — did this business cease in the tax year?
  dateCeased?: string;       // box 7 — date business ceased (YYYY-MM-DD)
  periodStart?: string;      // box 8 — start of accounting period (YYYY-MM-DD)
  periodEnd?: string;        // box 9 — end of accounting period (YYYY-MM-DD)
  traditionalAccounting?: boolean; // box 10 — traditional accounting (not cash basis)
  // ── Other information (boxes 13–14) ──
  specialArrangements?: boolean;   // box 13 — do special arrangements apply?
  priorYearProfitDetails?: boolean; // box 14 — profit details provided last year?
  // ── Business income (boxes 15–16.1) ──
  turnover?: number;            // box 15 — turnover
  otherBusinessIncome?: number; // box 16 — any other business income not in box 15
  tradingIncomeAllowance?: number; // box 16.1 — trading income allowance
  // ── Allowable business expenses (boxes 17–30; total 31 computed) ──
  expCostOfGoods?: number;    // 17 — cost of goods bought for resale
  expSubcontractors?: number; // 18 — CIS payments to subcontractors
  expWages?: number;          // 19 — wages, salaries & other staff costs
  expCarVanTravel?: number;   // 20 — car, van & travel expenses
  expPremises?: number;       // 21 — rent, rates, power & insurance
  expRepairs?: number;        // 22 — repairs & renewals
  expOffice?: number;         // 23 — phone, stationery & other office costs
  expAdvertising?: number;    // 24 — advertising & business entertainment
  expInterest?: number;       // 25 — interest on bank & other loans
  expBankCharges?: number;    // 26 — bank, credit card & other financial charges
  expBadDebts?: number;       // 27 — irrecoverable debts written off
  expProfessional?: number;   // 28 — accountancy, legal & other professional fees
  expDepreciation?: number;   // 29 — depreciation & loss/(profit) on sale of assets
  expOtherCosts?: number;     // 30 — other business expenses
  // ── Disallowable expenses (boxes 32–45; total 46 computed) ──
  disCostOfGoods?: number;    // 32
  disSubcontractors?: number; // 33
  disWages?: number;          // 34
  disCarVanTravel?: number;   // 35
  disPremises?: number;       // 36
  disRepairs?: number;        // 37
  disOffice?: number;         // 38
  disAdvertising?: number;    // 39
  disInterest?: number;       // 40
  disBankCharges?: number;    // 41
  disBadDebts?: number;       // 42
  disProfessional?: number;   // 43
  disDepreciation?: number;   // 44
  disOtherCosts?: number;     // 45
  // ── Capital allowances (boxes 49–56; total 57 computed) + balancing charge 59 ──
  aia?: number;               // 49 — annual investment allowance
  ca18?: number;              // 50 — capital allowances at 18% (main pool WDA)
  ca6?: number;               // 51 — capital allowances at 6% (special rate)
  zeroEmissionGoods?: number; // 52 — zero-emission goods vehicle allowance
  zeroEmissionCar?: number;   // 52.1 — zero-emission car allowance
  sba?: number;               // 53 — structures and buildings allowance
  sbaFreeport?: number;       // 53.1 — freeport / investment zone SBA
  electricChargepoint?: number; // 54 — electric charge-point allowance
  enhancedCapitalAllowances?: number; // 55 — 100% and other enhanced allowances
  allowancesOnSale?: number;  // 56 — allowances on sale / cessation of business use
  balancingCharges?: number;  // 59 — balancing charge on disposals (added back)
  /** Optional working state for the Capital Allowances Calculator — pools, this
   *  year's additions/disposals, and the closing TWDV carried forward. When the
   *  calculator is applied it writes boxes 49/50/51/55/56/59 from these. */
  capitalAllowancesCalc?: CapitalAllowancesState;
  // ── Calculating taxable profit or loss (boxes 60–76.1) ──
  goodsOwnUse?: number;       // 60 — goods & services for own use (addition)
  incomeReceiptsElsewhere?: number; // 62 — income/receipts taxable elsewhere (deduction)
  basisAdjustment?: number;   // 68 — adjustment for short/long accounting period
  changeOfPracticeAdjustment?: number; // 71 — adjustment for change of accounting practice
  averagingAdjustment?: number; // 72 — averaging adjustment
  transitionProfitSpread?: number; // 73.3 — spread of transition profit arising this year
  transitionLossBfwd?: number; // 73.4 — loss b/fwd set against transition profit spread
  lossBroughtForward?: number; // 74 — loss brought forward from earlier years
  unusedLossCarriedForward?: number; // 74.1 — unused loss to carry forward
  otherBusinessIncome75?: number; // 75 — any other business income (adjustment stage)
  figClaim?: number;          // 76.1 — amount claimed under the FIG regime
  // ── Losses (boxes 77.1–79; adjusted loss 77 & carried forward 80 computed) ──
  adjustmentLossFig?: number; // 77.1 — adjustment to losses under the FIG regime
  lossSetOffOtherIncome?: number; // 78 — loss set off against other income
  lossCarriedBack?: number;   // 79 — loss carried back
  // ── CIS & tax taken off (boxes 81–82) ──
  cisDeductions?: number;     // 81 — CIS deductions on payments from contractors
  otherTaxTaken?: number;     // 82 — other tax taken off trading income
  // ── Balance sheet (boxes 83–99; totals 90/94/96/99 computed) ──
  bsEquipment?: number;       // 83 — equipment, machinery and vehicles
  bsOtherFixedAssets?: number; // 84
  bsStock?: number;           // 85 — stock and work in progress
  bsDebtors?: number;         // 86 — trade debtors
  bsBank?: number;            // 87 — bank / building society balances
  bsCash?: number;            // 88 — cash in hand
  bsOtherCurrentAssets?: number; // 89 — other current assets and prepayments
  bsCreditors?: number;       // 91 — creditors
  bsLoans?: number;           // 92 — loans and overdrafts
  bsOtherLiabilities?: number; // 93 — other liabilities and accruals
  caBalanceStart?: number;    // 95 — capital account balance at start of period
  caCapitalIntroduced?: number; // 97 — capital introduced
  caDrawings?: number;        // 98 — drawings
  // ── NIC & other information (boxes 100–103) ──
  class2Voluntary?: boolean;  // 100 — choose to pay Class 2 NIC voluntarily
  class4Exempt?: boolean;     // 101 — exempt from Class 4 NIC
  class4Adjustment?: number;  // 102 — adjustment to profit chargeable to Class 4 NIC
  willingPayClass2FullYear?: boolean; // full-year self-employed & willing to pay Class 2
  otherInformation?: string;  // 103 — any other information
  // Core / legacy — accounts net profit (fallback when not itemised), plus the
  // disallowables add-back and total other capital allowances.
  profit: number;             // accounts net profit / (loss)
  addBacks?: number;          // legacy total disallowable expenses added back
  capitalAllowances?: number; // legacy other capital allowances (WDA etc.)
}

/** An asset bought in the year, and how it's relieved. */
export interface CapexAddition {
  id: string;
  description?: string;
  cost: number;
  /** aia = 100% Annual Investment Allowance; fya = 100% first-year (e.g.
   *  zero-emission); main = 18% main pool; special = 6% special-rate pool. */
  treatment: 'aia' | 'fya' | 'main' | 'special';
  /** Business-use % (sole traders) — restricts this asset's allowance. Default 100. */
  businessUsePct?: number;
}
/** An asset sold/scrapped in the year — proceeds come off its pool. */
export interface CapexDisposal {
  id: string;
  description?: string;
  pool: 'main' | 'special';
  proceeds: number;
}
/** Working state for the Capital Allowances Calculator. Closing pool balances
 *  (`*Cfwd`) are stored so next year's return rolls them in as `*Bfwd`. */
export interface CapitalAllowancesState {
  mainPoolBfwd?: number;      // TWDV brought forward — main pool
  specialPoolBfwd?: number;   // TWDV brought forward — special-rate pool
  additions?: CapexAddition[];
  disposals?: CapexDisposal[];
  mainPoolCfwd?: number;      // TWDV carried forward — main pool (computed on apply)
  specialPoolCfwd?: number;   // TWDV carried forward — special-rate pool (computed on apply)
}
// SA105 UK property. Box numbers follow the HMRC SA105 form (2025/26 — the
// furnished-holiday-lettings regime was abolished from 6 April 2025).
// SA105 UK Property, per-property. Box numbers follow the Capium UK Property
// layout (Property income / Property expenses / Taxable profit or loss). Several
// properties (or Landlord-tool links) are entered separately and SUMMED into the
// single SA105 that gets submitted. Blue "total" boxes are computed (see calc.ts).
export interface PropertySource {
  id: string;
  address: string;
  // ── Property income (boxes 20–23) ──
  rents?: number;                  // box 20 — total rents & other income from property
  propertyIncomeAllowance?: number;// box 20.1 — property income allowance (£1,000; instead of expenses)
  traditionalAccounting?: boolean; // box 20.2 — traditional (accruals) accounting
  taxTaken?: number;               // box 21 — tax taken off any income in box 20
  premiums?: number;               // box 22 — premiums for the grant of a lease
  reversePremiums?: number;        // box 23 — reverse premiums and inducements
  // ── Allowable expenses (boxes 24–29) ──
  expPremises?: number;    // box 24 — rent, rates, insurance, ground rents etc.
  expRepairs?: number;     // box 25 — property repairs & maintenance
  expLoanInterest?: number;// box 26 — loan interest & other financial costs
  expProfessional?: number;// box 27 — legal, management & other professional fees
  expServices?: number;    // box 28 — costs of services provided, incl. wages
  expOther?: number;       // box 29 — other allowable property expenses
  // ── Taxable profit or loss (boxes 30–45) ──
  privateUse?: number;          // box 30 — private use adjustment (add back)
  balancingCharges?: number;    // box 31 — balancing charges (add back)
  aia?: number;                 // box 32 — Annual Investment Allowance (deduct)
  sba?: number;                 // box 33 — Structures and Buildings Allowance (deduct)
  electricChargepoint?: number; // box 33.1 — electric charge-point allowance (deduct)
  freeportSba?: number;         // box 33.2 — Freeport/Investment Zones SBA (deduct)
  zeroEmissionCar?: number;     // box 34.1 — zero-emission car allowance (deduct)
  capitalAllowances?: number;   // box 35 — all other capital allowances (deduct)
  domesticItems?: number;       // box 36 — costs of replacing domestic items (deduct)
  rentARoomExempt?: number;     // box 37 — Rent a Room exempt amount (deduct)
  // box 38 — adjusted profit for the year (computed)
  lossBroughtForward?: number;  // box 39 — loss b/fwd used against this year's profits
  unusedLossCarriedForward?: number; // unused losses b/fwd to carry forward
  // box 40 — taxable profit for the year (computed)
  // box 41 — adjusted loss for the year (computed)
  lossSetOffTotalIncome?: number; // box 42 — loss set off against total income
  // box 43 — loss to carry forward to following year (computed)
  residentialFinanceCosts?: number; // box 44 — residential finance costs → 20% reducer
  unusedFinanceCostsBfwd?: number;   // box 45 — unused residential finance costs b/fwd
  rentARoom?: number;          // legacy Rent a Room deduct (→ box 37 fallback)
  // Legacy — accounts net profit fallback (used when boxes aren't itemised).
  profit: number;
}

// SA107 Trusts & estates — income received from a trust, settlement or estate.
export interface TrustEstateSource {
  id: string;
  name: string;
  /** 'discretionary' = net received with an automatic 45% tax credit; 'estate' =
   *  income from an estate / interest-in-possession trust reported gross by type
   *  with the tax already paid. */
  kind: 'discretionary' | 'estate';
  incomeType: 'nonSavings' | 'savings' | 'dividend'; // routing (estate kind only)
  amount: number;   // net received (discretionary) or gross income (estate)
  taxPaid: number;  // tax already paid (estate kind; computed for discretionary)
}

// One row of a "Foreign estate" breakdown — the shared table behind SA107 boxes
// 22 (income), 23 (UK tax withheld) and 24 (foreign tax): each estate is entered
// once and the three box totals are its three column sums.
export interface EstateForeignItem {
  id: string;
  description?: string;
  income?: number;        // → box 22 total (foreign estate income)
  foreignTax?: number;    // → box 24 total (FTCR not claimed)
  ukTaxWithheld?: number; // → box 23 total (relief for UK tax already accounted for)
}

// SA107 Trusts & estates — the full supplementary page, box-for-box (Capium
// layout: Income from Trusts / Income from the estates). The legacy simplified
// per-source model lives on `income.trusts` (TrustEstateSource[]) and is still
// summed into the tax; this is the box-for-box page layered alongside it, exactly
// as Sa106 was layered over the legacy foreign fields.
export interface Sa107 {
  // ── Income from Trusts ──
  // Discretionary income (boxes 1–2)
  discretionaryNet?: number;          // box 1 — net amount, discretionary income from a UK resident trust
  settlorInterestedPayments?: number; // box 2 — total payments from settlor-interested trusts (memo)
  // Non-discretionary income entitlement (boxes 3–6)
  nonDiscNonSavings?: number;         // box 3 — net amount of non-savings income
  nonDiscSavings?: number;            // box 4 — net amount of savings income
  nonDiscDividend?: number;           // box 5 — net amount of dividend income
  trusteesNonResident?: boolean;      // box 6 — trustees not resident in the UK for tax purposes?
  // Income chargeable on settlors (boxes 7–15)
  settlorNonSavingsBasic?: number;    // box 7  — non-savings income taxed at basic rate (net)
  settlorSavingsBasic?: number;       // box 8  — savings income taxed at basic rate (net)
  settlorDividend?: number;           // box 9  — dividends income taxed at dividend rate (net)
  settlorNonSavingsTrust?: number;    // box 10 — non-savings income taxed at trust rate (net)
  settlorSavingsTrust?: number;       // box 11 — savings income taxed at trust rate (net)
  settlorDividendTrust?: number;      // box 12 — dividend income taxed at trust rate (net)
  settlorNonSavingsGross?: number;    // box 13 — non-savings income paid gross
  settlorSavingsGross?: number;       // box 14 — savings income paid gross
  lifeAssuranceTaxPaid?: number;      // box 15 — tax paid on certain UK life assurance policies
  // ── Income from the estates ──
  // UK estates (boxes 16–19)
  estateNonSavings?: number;          // box 16 — non-savings income (after tax)
  estateSavings?: number;             // box 17 — savings income (after tax)
  estateDividend?: number;            // box 18 — dividend income (after tax)
  estateDividend75?: number;          // box 18.1 — dividend income taxed at 7.5%, after tax taken off
  estateNonSavingsNonRepayable?: number; // box 19 — non-savings income taxed at non-repayable basic rate
  // Foreign estates — the shared breakdown drives boxes 22 / 23 / 24
  foreignEstates?: EstateForeignItem[];
  foreignEstateFig?: number;          // box 22.1 — amount claimed under the FIG regime
  estateResiPropertyIncome?: number;  // box 25 — residential property income
  estateResiFinanceBfwd?: number;     // box 25.1 — unused residential finance costs brought forward
  otherInformation?: string;          // box 26 — any other information
}

// One itemised dividend (UK company distribution) — the breakdown behind the
// Dividends total on the SA100.
export interface DividendItem {
  id: string;
  company: string;
  description?: string;
  shares?: number;
  paymentDate?: string; // dd-mm-yyyy
  amount: number;
}

// A savings-interest line (untaxed UK interest — SA100 box 2).
export interface SavingsItem {
  id: string;
  description?: string;
  amount: number;
}

// A generic itemised income/expense line (description + amount) used by the
// pensions & other-income breakdowns.
export interface LineItem {
  id: string;
  description?: string;
  amount: number;
}

// A taxed-interest line (SA100 box 1) — received net, with tax deducted.
export interface TaxedInterestItem {
  id: string;
  description?: string;
  net: number;
  tax: number;
}

// SA106 Foreign — one foreign income source, routed to the right UK rate.
export interface ForeignSource {
  id: string;
  country?: string;
  category: 'interest' | 'dividends' | 'pension' | 'property' | 'other';
  income: number;         // amount received, in GBP
  foreignTaxPaid: number; // foreign tax paid on it, in GBP
  claimFtcr?: boolean;    // claim Foreign Tax Credit Relief (default true)
}

// One itemised income line inside a foreign row's "+" breakdown sub-table.
export interface ForeignIncomeItem {
  id: string;
  description?: string;
  grossIncome?: number;   // gross income arising
  foreignTax?: number;    // foreign tax taken off
  ukTax?: number;         // UK tax taken off
  tenPercent?: boolean;   // pensions: 10% deduction
}

// SA106 Foreign — the recurring country-income row (columns A–F on every
// "overseas income" sub-table). F (taxable amount) is computed. The "+" opens an
// itemised breakdown; when present, B (income) & C (foreign tax) are its totals.
export interface ForeignRow {
  id: string;
  country?: string;          // A — country/territory code
  incomeArising?: number;    // B — income arising
  foreignTax?: number;       // C — foreign tax taken off or paid
  specialWithholding?: number; // D — special withholding tax
  creditRelief?: boolean;    // E — claim Foreign Tax Credit Relief on this row
  breakdown?: ForeignIncomeItem[]; // "+" itemised income lines (totals feed B & C)
  // F — taxable amount (computed = income arising)
}

// One itemised expense line inside a foreign property's "+" expenses sub-table.
export interface ForeignExpenseItem {
  id: string;
  description?: string;
  expense?: number;     // → box 17 total
  privateUse?: number;  // → box 19 total
}

// SA106 foreign land & property, per property (a "foreign SA105"). Boxes 14–24.2.
export interface ForeignProperty {
  id: string;
  country?: string;
  // ── Income & Expenses (14–18) ──
  totalRents?: number;              // 14 — total rents & receipts
  propertyIncomeAllowance?: number; // 14.1 — property income allowance
  traditionalAccounting?: boolean;  // 14.2 — traditional accounting
  letProperties?: number;           // 15 — number of let properties
  premiumsPaid?: number;            // 16 — premiums paid
  expenses?: number;                // 17 — property expenses
  expenseItems?: ForeignExpenseItem[]; // "+" itemised expenses (totals feed 17 & 19)
  // 18 — net profit or loss (computed)
  // ── Calculate Taxable P&L (19–24.2) ──
  privateUse?: number;              // 19 — private use adjustment
  balancingCharges?: number;        // 20 — balancing charges
  capitalAllowances?: number;       // 21 — capital allowances
  zeroEmissionCar?: number;         // 21.1 — zero-emission car allowance
  sba?: number;                     // 22.1 — Structures and Buildings Allowance
  electricChargepoint?: number;     // 22.2 — electric charge-point allowance
  domesticItems?: number;           // 23 — costs of replacing domestic items
  // 24 — adjusted profit or loss (computed)
  residentialFinanceCosts?: number; // 24.1 — residential property finance costs
  unusedFinanceCostsBfwd?: number;  // 24.2 — unused residential finance costs b/fwd
  // ── Summary (per country, C/D/E) ──
  foreignTax?: number;              // C — foreign tax taken off or paid
  ukTax?: number;                   // D — UK tax taken off
  creditRelief?: boolean;           // E — claim credit relief
}

// SA106 Foreign — the whole supplementary page. Legacy fields (sources/income/
// foreignTaxPaid) are retained so older returns and imports still compute.
export interface Sa106 {
  sources?: ForeignSource[];   // legacy itemised sources
  income?: number;             // legacy scalar foreign income
  foreignTaxPaid?: number;     // legacy scalar foreign tax
  // ── Unremittable income (boxes 1–2) ──
  unremittable?: boolean;      // box 1
  ftcrOnIncome?: number;       // box 2 — Foreign Tax Credit Relief on income
  // ── Overseas Income tables ──
  interest?: ForeignRow[];             // Interest and other income (totals 3/4/4.1)
  dividends?: ForeignRow[];            // Dividends from foreign companies
  remittedExcl?: ForeignRow[];         // Remitted foreign income excluding dividends
  remittedDividends?: ForeignRow[];    // Remitted foreign dividends (totals 7.3/7.4)
  remittedDivSubjectToCredit?: number; // 7.5 — amount in 7.4 subject to dividend tax credit
  pensions?: ForeignRow[];             // Overseas pensions etc. (totals 8/9)
  otherDividend?: ForeignRow[];        // Other income — dividends by a person abroad (10/11/11.1)
  otherAll?: ForeignRow[];             // Other income — all other by a person abroad (12/13/13.0)
  otherResiFinanceCost?: number;       // 13.1 — residential finance cost
  otherResiFinanceBfwd?: number;       // 13.2 — unused residential finance costs b/fwd
  // ── Foreign land & property (boxes 14–32) ──
  properties?: ForeignProperty[];
  propLossBroughtForward?: number; // 26 — total loss brought forward
  propLossSetOff?: number;         // 31 — loss set off against total income
  // ── Foreign tax paid ──
  foreignTaxRows?: ForeignRow[];   // "Foreign tax" country table (A/C/E/F)
  // Capital gains (33–40)
  cgUkGain?: number;      // 33
  cgUkDays?: number;      // 34
  cgForeignGain?: number; // 35
  cgForeignDays?: number; // 36
  cgForeignTax?: number;  // 37
  cgClaimFtcr?: boolean;  // 38
  cgFtcr?: number;        // 39
  cgSwt?: number;         // 40 — special withholding tax
  // Foreign life insurance (43–46)
  lifeGains?: number;     // 43
  lifeYears?: number;     // 44
  lifeTaxPaid?: number;   // 45
  lifeOmitted?: number;   // 46
  // Non-resident trusts (49–57)
  nrtResiProperty?: number;    // 49 — overseas resi property income for NR trust
  nrtResiFinanceBfwd?: number; // 49.1 — unused overseas resi finance costs b/fwd re box 48
  nrtSavings?: ForeignRow[];   // savings income in NR settlor-interested trusts (50/51/51.1)
  nrtDividends?: ForeignRow[]; // dividend income in NR settlor-interested trusts (52/53/53.1)
  nrtDiscretionary?: number;   // 54
  nrtDiscretionaryFig?: number;// 54.1
  nrtCapitalSums?: number;     // 55
  nrtCapitalSumsFig?: number;  // 55.1
  offshoreFundGains?: number;  // 56
  offshoreFundGainsFig?: number; // 56.1
  nonTradeIncome?: number;     // 57
  nonTradeIncomeFig?: number;  // 57.1
  // Transfer of Assets Abroad + Settlements (58–64)
  toaaBenefits?: number;         // 58
  toaaBenefitsFig?: number;      // 58.1
  toaaTpiPfsi?: number;          // 59
  toaaTpiPfsiFig?: number;       // 59.1
  toaaCloseFamily?: number;      // 60
  toaaCloseFamilyFig?: number;   // 60.1
  toaaOnwardGifts?: number;      // 61
  toaaOnwardGiftsFig?: number;   // 61.1
  settleTtiPfsi?: number;        // 62
  settleTtiPfsiFig?: number;     // 62.1
  settleCloseFamily?: number;    // 63
  settleCloseFamilyFig?: number; // 63.1
  settleOnwardGifts?: number;    // 64
  settleOnwardGiftsFig?: number; // 64.1
}

// SA108 Capital gains — one itemised disposal.
export interface CgtDisposal {
  id: string;
  description: string;
  assetType: 'residential' | 'listed' | 'unlisted' | 'other';
  proceeds: number;      // disposal proceeds
  cost: number;          // allowable cost (acquisition + incidental + improvements)
  reliefs?: number;      // gain-reducing reliefs (PRR, lettings, etc.)
  relief?: 'none' | 'badr' | 'investors'; // special 14% rate reliefs
}

// SA108 Capital gains summary — the full supplementary page, box-for-box (Capium
// layout). The legacy per-disposal model lives on `income.capitalGains`; this is
// the box-for-box filing page layered alongside it, as Sa107/Sa106 were.
export interface Sa108 {
  // ── Property and Assets ──
  // Residential property (and carried interest) — boxes 3–13C
  resiDisposals?: number;        // 3  — number of disposals
  resiProceeds?: number;         // 4  — disposal proceeds
  resiCosts?: number;            // 5  — allowable costs (including purchase price)
  resiGains?: number;            // 6  — gains on residential property before losses (excl. carried interest)
  resiFig?: number;              // 6.1 — amount claimed under the FIG regime
  resiLosses?: number;           // 7  — losses in the year
  resiClaimCode?: string;        // 8  — claim / election code
  resiPptGains?: number;         // 9  — total gains/losses on UK residential property on CGT UK Property Disposal returns
  resiPptTaxCharged?: number;    // 10 — tax on gains in box 9 already charged
  resiOverallGain?: number;      // 11 — overall gain or loss
  resiOverallTaxPaid?: number;   // 12 — tax on gains in box 11 already paid
  carriedInterestArising?: number;  // 13  — carried interest (arising basis) before claim/election
  carriedInterestAccruals?: number; // 13A — carried interest (accruals basis) before claim/election
  carriedInterestGains?: number;    // 13B — gains on carried interest (CGT13 + CGT13A less claim/election)
  carriedInterestFig?: number;      // 13C — amount claimed under the FIG regime
  // Cryptoassets — boxes 13.1–13.8
  cryptoDisposals?: number;      // 13.1
  cryptoProceeds?: number;       // 13.2
  cryptoCosts?: number;          // 13.3
  cryptoGains?: number;          // 13.4 — gains in the year, before losses
  cryptoLosses?: number;         // 13.5
  cryptoClaimCode?: string;      // 13.6
  cryptoRtt?: number;            // 13.7 — total gains/losses reported on Real Time Transaction returns
  cryptoRttTaxPaid?: number;     // 13.8 — tax on gains in box 13.7 already paid
  // Other property, assets and gains — boxes 14–22
  otherDisposals?: number;       // 14
  otherProceeds?: number;        // 15
  otherCosts?: number;           // 16
  otherGains?: number;           // 17 — gains in the year, before losses
  otherFig?: number;             // 17.0 — FIG regime
  otherNonResiLand?: number;     // 17.1 — amount in CGT17 re non-residential land & buildings
  otherBadrResiLand?: number;    // 17.2 — amount in box 17 re resi/non-resi land where BADR claimed
  otherBadrShares?: number;      // 17.3 — amount in box 17 re shares & securities where BADR claimed
  otherBadrOther?: number;       // 17.4 — amount in box 17 re other assets where BADR claimed
  otherLosses?: number;          // 19
  otherClaimCode?: string;       // 20
  otherRtt?: number;             // 21 — total gains/losses reported on RTT returns
  otherRttTaxPaid?: number;      // 22 — tax on gains in box 21 already paid
  // ── Shares and Securities ──
  // Listed shares and securities — boxes 23–30
  listedDisposals?: number;      // 23
  listedProceeds?: number;       // 24
  listedCosts?: number;          // 25
  listedGains?: number;          // 26
  listedFig?: number;            // 26.1
  listedLosses?: number;         // 27
  listedClaimCode?: string;      // 28
  listedRtt?: number;            // 29
  listedRttTaxPaid?: number;     // 30
  // Unlisted shares and securities — boxes 31–44
  unlistedDisposals?: number;    // 31
  unlistedProceeds?: number;     // 32
  unlistedCosts?: number;        // 33
  unlistedGains?: number;        // 34
  unlistedFig?: number;          // 34.1
  unlistedLosses?: number;       // 35
  unlistedClaimCode?: string;    // 36
  unlistedRtt?: number;          // 37
  unlistedRttTaxPaid?: number;   // 38
  essExceedingLimit?: number;    // 39 — gains exceeding the lifetime limit for Employee Shareholder Status shares
  seisReinvestment?: number;     // 40 — gains invested under SEIS and qualifying for relief
  lossesUsedAgainstIncome1?: number; // 41 — losses used against income
  shareLossRelief1?: number;     // 42 — amount in box 41 relating to Share Loss Relief in year
  lossesUsedAgainstIncome2?: number; // 43 — losses used against income
  shareLossRelief2?: number;     // 44 — amount in box 43 relating to Share Loss Relief in year
  // ── Losses and adjustments — boxes 45–52 ──
  lossesBfUsed?: number;         // 45 — losses brought forward and used in-year
  incomeLossesSetAgainst?: number; // 46 — income losses in-year set against gains
  lossesCarriedForward?: number; // 47 — losses available to be carried forward
  lossesUsedEarlierYear?: number; // 48 — losses used against an earlier year's gain
  erGainsPre2010?: number;       // 49 — gains qualifying for Entrepreneurs' Relief before 23 June 2010
  badrGains?: number;            // 50 — gains qualifying for Business Asset Disposal Relief
  badrLifetimeClaimed?: number;  // 50.1 — lifetime allowance of BADR/ER claimed to date
  cgtAdjustments?: number;       // 51 — adjustments to Capital Gains Tax
  nonResTrustLiability?: number; // 52 — additional liability for non-resident or dual resident trusts
  // ── Non-resident Capital Gains Tax — boxes 52.1–52QL ──
  nrcgtResiProperty?: number;    // 52.1 — NRCGT: disposals of UK residential property
  nrcgtNonResiProperty?: number; // 52.2 — direct disposals of non-residential UK properties
  nrcgtIndirect?: boolean;       // 52.3 — any gains from indirect disposals
  nrcgtTaxCharged?: number;      // 52.4 — tax on gains in boxes 52.1 & 52.2 already charged
  nrcgtLosses?: number;          // 52.5 — total losses available against NRCGT gains for the year
  eisExcludedSecurities?: number; // 52EG — total gains from disposal of excluded indexed securities
  eisExcludedFig?: number;       // 52EG.1 — FIG regime
  qahcGains?: number;            // 52QG — total gains from QAHC share repurchases & security redemptions
  qahcGainsFig?: number;         // 52QG.1 — FIG regime
  qahcLosses?: number;           // 52QL — total losses from QAHC share repurchases & security redemptions
  // ── Any other information — boxes 53–54 ──
  estimatesOrValuations?: boolean; // 53 — computations include any estimates or valuations?
  otherInformation?: string;       // 54 — additional text note for the Tax Return
}

// ── CGT calculator ────────────────────────────────────────────────────────────
// A per-disposal working that totals up into the SA108 boxes. One asset can be
// co-owned; each owner's share can be pushed to their own return (Phase 2).
export interface CgtOwner {
  id: string;
  name: string;
  sharePct: number;       // 0–100
  isTaxpayer?: boolean;   // the owner whose return this is
  clientId?: string;      // linked client record (for the push-to-their-return)
  clientRef?: string;
}
export type CgtReliefKind = 'prr' | 'lettings' | 'badr' | 'giftHoldover' | 'spouseTransfer' | 'other';
export interface CgtRelief {
  id: string;
  kind: CgtReliefKind;
  label: string;
  amount: number;         // gain-reducing £ (BADR is a rate, so amount 0 + a flag)
  note?: string;          // plain-English rationale
  accepted: boolean;      // the user has accepted the suggestion
  suggested?: boolean;    // proposed by the rules (vs added manually)
}
export interface CgtCalcDisposal {
  id: string;
  description: string;
  assetClass: 'residential' | 'crypto' | 'listed' | 'unlisted' | 'other';
  acquisitionDate?: string; // YYYY-MM-DD
  disposalDate?: string;    // YYYY-MM-DD
  proceeds: number;         // whole-asset proceeds (100%)
  acquisitionCost?: number; // whole-asset
  incidentalCosts?: number; // buying + selling costs (whole-asset)
  improvementCosts?: number;// whole-asset
  owners?: CgtOwner[];      // co-ownership; empty ⇒ 100% the taxpayer
  // Private Residence Relief inputs (residential)
  wasMainResidence?: boolean;
  occupationMonths?: number;
  ownershipMonths?: number;
  wasLet?: boolean;
  // Business Asset Disposal Relief
  claimBadr?: boolean;
  reliefs?: CgtRelief[];
}
export interface CgtCalcState {
  disposals?: CgtCalcDisposal[];
  lossesBroughtForward?: number;  // capital losses brought forward and available
  badrLifetimeUsed?: number;      // BADR/ER gains already claimed to date (default 0)
  lossesCarriedForward?: number;  // computed on save — feeds box 47 + next year's roll-forward
  reviewNotes?: string[];         // last "SMITH Review" AI suggestions
  reviewedAt?: string;
}

export interface Sa100Income {
  employment: EmploymentSource[];
  selfEmployment: TradeSource[];
  partnerships?: PartnershipSource[]; // SA104 — share of partnership profit
  property: PropertySource[];
  // ── SA105 return-level details (boxes 1–4) — one per return, across all
  //    properties. `propertyCount`/`propertyLetJointly` are smart-guessed from the
  //    analysis and overridable. ──
  propertyCount?: number;        // box 1 — number of properties rented out
  propertyCeased?: boolean;      // box 2 — property income ceased in the year
  propertyLetJointly?: boolean;  // box 3 — is the property let jointly
  propertyRentARoom?: boolean;   // box 4 — claim Rent a Room relief
  // ── Interest & dividends (SA100 TR3, boxes 1–7) ──
  taxedInterestItems?: TaxedInterestItem[]; // box 1 — taxed UK interest (net + tax)
  savingsInterest: number;                  // box 2 — untaxed UK interest (scalar fallback)
  savingsInterestItems?: SavingsItem[];     // box 2 breakdown
  untaxedForeignInterest?: number;          // box 3 — untaxed foreign interest (≤ £2,000)
  dividends: number;                        // box 4 — dividends from UK companies (scalar fallback)
  /** Itemised dividend breakdown; when present it drives the dividends total and
   *  is carried over on roll-forward. The `dividends` scalar is the fallback. */
  dividendItems?: DividendItem[];
  otherDividends?: number;                  // box 5 — other dividends (scalar fallback)
  otherDividendsItems?: LineItem[];         // box 5 breakdown
  foreignDividendsMain?: number;            // box 6 — foreign dividends (≤ £500, on the main return)
  foreignDividendsItems?: LineItem[];       // box 6 breakdown
  foreignDividendsTax?: number;             // box 7 — tax taken off foreign dividends
  foreignDividendsTaxItems?: LineItem[];    // box 7 breakdown
  // ── UK pensions & benefits (SA100 TR3, boxes 8–16) ──
  statePension?: number;                    // box 8 — state pension (scalar fallback)
  statePensionItems?: LineItem[];           // box 8 breakdown
  statePensionLumpSumItems?: LineItem[];    // box 9 — state pension lump sum
  statePensionLumpSumTaxItems?: LineItem[]; // box 10 — tax taken off box 9
  pensionsIncome: number;                   // box 11 — pensions (other than State Pension), scalar fallback
  pensionsIncomeItems?: LineItem[];         // box 11 breakdown
  pensionsIncomeTaxItems?: LineItem[];      // box 12 — tax taken off box 11
  incapacityBenefit?: number;               // box 13 — taxable Incapacity Benefit & ESA
  incapacityBenefitTax?: number;            // box 14 — tax taken off box 13
  jobseekersAllowance?: number;             // box 15 — Jobseeker's Allowance
  otherPensionsBenefits?: number;           // box 16 — total of any other pensions & benefits
  /** SA106 — foreign income. Itemised `sources` (each routed to the right rate)
   *  take precedence; the single income/foreignTaxPaid bucket is a fallback. */
  foreign?: Sa106;
  // ── Other UK income (SA100 TR3, boxes 17–21) ──
  otherIncome: number;                      // box 17 — other taxable income (scalar fallback)
  otherIncomeItems?: LineItem[];            // box 17 breakdown
  otherIncomeExpensesItems?: LineItem[];    // box 18 — total allowable expenses
  otherIncomeTaxItems?: LineItem[];         // box 19 — any tax taken off box 17
  preOwnedAssetsItems?: LineItem[];         // box 20 — benefit from pre-owned assets
  otherIncomeDescription?: string;          // box 21 — description of income in boxes 17 & 20
  // ── Tax reliefs (SA100 TR4) — pension payments (boxes 1, 1.1, 2, 3, 4) ──
  pensionContributions: number;             // box 1 — payments to registered schemes (relief at source, net)
  pensionContributionsItems?: LineItem[];   // box 1 breakdown
  pensionOneOff?: number;                   // box 1.1 — total of any one-off payments in box 1
  pensionRetirementAnnuityItems?: LineItem[]; // box 2 — payments to a retirement annuity
  pensionEmployerSchemeItems?: LineItem[];  // box 3 — payments to your employer's scheme
  pensionOverseasItems?: LineItem[];        // box 4 — payments to an overseas pension scheme
  // ── Charitable giving (SA100 TR4, page 4, boxes 5–10) ──
  giftAid: number;             // box 5 — Gift Aid payments made in the year (net); scalar fallback
  giftAidItems?: LineItem[];        // box 5 breakdown
  giftAidOneOffItems?: LineItem[];  // box 6 — one-off payments included in box 5
  giftAidCarryBackItems?: LineItem[]; // box 7 — payments to be treated as paid in the previous year
  giftAidFutureItems?: LineItem[];  // box 8 — payments to be treated as paid in this year
  giftAidSharesItems?: LineItem[];  // box 9 — qualifying shares / securities gifted to charity
  giftAidLandItems?: LineItem[];    // box 10 — qualifying land & buildings gifted to charity
  // ── Blind Person's Allowance (TR4 boxes 13–16) ──
  registeredBlind?: boolean;        // box 13
  blindAuthority?: string;          // box 14 — local authority / register name
  blindSpouseSurplusClaim?: boolean;    // box 15 — claim spouse's surplus allowance
  blindSpouseSurplusSurrender?: boolean; // box 16 — allow spouse to claim your surplus allowance
  // ── Student Loan repayments (TR4 boxes 1–3 + plan types) ──
  studentLoanPlan: 0 | 1 | 2 | 4 | 5; // 0 = none — plan type
  studentLoanRepaymentBegan?: boolean; // box 1 — repayments began before end of tax year
  studentLoanDeducted?: number;     // box 2 — repayments deducted by employer
  postgradLoan?: boolean;           // has a Postgraduate Loan
  postgradLoanDeducted?: number;    // box 3 — postgraduate loan repayments deducted
  /** Residential finance costs (mortgage interest) — relieved as a 20% tax
   *  reducer for individuals, not deducted. Optional; defaults to 0. */
  financeCosts?: number;
  /** Marriage Allowance: 'received' gives a ~£252 reducer; 'transferred'
   *  reduces this person's personal allowance by £1,260. */
  marriageAllowance?: 'none' | 'received' | 'transferred';
  /** Capital gains (SA108). 2025/26 main rates are 18%/24% for both residential
   *  and other assets; BADR / Investors' Relief gains are 14%. Itemised
   *  `disposals` take precedence; the residential/other/losses summary is a
   *  quick-entry fallback when there are no disposals. */
  capitalGains?: {
    disposals?: CgtDisposal[];
    lossesBroughtForward?: number;
    // Quick-summary fallback (used only when disposals is empty)
    residentialGains?: number;
    otherGains?: number;
    losses?: number; // current-year allowable losses
  };
  /** SA108 — the full box-for-box Capital gains summary page. `capitalGains` is
   *  the legacy working model (per-disposal); `sa108` is the filing page. */
  sa108?: Sa108;
  /** CGT calculator working — per-disposal, totals up into the `sa108` boxes. */
  cgtCalc?: CgtCalcState;
  /** Tax residence for the rate bands: 'scotland' uses Scottish rates on
   *  non-savings/non-dividend income (savings & dividends stay UK rates).
   *  Wales currently mirrors UK rates. Defaults to 'uk'. */
  region?: 'uk' | 'scotland';
  /** Child benefit received in the year — drives the High Income Child Benefit
   *  Charge (clawed back between £60k and £80k adjusted net income). */
  childBenefit?: number;                    // TR5 box 1 — total amount received in the year
  childBenefitChildren?: number;            // box 2 — number of children claimed for
  childBenefitStopDate?: string;            // box 3 — date stopped claiming (YYYY-MM-DD)
  /** Winter Fuel Payment / Pension Age Winter Heating Payment received — drives
   *  the high-income WFP/PAWHP charge from 2025/26 (recovered where adjusted net
   *  income exceeds £35,000). */
  winterFuelPayment?: number;
  // ── Marriage Allowance detail (TR5) — spouse / civil partner ──
  spouseFirstName?: string;                 // box 1
  spouseLastName?: string;                  // box 2
  spouseNino?: string;                      // box 3
  spouseDob?: string;                       // box 4 — YYYY-MM-DD
  marriageDate?: string;                    // box 5 — date of marriage / civil partnership (YYYY-MM-DD)
  // ── Finishing your tax return (SA100 TR6, pages 6–7) ──
  // Tax refunded or set off
  taxRefundedOrSetOff?: number;             // box 1 — tax refunded or set off by HMRC / Jobcentre Plus
  noPayeCollectCurrentYear?: boolean;       // box 2 — do not collect current-year tax through the PAYE code
  noPayeCollectNextYear?: boolean;          // box 3 — do not collect next-year tax through the PAYE code
  // If you have paid too much tax — repayment / nominee bank details
  repayBankName?: string;                   // box 4
  repayAccountHolder?: string;              // box 5 — account holder (or nominee)
  repaySortCode?: string;                   // box 6
  repayAccountNumber?: string;              // box 7
  repayBuildingSocRef?: string;             // box 8
  repayNoUkAccount?: boolean;               // box 9 — no UK bank/building society account
  repayNomineeNameEntered?: boolean;        // box 10 — nominee name entered in box 5
  repayNomineeIsAdviser?: boolean;          // box 11 — nominee is your tax adviser
  repayNomineeAddress?: string;             // box 12 — nominee's address
  repayNomineePostcode?: string;            // box 13 — nominee's postcode
  // Your tax adviser
  adviserName?: string;                     // box 15
  adviserPhone?: string;                    // box 16
  adviserAddress?: string;                  // box 17 — first line of address incl. postcode
  adviserReference?: string;                // box 18 — reference your adviser uses for you
  adviserOtherInfo?: string;                // box 19 — any other information
  // Signing your form
  provisionalFigures?: boolean;             // box 20 — return contains provisional figures
  separateSupplementaryPages?: boolean;     // box 21 — separate supplementary pages attached
  dateSigned?: string;                      // date signed (YYYY-MM-DD)
  signingCapacity?: string;                 // box 23 — capacity in which signing (e.g. executor)
  signedForPersonName?: string;             // box 24 — name of the person signed for
  signatoryName?: string;                   // box 25 — if boxes 23 & 24 used, the signatory's name
  signatoryAddress?: string;                // box 26 — signatory's address
  /** Brought-forward trade losses set against this year's trade profit. */
  tradeLossBroughtForward?: number;
  /** SA107 — income from trusts, settlements and estates. `trusts` is the legacy
   *  simplified per-source model (still summed into the tax); `sa107` is the full
   *  box-for-box supplementary page. */
  trusts?: TrustEstateSource[];
  sa107?: Sa107;
  /** SA109 — residence, domicile & remittance basis. Claiming the remittance
   *  basis withdraws the personal allowance and the CGT annual exempt amount. */
  residence?: {
    status?: 'resident' | 'non-resident' | 'split-year';
    splitYearDate?: string;   // date of arrival / departure (dd-mm-yyyy)
    domicile?: 'uk' | 'non-uk';
    remittanceBasis?: boolean;
    daysInUk?: number;
  };
  /** SA101 Additional information — life-insurance chargeable event gains and
   *  the venture-capital / other reliefs that reduce the income-tax liability. */
  additional?: {
    chargeableEventGains?: number;    // life-insurance gains (added to income)
    chargeableEventUkPolicy?: boolean;// UK policy → 20% basic-rate treated as paid
    eisSubscriptions?: number;        // EIS — 30% income-tax reducer
    seisSubscriptions?: number;       // SEIS — 50% reducer
    vctSubscriptions?: number;        // VCT — 30% reducer
    citrInvestment?: number;          // Community Investment Tax Relief — 5% reducer
    maintenancePayments?: number;     // maintenance relief — 10%, capped
  };
}

// ─── Review + intelligence ───────────────────────────────────────────────────
export interface ReviewPoint {
  id: string;
  area: string;
  issue: string;
  explanation: string;
  severity: 'serious' | 'minor' | 'info';
  suggestedFix?: string;
  resolved: boolean;
}

export interface TaxSuggestion {
  id: string;
  title: string;
  category: string;      // e.g. 'Pension', 'Allowances', 'Remuneration'
  estSaving: number;     // £ estimated tax saving
  confidence: number;    // 0–100
  reasoning: string;
  legislation: string;   // supporting reference, e.g. 's.257 ITA 2007'
  appliedToSandbox: boolean;
}

/** A planning scenario — an isolated copy of the income used for what-if maths. */
export interface Scenario {
  id: string;
  name: string;
  base: boolean;         // the live-return mirror ("Current")
  income: Sa100Income;
  note?: string;
}

export type TimelineKind =
  | 'created' | 'imported' | 'analysed' | 'edited' | 'reviewed'
  | 'sent' | 'approved' | 'filed' | 'amended' | 'note';

export interface TimelineEvent {
  id: string;
  at: string;      // ISO
  kind: TimelineKind;
  label: string;
  actor?: string;
}

/** Live snapshot pulled from other SMITH modules (Connected Data panel). */
export interface ConnectedSource {
  id: string;
  module: string;      // 'accounts-studio' | 'payroll' | ...
  label: string;       // display name
  value: string;       // headline figure / status
  detail?: string;
  linked: boolean;     // whether real data was found for this client
}

export type ApprovalStatus = 'sent' | 'approved' | 'rejected' | 'submitted';

export interface TaxReturn {
  id: string;
  clientId: string | null;
  clientRef: string | null;
  clientName: string;
  returnType: ReturnTypeId;
  /** Tax year label, e.g. '2025/26'. */
  taxYear: string;
  utr?: string | null;
  /** Taxpayer personal details for the return — pulled from the client record,
   *  editable in Setup, and used on the tax return itself. */
  taxpayer?: { address?: string; dateOfBirth?: string; nino?: string };
  /** Human label for the entity, e.g. 'Individual', 'Limited company'. */
  entityLabel: string;
  preparedBy: string;
  amended?: boolean;
  late?: boolean;
  context?: string; // free-text standing notes / relevant context

  status: ReturnStatus;
  stageStatus: Record<StageId, StageState>;

  income: Sa100Income;
  reviewPoints: ReviewPoint[];
  suggestions: TaxSuggestion[];
  scenarios: Scenario[];
  connected: ConnectedSource[];
  timeline: TimelineEvent[];

  // Client-approval + submission lifecycle (owned by dedicated routes later).
  approvalStatus?: ApprovalStatus;
  sentAt?: string;
  approvedAt?: string;
  submittedAt?: string;
  submissionRef?: string;

  createdAt?: string;
  updatedAt?: string;
}
