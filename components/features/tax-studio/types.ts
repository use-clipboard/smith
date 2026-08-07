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
export interface PartnershipSource {
  id: string;
  name: string;
  utr?: string;                 // partnership UTR
  periodStart?: string;         // basis period start (dd-mm-yyyy)
  periodEnd?: string;           // basis period end (dd-mm-yyyy)
  profit: number;               // share of the partnership's taxable trade profit
  adjustments?: number;         // basis-period / overlap adjustments (+/−)
  lossBroughtForward?: number;  // share of loss brought forward, used this year
  taxTaken?: number;            // share of CIS / tax deducted at source
  class4Exempt?: boolean;       // partner exempt from Class 4 NIC
  // Share of the partnership's other income (SA104F), routed to the right rate
  savingsInterest?: number;     // share of savings interest
  dividends?: number;           // share of dividends
}
// SA103F Self-employment (full). Box numbers follow the Capium Self Employment
// (full) layout: Business details / Business Expenses / Net profit(loss) /
// Losses, CIS / Balance Sheet. Blue "total" boxes are computed (see calc.ts).
export interface TradeSource {
  id: string;
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
export interface PropertySource {
  id: string;
  address: string;
  // Income
  rents?: number;        // box 20 — total rents & other income from property
  taxTaken?: number;     // box 21 — tax taken off any income in box 20
  premiums?: number;     // box 22 — premiums for the grant of a lease
  // Allowable expenses (boxes 24–29)
  expPremises?: number;    // 24 — rent, rates, insurance, ground rents
  expRepairs?: number;     // 25 — property repairs & maintenance
  expLoanInterest?: number;// 26 — non-residential loan interest & finance costs
  expProfessional?: number;// 27 — legal, management & professional fees
  expServices?: number;    // 28 — costs of services, incl. wages
  expOther?: number;       // 29 — other allowable property expenses
  // Tax adjustments
  privateUse?: number;         // 36 — private use adjustment (add back)
  balancingCharges?: number;   // 37 — balancing charges (add back)
  aia?: number;                // 38 — annual investment allowance (deduct)
  capitalAllowances?: number;  // other property capital allowances (deduct)
  domesticItems?: number;      // 40 — replacement of domestic items relief (deduct)
  residentialFinanceCosts?: number; // 44 — residential finance costs → 20% reducer
  rentARoom?: number;          // Rent a Room relief claimed (deduct)
  lossBroughtForward?: number; // 43 — loss brought forward used this year
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

export interface Sa100Income {
  employment: EmploymentSource[];
  selfEmployment: TradeSource[];
  partnerships?: PartnershipSource[]; // SA104 — share of partnership profit
  property: PropertySource[];
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
  foreign?: {
    sources?: ForeignSource[];
    income?: number;
    foreignTaxPaid?: number;
  };
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
  /** SA107 — income from trusts, settlements and estates. */
  trusts?: TrustEstateSource[];
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
