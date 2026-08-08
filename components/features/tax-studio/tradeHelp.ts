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

// ── SA100 core page ("Income & reliefs") ─────────────────────────────────────
export const CH = {
  // Interest & dividends
  taxedInterest: 'UK interest already taxed at source (rare now) — enter the net amount received and the tax taken off. Most bank/building-society interest is paid untaxed (use the box below).',
  untaxedInterest: 'UK interest received without tax taken off — e.g. bank, building-society and NS&I interest. Enter the gross amount. The Personal Savings Allowance (£1,000/£500) is applied for you.',
  untaxedForeignInterest: 'Interest from overseas up to £2,000 that you’re reporting here without the full Foreign pages. Above £2,000 use the Foreign (SA106) section.',
  dividends: 'Dividends from UK companies and unit trusts — enter the cash amount received. The £500 dividend allowance is applied for you.',
  otherDividends: 'Other dividend-type income not from ordinary UK shares — e.g. authorised unit trusts, open-ended investment companies, stock dividends.',
  foreignDividends: 'Dividends from overseas companies up to £2,000 reported here without the full Foreign pages. Above £2,000 use the Foreign (SA106) section.',
  foreignDividendsTax: 'Foreign tax already taken off those foreign dividends — may be claimable as Foreign Tax Credit Relief.',
  // Pensions & benefits
  statePension: 'The total State Pension you were ENTITLED to for the year (not necessarily what was paid) — from your DWP letter. It’s paid without tax taken off.',
  statePensionLumpSum: 'A one-off State Pension lump sum from deferring your State Pension — taxed at your highest existing rate, not added to your other income.',
  pensionsIncome: 'Pensions other than the State Pension — workplace, personal and annuity income (the taxable amount on your P60/statement).',
  incapacityBenefit: 'Taxable Incapacity Benefit or contribution-based Employment and Support Allowance received in the year.',
  jobseekersAllowance: 'Taxable Jobseeker’s Allowance received in the year.',
  otherPensionsBenefits: 'Other taxable state benefits not covered above (e.g. Carer’s Allowance, Bereavement Allowance).',
  // Other UK income
  otherIncome: 'Casual or miscellaneous taxable income that doesn’t belong elsewhere — e.g. freelance one-offs, commission, or income from a hobby.',
  otherIncomeDescription: 'A short description of what the other income in boxes 17 and 20 is. Use the AI suggestion or type your own.',
  preOwnedAssets: 'The Pre-Owned Assets charge — an income-tax charge where you still benefit from an asset you previously gave away.',
  // Pension payments (reliefs)
  pensionContributions: 'Personal pension contributions paid NET (after 20% relief at source) — the provider adds basic-rate relief and we extend your basic-rate band for higher-rate relief.',
  pensionOneOff: 'The part of the box above that was a one-off (not regular) payment — helps HMRC set your PAYE code correctly.',
  pensionRetirementAnnuity: 'Payments to a retirement annuity contract (pre-1988 style) paid gross — relief is given by extending your basic-rate band.',
  pensionEmployerScheme: 'Contributions to your employer’s scheme where relief was NOT already given through payroll.',
  pensionOverseas: 'Contributions to a qualifying overseas pension scheme eligible for UK relief (e.g. migrant member relief).',
  // Charitable giving
  giftAid: 'Total Gift Aid donations paid in the year (the amount you actually gave). Charities reclaim 20% and your basic-rate band is extended for higher-rate relief. Only include gifts where you made a valid Gift Aid declaration.',
  giftAidOneOff: 'The part of the Gift Aid total above that was one-off (not regular) — informational, for HMRC’s records.',
  giftAidCarryBack: 'Gift Aid paid THIS year that you elect to treat as paid in the PREVIOUS tax year (to get relief a year earlier).',
  giftAidFuture: 'Gift Aid paid AFTER the tax year end that you elect to treat as paid in THIS year.',
  giftAidShares: 'The value of qualifying shares or securities given to charity — relieved as a deduction from your income at your marginal rate.',
  giftAidLand: 'The value of qualifying land or buildings given to charity — relieved as a deduction from your income at your marginal rate.',
  // Blind / student loan
  registeredBlind: 'Tick if you are registered blind / severely sight-impaired — this adds the Blind Person’s Allowance to your tax-free amount.',
  blindAuthority: 'The local authority or register you’re certified blind with (needed to claim the allowance).',
  spouseSurplusClaim: 'Tick to claim your spouse’s or civil partner’s UNUSED Blind Person’s Allowance.',
  spouseSurplusSurrender: 'Tick to give YOUR unused Blind Person’s Allowance to your spouse or civil partner.',
  studentLoanPlan: 'Your student-loan plan type — it sets the income threshold above which 9% repayments are due. Check your plan (1/2/4/5) on your loan statement.',
  studentLoanDeducted: 'Student-loan repayments already deducted by your employer through payroll this year — credited so you’re not charged twice.',
  postgradLoan: 'Tick if you have a Postgraduate Loan — repaid at 6% above £21,000, on top of any Plan 1/2/4/5 loan.',
  region: 'Your tax region. Scotland uses different income-tax bands on earnings; savings and dividends stay on UK rates.',
  // Child benefit / WFP
  childBenefit: 'The total Child Benefit you (or your partner) received in the year — drives the High Income Child Benefit Charge if adjusted net income is over £60,000.',
  childBenefitChildren: 'The number of children you claimed Child Benefit for — used for the charge calculation.',
  childBenefitStopDate: 'If you stopped claiming Child Benefit during the year, the date it stopped.',
  winterFuelPayment: 'Winter Fuel Payment / Pension Age Winter Heating Payment received — recovered through a charge if your adjusted net income is over £35,000 (2025/26).',
  // Marriage allowance
  marriageAllowance: 'Transferred IN = you receive 10% of a spouse’s personal allowance (a £252 tax reduction). Transferred OUT = you give 10% of yours to a spouse. Only one applies.',
  // Finishing your tax return
  taxRefundedOrSetOff: 'Tax already refunded to you, or set off, by HMRC or Jobcentre Plus during the year — added back so your final position is right.',
  noPayeCollect: 'Tick to stop HMRC collecting the tax you owe through next year’s PAYE tax code (you’ll pay it directly instead).',
} as const;

// ── Employment (SA102) ───────────────────────────────────────────────────────
// Plain-English hints for the technical / easily-confused employment boxes only —
// the obvious ones (Pay before tax, UK tax taken off) are left without a hint.
export const EMP = {
  payeRef: 'Your employer’s PAYE reference — 3 digits, a slash, then their office code (e.g. 068/AZ77194). It’s on your P60 or P45. Leave blank if you don’t have it.',
  director: 'Answer Yes if you were a director of the company at any point in the year — HMRC treats directors’ pay slightly differently.',
  closeCompany: 'A close company is one controlled by 5 or fewer shareholders (or its directors) — most owner-managed limited companies. Tick if this employer is one.',
  closeCompanyDividends: 'A declaration only — enter the dividend cash itself in the Interest & dividends section so it’s taxed once, not here.',
  closeCompanyShareholding: 'The percentage of the company’s shares you held — used only for HMRC’s records, not the tax calculation.',
  teachersLoanOffPayroll: 'Tick only if you repaid a Teachers’ Loan under that scheme, or the engagement was inside off-payroll working (IR35) rules.',
  payrolledBenefitsStudentLoan: 'The part of box 6 that is payrolled benefits-in-kind — separated out because it counts towards student-loan repayments.',
  tips: 'Tips, gratuities and other taxable payments from the job that were NOT already included on your P60.',
  class1Nic: 'Class 1 National Insurance already deducted from your pay — from your P60. Informational; it doesn’t change your income-tax bill.',
  benExpPayments: 'Expenses your employer paid or reimbursed that count as taxable, plus any balancing charges — the total from section N of your P11D.',
  expFixed: 'Flat-rate (fixed) job expenses agreed with HMRC for your occupation — e.g. tools or uniform upkeep — claimed without keeping receipts.',
  expProfessional: 'Fees and annual subscriptions to professional bodies on HMRC’s approved (List 3) — only these qualify for relief.',
  expOther: 'Other allowable employment expenses, including capital allowances for equipment you must buy to do your job.',
} as const;

// ── Partnership (SA104) ──────────────────────────────────────────────────────
// You enter YOUR SHARE of figures the partnership already worked out on its own
// SA800 return — not the whole partnership's numbers. Hints cover the technical
// boxes only; the obvious share figures are left without a hint.
export const PH = {
  utr: 'The partnership’s 10-digit Unique Taxpayer Reference (UTR) — from the SA800 partnership return or HMRC correspondence. Not your personal UTR.',
  becamePartner: 'Answer Yes only if you joined this partnership during the tax year (after 5 April). If Yes, enter the date you joined.',
  ceasedPartner: 'Answer Yes if you left this partnership during the tax year. If Yes, enter the date you left.',
  shareOfProfit: 'YOUR share of the partnership’s profit or loss, as allocated to you on the SA800 Partnership Statement — not the whole partnership’s profit.',
  adjustmentPeriod: 'Adjustment where your basis period isn’t a straight 12 months to the tax-year end (e.g. you joined mid-year, or the accounts don’t end on 31 March / 5 April).',
  accountingAdjustment: 'An adjustment to your share of profit for tax purposes (e.g. overlap relief used, or a change in how the accounts are drawn up).',
  averagingAdjustment: 'For farmers, market gardeners and creators of literary or artistic work — averages profits over two or five years to smooth tax.',
  foreignTaxDeduction: 'Foreign tax on the partnership’s income that you’re claiming as a deduction from the profit rather than as Foreign Tax Credit Relief.',
  adjustedProfit: 'Your share of profit after the adjustments above. Computed for you.',
  transitionProfit: 'Basis-period reform: the portion of transition profit (2023/24 spreading) treated as arising in this tax year.',
  transitionLossBfwd: 'Losses brought forward that you’re setting against this year’s slice of the spread transition profit.',
  lossBroughtForwardUsed: 'Unused partnership losses from earlier years, set against this year’s profit from the SAME partnership.',
  unusedLossCarriedForward: 'Any brought-forward loss you’re choosing to keep carrying forward rather than use this year.',
  taxableProfit: 'Your taxable profit after transition profit and losses used. Computed for you.',
  otherBusinessIncome: 'Business income taxable as trading profit that wasn’t part of your profit share above (e.g. certain untaxed receipts).',
  totalTaxableProfits: 'Your final taxable profit from this partnership. Computed for you and taxed as non-savings income.',
  fig: 'Amount claimed under the Foreign Income and Gains (FIG) regime, if you’re a qualifying new UK resident.',
  adjustedLoss: 'Your share of this year’s loss from the partnership. Computed for you when the adjusted result is negative.',
  lossAgainstOtherIncome: 'The part of this year’s loss you’re setting against your other income or gains this year (sideways relief).',
  lossCarriedBack: 'The part of this year’s loss you’re carrying back against an earlier year’s profit.',
  totalLossCarryForward: 'The loss to carry forward to next year against future profits of this partnership. Computed for you.',
  class2Voluntary: 'Tick to pay Class 2 NIC voluntarily — worth it to protect your State Pension and benefits if your share of profit is below the threshold.',
  class4Exempt: 'Tick if you’re exempt from Class 4 NIC — e.g. over State Pension age at the start of the year, or under 16.',
  class4Adjustment: 'An adjustment to the profit on which your Class 4 NIC is charged (e.g. for certain reliefs or losses).',
  willingClass2: 'Confirms you were a partner for the whole tax year and are willing to pay Class 2 NIC for the full year.',
  ukSavings: 'Your share of the partnership’s UK savings interest received WITHOUT tax taken off — taxed at your savings rates (the allowance is applied for you).',
  foreignSavings: 'Your share of the partnership’s foreign savings interest received without UK tax taken off.',
  foreignSavingsTax: 'Foreign tax already taken off that foreign savings income — may be claimable as Foreign Tax Credit Relief.',
  propertyShare: 'Your share of the profit or loss from the partnership’s UK property business, from the SA800 Partnership Statement.',
  propertyFinanceCosts: 'Residential-property mortgage/loan interest — relieved as a 20% tax reducer, not deducted from profit.',
  offshoreIncome: 'Your share of income from offshore funds (certain overseas collective investments), taxed as savings-type income.',
  foreignIncome: 'Your share of the partnership’s other untaxed foreign income not covered by the savings or offshore-funds boxes.',
  taxedIncome10: 'Your share of partnership income that has already had tax credited at 10% (e.g. certain older dividend-type income).',
  taxedIncome20: 'Your share of partnership income that has already had tax taken off at 20% (e.g. taxed interest) — the tax is credited against your bill.',
  otherTaxedIncome: 'Your share of other partnership income that has already had tax taken off at a different rate.',
  incomeTaxTaken: 'Your share of income tax already taken off the partnership’s income — credited against your tax bill.',
  cisDeductions: 'Your share of tax deducted from the partnership’s payments under the Construction Industry Scheme (CIS) — credited against your bill.',
  taxTakenTradingIncome: 'Your share of any other tax already taken off the partnership’s trading income at source.',
  totalTaxTaken: 'Your total share of tax already taken off (boxes 77 to 79). Computed for you and credited against your bill.',
  taxedInterestShort: 'Your share of the partnership’s interest and other income that already had tax taken off at source — the tax is credited against your bill.',
  otherInformation: 'Any additional notes for HMRC about this partnership (e.g. an explanation of an entry or a claim). Free text — leave blank if nothing applies.',
} as const;

// ── UK Property (SA105) ──────────────────────────────────────────────────────
// Each property is entered separately; the boxes are summed into one SA105.
export const PROP = {
  propertyCount: 'The number of UK properties you received rental income from in the year. SMITH guesses this from the properties added below — change it if it’s wrong.',
  ceased: 'Tick if you stopped receiving UK property income during the year (e.g. you sold or stopped letting all your properties).',
  letJointly: 'Tick if any property is let jointly with someone else (e.g. a spouse). Enter only YOUR share of the income and expenses. SMITH ticks this automatically when a Landlord-linked property has additional owners.',
  claimRentARoom: 'Tick if you’re claiming Rent a Room relief — rent from a lodger in your own home is tax-free up to £7,500 (£3,750 if shared).',
  incomeAllowance: 'The £1,000 property income allowance — claim it INSTEAD of your actual expenses when expenses are under £1,000. You cannot claim both.',
  traditionalAccounting: 'Tick if you use traditional (accruals) accounting — income when it’s due and costs when incurred. Leave unticked for the cash basis (when money changes hands).',
  premiums: 'A lump sum received for granting a lease of 50 years or less — part of it is taxed as income.',
  reversePremiums: 'A payment or benefit you received as an inducement to take on a lease (e.g. a rent-free period paid in cash).',
  loanInterest: 'For non-residential lets, loan interest is a normal expense here. For RESIDENTIAL lets, put finance costs in box 44 instead — they get a 20% tax reducer, not a deduction.',
  privateUse: 'The part of the expenses above that relates to your own private (non-letting) use — added back so it isn’t claimed.',
  balancingCharges: 'A balancing charge — added back when you sell an item you claimed capital allowances on for more than its tax written-down value.',
  aia: 'Annual Investment Allowance — 100% relief on qualifying equipment for the property business (not the dwelling itself), up to the annual limit.',
  domesticItems: 'Replacement of domestic items relief — the cost of replacing (not first buying) furnishings, appliances and kitchenware in a residential let.',
  rentARoomExempt: 'The Rent a Room exempt amount you’re deducting (up to £7,500 / £3,750) where receipts are within the limit.',
  adjustedProfit: 'Income − expenses + adjustments − allowances for this property. Computed for you.',
  lossBroughtForward: 'Unused property losses from earlier years, set against this property business’s profit this year.',
  taxableProfit: 'Taxable profit after losses brought forward. Computed for you and summed across all properties into the SA105.',
  adjustedLoss: 'This year’s property loss. Computed for you. Property losses carry forward — they can’t be set against your other income.',
  lossCarryForward: 'The loss to carry forward to next year. Computed for you.',
  residentialFinanceCosts: 'Residential mortgage/loan interest — relieved as a 20% tax reducer, NOT deducted from profit. Enter the full amount here.',
} as const;
