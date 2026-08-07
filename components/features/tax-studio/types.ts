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
  | 'awaiting-approval'
  | 'approved'
  | 'ready-to-file'
  | 'filed'
  | 'amended'
  | 'archived';

// ─── SA100 income model (Phase 1) ────────────────────────────────────────────
// SA102 Employment — one per employment. Box numbers follow the HMRC SA102 form.
export interface EmploymentSource {
  id: string;
  employer: string;        // box 5 (employer name)
  payeRef?: string;        // box 4 (PAYE tax reference)
  pay: number;             // box 1 — pay from P60/P45 (gross)
  taxDeducted: number;     // box 2 — UK tax taken off box 1
  tips?: number;           // box 3 — tips & other payments not on the P60
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
// SA103F Self-employment (full). Box numbers follow the HMRC SA103F form.
export interface TradeSource {
  id: string;
  name: string;              // box 1 (business name)
  description?: string;      // box 2 (description of business)
  periodStart?: string;      // box 8 (accounting period start, dd-mm-yyyy)
  periodEnd?: string;        // box 9 (accounting period end, dd-mm-yyyy)
  // Business income
  turnover?: number;           // box 15 — turnover
  otherBusinessIncome?: number; // box 16 — any other business income
  // Allowable business expenses (boxes 17–30)
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
  // Tax adjustments
  goodsOwnUse?: number;       // goods/services for own use (added back)
  balancingCharges?: number;  // balancing charges (added back)
  aia?: number;               // annual investment allowance (deducted)
  cisDeductions?: number;     // CIS tax already deducted at source
  // Core / legacy — accounts net profit (fallback when not itemised), plus the
  // disallowables add-back and total other capital allowances.
  profit: number;             // accounts net profit / (loss)
  addBacks?: number;          // total disallowable expenses added back
  capitalAllowances?: number; // other capital allowances (WDA etc.)
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
  dividends: number;
  savingsInterest: number;
  pensionsIncome: number;      // taxable private pensions received
  statePension?: number;       // state pension (paid gross, no PAYE)
  /** SA106 — foreign income. Itemised `sources` (each routed to the right rate)
   *  take precedence; the single income/foreignTaxPaid bucket is a fallback. */
  foreign?: {
    sources?: ForeignSource[];
    income?: number;
    foreignTaxPaid?: number;
  };
  otherIncome: number;
  // Reliefs / deductions
  giftAid: number;             // net gift aid donations paid
  pensionContributions: number; // personal contributions (relief at source, net)
  studentLoanPlan: 0 | 1 | 2 | 4 | 5; // 0 = none
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
  childBenefit?: number;
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
