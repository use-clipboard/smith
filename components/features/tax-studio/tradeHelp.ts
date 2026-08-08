// Plain-English hover help for the technical / easily-confused SA103 boxes.
// Shown via the standard <Tooltip> as a subtle ⓘ next to the field label.
// Kept concise (one or two sentences: what it is, what to enter, when it applies).

export const H = {
  // ── Business details ──
  detailsChanged: 'Tick if the business name or address changed during the tax year, so HMRC can update their records.',
  fosterCarer: 'Tick if you are a foster or shared-lives carer — your care receipts may be exempt under Qualifying Care Relief.',
  startedInYear: 'Answer Yes only if the business began trading during this tax year (after 5 April). If Yes, enter the start date.',
  ceasedInYear: 'Answer Yes if the business stopped trading during this tax year. If Yes, enter the date it ceased.',
  periodStart: 'The first day of the accounting period these figures cover — usually your 12-month accounts year.',
  periodEnd: 'The last day of the accounting period these figures cover — your accounting year-end.',
  accountsMadeUpTo: 'The date your accounts are made up to — i.e. your accounting year-end.',
  traditionalAccounting: 'Tick if you use traditional (accruals) accounting — income when invoiced and costs when incurred. Leave unticked for the cash basis (when money actually changes hands).',
  specialArrangements: 'Tick only if HMRC has agreed special tax arrangements for your business (uncommon).',
  priorYearProfitDetails: 'Tick if the profit figures were provided on last year’s return (e.g. for a business that started before this year).',

  // ── Income ──
  tradingIncomeAllowance: 'The £1,000 trading allowance — claim it instead of your actual expenses when your expenses are under £1,000. You cannot claim both.',
  otherBusinessIncome: 'Business income not counted in turnover — e.g. certain grants, or the release of a trade debt.',

  // ── Disallowables ──
  disallowables: 'The part of the expense above that is NOT allowable for tax and is added back — e.g. depreciation, client entertaining, private-use portion, fines and penalties.',
  disTotal: 'The total of the disallowable amounts entered above — added back to profit. Computed for you.',

  // ── Capital allowances (full) ──
  aia: 'Annual Investment Allowance — 100% tax relief on qualifying equipment and plant bought in the year, up to £1,000,000.',
  ca18: 'Writing-down allowance on the main pool at 18% a year — most plant, machinery and vehicles you haven’t claimed AIA on.',
  ca6: 'Writing-down allowance on the special-rate pool at 6% a year — integral features, long-life assets and higher-emission cars.',
  zeroEmissionGoods: '100% first-year allowance for new zero-emission goods vehicles.',
  zeroEmissionCar: '100% first-year allowance for a new fully electric / zero-emission car.',
  sba: 'Structures and Buildings Allowance — 3% a year on the cost of qualifying non-residential buildings and structures.',
  sbaFreeport: 'Enhanced Structures and Buildings Allowance for assets in a Freeport or Investment Zone.',
  electricChargepoint: '100% first-year allowance for installing electric-vehicle charge-point equipment.',
  enhancedCapitalAllowances: 'Other 100% first-year or enhanced allowances (e.g. full expensing on qualifying new plant).',
  allowancesOnSale: 'A balancing allowance — extra relief when a pool still has value left after the business or asset use ceases.',
  balancingCharge: 'A balancing charge — added back to profit when you sell an asset for more than its tax written-down value.',

  // ── Capital allowances (short) ──
  smallBalance: 'Writes off a small remaining pool balance of £1,000 or less in one go, instead of carrying it forward at 18%/6%.',
  otherCapitalAllowances: 'Any other capital allowances not entered in the boxes above (e.g. special-rate pool, first-year allowances).',

  // ── Taxable profit adjustments (full) ──
  goodsOwnUse: 'The value of stock or services you took for personal use — added back at what you would have charged a customer.',
  incomeReceiptsElsewhere: 'Income in your accounts that is taxed elsewhere (not as trading profit) — deducted here to avoid taxing it twice.',
  netProfitForTax: 'Accounts profit adjusted for tax: net profit + add-backs (disallowables, goods for own use, balancing charge) − capital allowances. Computed for you.',
  basisAdjustment: 'Adjustment where your accounting period is not a straight 12 months to the tax-year end (basis-period reform / overlap relief).',
  changeOfPractice: 'Adjustment when you change how your accounts are prepared (e.g. moving between the cash basis and traditional accounting).',
  averaging: 'For farmers, market gardeners and creators of literary or artistic work — averages profits over two or five years to smooth tax.',
  adjustedProfit: 'Your tax-adjusted profit after the adjustments above. Computed for you.',
  transitionProfit: 'Basis-period reform: the portion of transition profit (2023/24 spreading) treated as arising this year.',
  transitionLossBfwd: 'Losses brought forward set against this year’s slice of the spread transition profit.',
  totalTaxableProfit: 'Your final taxable profit after losses brought forward and other adjustments. Computed for you.',
  figClaim: 'Amount claimed under the Foreign Income and Gains (FIG) regime, if you are a qualifying new UK resident.',

  // ── Losses ──
  lossBroughtForward: 'Unused trading losses carried forward from earlier years, set against this year’s profit of the SAME trade. Fills automatically when the trade is rolled forward.',
  unusedLossCarriedForward: 'Any brought-forward loss you are choosing to keep carrying forward rather than use this year.',
  adjustedLoss: 'This year’s tax-adjusted loss. Computed for you.',
  lossSetOff: 'The amount of this year’s loss set against your other income or gains this year (sideways relief).',
  lossCarriedBack: 'The amount of this year’s loss you are carrying back against an earlier year’s profit.',
  lossCarriedForward: 'The loss to carry forward to next year — any unused brought-forward loss plus this year’s unrelieved loss. Computed for you.',
  otherBusinessIncome75: 'Other business income taxable as trading profit that was not included in turnover or box 16.',

  // ── CIS & NIC ──
  cisDeductions: 'Tax already deducted from your payments by contractors under the Construction Industry Scheme — credited against your bill.',
  otherTaxTaken: 'Any other tax already taken off your trading income at source.',
  class2Voluntary: 'Tick to pay Class 2 NIC voluntarily — worth it to protect your State Pension and benefits if your profits are below the threshold.',
  class4Exempt: 'Tick if you are exempt from Class 4 NIC — e.g. over State Pension age at the start of the year, or under 16.',
  class4Adjustment: 'An adjustment to the profit on which Class 4 NIC is charged (e.g. for certain reliefs or losses).',
  willingClass2: 'Confirms you were self-employed for the whole tax year and are willing to pay Class 2 NIC for the full year.',
} as const;
