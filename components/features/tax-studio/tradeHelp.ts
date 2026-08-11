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
  foreignDividends: 'Dividends from overseas companies up to £500 reported here without the full Foreign pages. Above £500 use the Foreign (SA106) section.',
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

// ── Foreign (SA106) ──────────────────────────────────────────────────────────
export const FGN = {
  unremittable: 'Tick if you couldn’t bring some overseas income to the UK because of exchange controls or a shortage of foreign currency — it’s then taxed only when you can transfer it.',
  ftcrOnIncome: 'Foreign Tax Credit Relief you’re claiming on your overseas income — a credit for foreign tax already paid, capped at the UK tax on the same income. SMITH totals the per-row claims for you.',
  country: 'The country or territory the income came from — use HMRC’s SA106 notes for the code.',
  incomeArising: 'The gross income arising in the country before any foreign tax — in £ sterling.',
  foreignTax: 'Foreign tax actually taken off or paid on this income, in £ sterling.',
  specialWithholding: 'Special Withholding Tax (e.g. under the EU Savings Directive) taken off at source — credited against your UK bill.',
  creditRelief: 'Tick to claim Foreign Tax Credit Relief on this row — a credit for the foreign tax, capped at the UK tax on the same income. Leave unticked to instead deduct the foreign tax from the income.',
  propAllowance: 'The £1,000 property income allowance — claim it instead of actual expenses when expenses are under £1,000. You cannot claim both.',
  cgUkGain: 'The chargeable gain on the foreign asset worked out under UK rules.',
  cgForeignGain: 'The chargeable gain worked out under the other country’s tax rules — used to work out the credit relief.',
  lifeGains: 'Gains on foreign life insurance policies, capital redemption policies and life annuity contracts.',
  lifeYears: 'The number of complete years the policy was held — used for top-slicing relief.',
  fig: 'Amount of this income you’re claiming under the Foreign Income and Gains (FIG) regime as a qualifying new UK resident.',
} as const;

// SA108 Capital gains summary
export const CGT = {
  disposals: 'The number of disposals of this type in the year — count each asset (or share pool) sold, given away or otherwise disposed of.',
  proceeds: 'Total sale proceeds (or market value on a gift / connected-party disposal) for disposals of this type, before deducting costs.',
  costs: 'Allowable costs — the purchase price plus incidental costs of buying and selling and any capital improvements.',
  gains: 'Total chargeable gains of this type in the year, before deducting losses — after any Private Residence Relief or other reliefs.',
  losses: 'Allowable capital losses of this type arising in the year — set first against gains taxed at the highest rate.',
  fig: 'Amount of the gain you’re claiming under the Foreign Income and Gains (FIG) regime as a qualifying new UK resident.',
  claimCode: 'Enter HMRC’s relevant claim or election code (e.g. PRR, GHO, LET) — see the SA108 notes.',
  rtt: 'Total gains or losses on disposals of this type already reported on a Real Time Transaction return during the year.',
  rttTaxPaid: 'CGT already paid on the gains reported on Real Time Transaction returns.',
  pptGains: 'Total gains or losses on UK residential property already reported on a CGT UK Property Disposal (60-day) return.',
  pptTaxCharged: 'CGT already charged on the gains reported on the UK Property Disposal return — credited against your bill.',
  carriedInterest: 'Carried interest is the performance share fund managers receive — taxed as a capital gain, entered before any claim or election.',
  badr: 'Gains qualifying for Business Asset Disposal Relief (formerly Entrepreneurs’ Relief) — taxed at 14% for 2025/26, up to the £1m lifetime limit.',
  badrLifetime: 'The cumulative BADR / Entrepreneurs’ Relief you have already claimed against the £1m lifetime limit in earlier years.',
  badrSplit: 'Of the total in box 17, the amount relating to this asset class where BADR is being claimed — so it’s taxed at the 14% rate.',
  lossesBf: 'Capital losses brought forward from earlier years, used against this year’s gains after the annual exempt amount.',
  lossesCf: 'Unused capital losses carried forward to set against future gains.',
  incomeLosses: 'Trading or other income losses you’re setting against this year’s capital gains.',
  essLimit: 'Gains on Employee Shareholder Status shares above the £100,000 lifetime exemption.',
  seis: 'Gains reinvested under the Seed Enterprise Investment Scheme and qualifying for SEIS reinvestment relief.',
  shareLossRelief: 'Of the losses used against income, the amount that is Share Loss Relief on qualifying unlisted / EIS shares claimed in-year.',
  nrcgt: 'Non-Resident Capital Gains Tax on UK land and property — for periods you were non-UK resident.',
  nrcgtIndirect: 'Tick if any of the NRCGT gains are from indirect disposals of UK property (e.g. shares in a property-rich company).',
  eisExcluded: 'Gains on excluded indexed securities (deeply discounted / index-linked) that are chargeable to CGT.',
  qahc: 'Gains or losses on Qualifying Asset Holding Company share repurchases and security redemptions.',
  estimates: 'Tick if your computations include any estimates or valuations (e.g. a probate value or an apportionment) — then explain them in box 54.',
  adjustments: 'Any adjustment to the Capital Gains Tax otherwise due (for example under an averaging or recomputation).',
} as const;

// SA107 Trusts & estates
export const TRUST = {
  discretionary: 'A discretionary payment from a UK trust — enter the NET amount received. SMITH grosses it up at the 45% trust rate and gives you the tax credit.',
  settlorInterested: 'Total payments you received from trusts you (or your spouse) settled — a memo figure; the income itself is taxed on the settlor.',
  nonDiscNet: 'Income you were entitled to from a trust (not a discretionary payment) — enter the net amount by type; it carries the tax already suffered.',
  trusteesNonResident: 'Tick if the trustees are not resident in the UK for tax purposes — this affects how the income and any credit are treated.',
  settlorChargeable: 'Income of a settlor-interested trust that is chargeable on you as the settlor — enter the net amount at the rate shown.',
  lifeAssurance: 'Tax treated as paid on a gain from certain UK life assurance policies held within the trust.',
  estateIncome: 'Income from a deceased person’s estate, entered by type at the amount received after tax — from the R185 (Estate Income) the executors give you.',
  estateDividend75: 'Estate dividend income that bore tax at 7.5% (the pre-2016 dividend trust rate), entered after the tax taken off.',
  estateNonRepayable: 'Estate non-savings income taxed at a basic rate that is not repayable — the credit can’t be refunded, only set against your bill.',
  foreignEstate: 'Income from a foreign estate — enter each estate’s income, the foreign tax paid and any UK tax withheld; the three totals feed boxes 22, 24 and 23.',
  estateResiProperty: 'Residential property income received through the estate, and any unused residential finance costs brought forward.',
} as const;

// SA109 Residence, FIG regime & remittance basis.
export const RES = {
  // Residence status
  notResident: 'Tick if you were not resident in the UK for the whole of this tax year under the Statutory Residence Test (SRT).',
  splitYear: 'Tick if the year splits into a UK part and an overseas part because you arrived in, or left, the UK part-way through it.',
  splitYearMultiple: 'Tick if more than one of the split-year “cases” applies to your circumstances this year.',
  residentLastYear: 'Answer Yes if you were UK resident for the previous tax year — it affects which SRT tests apply.',
  splitYearDate: 'The date the UK part of the split year begins or ends (dd-mm-yyyy).',
  thirdAutoOverseasTest: 'Tick if you met the third automatic overseas test — you worked full-time overseas with few UK days and UK workdays.',
  gapBetweenEmployments: 'Tick if you had a gap between employments during the year — relevant to the full-time-work parts of the SRT.',
  homeOverseas: 'Tick if you had a home overseas at any point in the year — relevant to the automatic overseas / UK tests.',
  daysInUk: 'The total number of days you were in the UK at the end of the day (midnight) during the tax year.',
  daysExceptional: 'Of the days above, the ones you would not otherwise count because exceptional circumstances kept you in the UK (capped at 60 days).',
  daysTransit: 'Days you were in the UK at midnight only because you were passing through (in transit) between two places outside the UK.',
  ukTies: 'Your number of UK ties under the SRT — family, accommodation, work, the 90-day tie and (if relevant) the country tie.',
  workdaysUk: 'The number of days on which you did more than three hours of work in the UK.',
  workdaysOverseas: 'The number of days on which you did more than three hours of work overseas.',
  // Personal allowances & domicile
  paUnderDta: 'Tick if you are a non-resident claiming UK personal allowances under the terms of a double-taxation agreement (DTA).',
  paOtherBasis: 'Tick if you are claiming UK personal allowances on another basis — e.g. as an EEA national or another eligible category.',
  nationalResidentCountries: 'The countries you are a national of and/or resident in — used to check your entitlement to UK personal allowances.',
  residentCountryCodes: 'The countries, other than the UK, where you were resident for tax purposes during this tax year.',
  residentCountryCodesPrior: 'Of those countries, the ones you were also resident in for the previous tax year.',
  dtaIncomeReliefAmount: 'The amount of income on which you are claiming relief under a double-taxation agreement.',
  dtaReliefResidence: 'Relief claimed under a DTA because its tie-breaker treats you as resident in the other country.',
  dtaReliefOther: 'Relief claimed under other provisions of a double-taxation agreement.',
  figArrivalDate: 'The date you most recently arrived in the UK — sets the clock for the four-year Foreign Income & Gains (FIG) regime.',
  figPriorResidentYear: 'If you were UK resident in a tax year before your most recent arrival, enter that year.',
  // FIG regime & remittance basis
  figIncomeClaim: 'Claim relief on foreign income under the FIG regime (your first four years of UK residence). Claiming withdraws your personal allowance.',
  figGainsClaim: 'Claim relief on foreign gains under the FIG regime. Claiming withdraws your CGT annual exempt amount.',
  qahcDeemedForeign: 'Tick if you have UK income or gains treated as foreign under the qualifying asset holding company (QAHC) rules.',
  remittedNominated: 'Tick if you remitted (brought to the UK) any income or gains you had previously nominated under the remittance basis.',
  figCompanies: 'Business Investment Relief — the companies you invested remitted foreign income in. Enter each company and the amount invested.',
  investmentNoLongerQualifies: 'Tick if a Business Investment Relief investment stopped qualifying this year (a potentially chargeable event).',
  // OWR & TRF
  owrElection: 'Tick if you are making an election for Overseas Workday Relief (OWR).',
  owrClaim: 'Tick if you are making a claim for Overseas Workday Relief for this year.',
  owrTransitional: 'Tick if you qualify for the OWR transitional provisions for any year you are claiming.',
  owrQualifyingEmpIncome: 'Your qualifying employment income after deductions, for Overseas Workday Relief purposes.',
  owrQualifyingForeignEmpIncome: 'The part of your qualifying employment income that relates to overseas workdays.',
  owrMaxRelief: 'The maximum relief available under the financial limit — broadly the lower of £300,000 or 30% of qualifying income.',
  owrClaimedOnEmpIncome: 'The amount of OWR you are claiming against the qualifying employment income.',
  owrTotalRelief: 'The total OWR relief you are claiming for this tax year across all claims.',
  trfElection: 'Tick if you are making an election under the Temporary Repatriation Facility (TRF).',
  trfPersonalDesignations: 'The amount that relates to your personal TRF designations.',
  trfTrustPayments: 'The amount that relates to capital payments or benefits you received from trusts.',
  trfRemitted: 'The amount of TRF-designated funds you remitted to the UK in this tax year.',
} as const;

// SA101 Additional information.
export const ADD = {
  // Other UK income
  giltInterestNet: 'Interest from gilt-edged and other UK securities received after tax was taken off — itemise each holding (gross + tax) and SMITH totals the net.',
  giltTaxTaken: 'The total tax taken off the gilt / securities interest above.',
  giltGross: 'The gross amount of the gilt / securities interest before any tax was taken off.',
  chargeableEventGains: 'Gains on UK life-insurance policies / contracts where tax is treated as paid (a UK policy) — added to income with a 20% credit. Itemise each event with its gain and years held.',
  years: 'The number of complete years the policy has been held — used for top-slicing relief.',
  lifeGainNoTaxPaid: 'Gains on UK life-insurance policies where NO tax is treated as paid — added to income with no credit.',
  voidedIsaGain: 'Gains on a UK policy that came from a voided ISA.',
  voidedIsaTax: 'The tax taken off the voided-ISA gain (box 8).',
  deficiencyRelief: 'Deficiency relief on a life-insurance policy — reduces higher/additional-rate tax. Captured here; review before filing.',
  stockDividends: 'The appropriate amount in cash for stock dividends received from UK companies (taxed as dividend income).',
  bonusIssues: 'Bonus issues of securities and redeemable shares treated as income (non-qualifying distributions).',
  closeCompanyLoansWrittenOff: 'Loans from a close company to you that were written off or released — treated as a net dividend.',
  businessReceipts: 'Post-cessation or other business receipts taxed as income of an earlier year.',
  businessReceiptsYear: 'The earlier tax year the receipts are to be taxed as (YYYY-YY).',
  // Share schemes / lump sums
  shareSchemesTaxable: 'The taxable amount from share schemes not already taxed under PAYE — itemise each scheme / chargeable event.',
  taxableLumpSums: 'Taxable lump sums (not from a pension) — e.g. certain employment lump sums.',
  efrbsBenefits: 'Relevant benefits provided under an Employer-Financed Retirement Benefits Scheme (EFRBS).',
  redundancyReceipts: 'Total redundancy and other receipts — the taxable amount over the £30,000 exemption.',
  taxOffLumpSums: 'Tax taken off the amounts in boxes 3 to 5.',
  taxOnEmploymentPages: 'Tick if all of that tax has already been included on your Employment (SA102) pages, to avoid double-counting.',
  exemptForeignService: 'The part of a lump sum exempt because of foreign service.',
  lumpSumExemption30k: 'The £30,000 tax-free exemption applied to a redundancy / compensation lump sum.',
  disabilityPortion: 'The portion of the lump sum paid on account of injury or disability (tax-free).',
  seafarersDeduction: "Seafarers' Earnings Deduction — a deduction from earnings for qualifying periods working at sea.",
  foreignEarningsNotTaxable: 'Foreign earnings that are not taxable in the UK.',
  foreignTaxNoTcr: 'Foreign tax paid for which you are NOT claiming tax credit relief (taken as a deduction instead).',
  exemptOverseasPensionContrib: "Exempt employers' contributions to an overseas pension scheme.",
  patentRoyaltyPayments: 'UK patent royalty payments you made (net) — itemise each payment.',
  // Other tax reliefs
  vctSubscriptions: 'Amount subscribed for Venture Capital Trust shares — a 30% income-tax reducer.',
  eisSubscriptions: 'Amount subscribed for Enterprise Investment Scheme shares on which relief is claimed — a 30% reducer.',
  citrInvestment: 'Community Investment Tax Relief — 5% of the investment for up to five years.',
  annualPayments: 'Annual payments you made (net) on which relief is due. Captured here; review before filing.',
  qualifyingLoanInterest: 'Interest on a qualifying loan (e.g. to buy into a partnership or a close company) — deducted from income. Captured here; review before filing.',
  postCessationExpenses: 'Post-cessation expenses and certain other losses claimed against income.',
  preIncorporationLosses: 'Pre-incorporation trade losses relieved against income.',
  maintenancePayments: 'Maintenance or alimony payments under a court order where one party was born before 6 April 1935 — 10% relief, capped (max claim £4,360).',
  tradeUnionDeathBenefits: 'Payments to a trade union or police organisation for death / superannuation benefits — half qualifies for relief.',
  reliefRedemptionBonusShares: 'Relief claimed on the redemption of bonus shares or securities.',
  seisSubscriptions: 'Amount subscribed for Seed Enterprise Investment Scheme shares — a 50% income-tax reducer.',
  nonDeductiblePropertyPartnershipInterest: 'Loan interest from investing in a property-letting partnership that is not deductible against the property profits.',
  // Married Couple's Allowance
  mcaSpouseName: "Your spouse's or civil partner's name (for Married Couple's Allowance — only where one of you was born before 6 April 1935).",
  mcaSpouseDob: "Your spouse's or civil partner's date of birth.",
  mcaTransferHalf: "Tick to transfer HALF of the minimum Married Couple's Allowance to the lower-income spouse.",
  mcaTransferAll: "Tick to transfer ALL of the minimum Married Couple's Allowance to the lower-income spouse.",
  mcaPrevSpouseDob: 'Date of birth of a previous spouse or civil partner, if relevant to the allowance.',
  mcaReceiveHalf: 'Tick to receive HALF of the minimum allowance from your spouse.',
  mcaReceiveAll: 'Tick to receive ALL of the minimum allowance from your spouse.',
  mcaSpousePartnerFullName: "Your spouse's or civil partner's full name.",
  mcaMarriageDate: 'The date of your marriage or civil partnership (if during the tax year).',
  mcaHaveSurplus: "Tick to have your spouse's or civil partner's surplus allowance.",
  mcaGiveSurplus: 'Tick to give your surplus allowance to your spouse or civil partner.',
  // Income Tax losses & limit on relief
  earlierYearsLosses: "Earlier years' losses (other than trade losses) set against this year's income.",
  unusedLossesCarriedForward: 'Total unused losses carried forward to later years.',
  laterYearReliefClaimed: 'Relief now claimed for a trade loss made in a later year.',
  laterYearReliefNotLimited: 'The amount of that relief which is not subject to the limit on Income Tax reliefs.',
  laterYearLossTaxYear: 'The tax year for which you are claiming the later-year loss relief (YYYY-YY).',
  payrollGiving: 'Donations made to charity through the Payroll Giving scheme (already given before tax) — itemise each.',
  // Pension savings tax charges
  annualAllowanceExcess: 'The amount of your pension savings above the Annual Allowance, on which a charge is due. Captured here; review before filing.',
  annualAllowanceTaxPaid: 'Annual Allowance charge already paid by your pension scheme (scheme pays).',
  pensionOverseasTransfer: 'The value of pension benefits transferred to a qualifying overseas pension scheme (an overseas transfer charge may apply).',
  overseasTransferChargeTax: 'Tax already paid on your overseas transfer charge.',
  pensionSchemeRef: "The pension scheme's tax reference.",
  unauthNotSurcharge: 'Unauthorised payment from a pension scheme that is NOT subject to the surcharge.',
  unauthSurcharge: 'Unauthorised payment from a pension scheme that IS subject to the surcharge.',
  unauthForeignTax: 'Foreign tax paid on the unauthorised pension payment.',
  foreignLumpShortServiceRefund: 'A short-service refund lump sum from a foreign pension scheme.',
  foreignLumpTaxable: 'The taxable amount of a foreign pension lump sum.',
  foreignLumpForeignTax: 'Foreign tax paid on the foreign pension lump sum.',
  // Tax avoidance schemes
  avoidanceSchemeRefs: 'The 8-digit Scheme Reference Number (SRN) HMRC gave the disclosed tax-avoidance scheme — one per box.',
  avoidanceTaxYears: 'For each scheme above, the tax year in which you expect the tax advantage to arise (YYYY-YY).',
} as const;

// SA102M Ministry of religion.
export const MIN = {
  natureOfPost: 'The nature of your post or appointment as a minister of religion (e.g. vicar, rabbi, imam, pastor).',
  salary: 'Your salary or stipend before tax, from your P60 / P45.',
  payrolledBenefitsStudentLoan: 'The part of box 2 that is payrolled benefits which count towards your student loan repayments.',
  taxOffSalary: 'PAYE tax taken off your salary or stipend.',
  feesOfferings: 'Fees and offerings you received (e.g. for weddings and funerals).',
  vicarageExpensesPaid: 'Expenses of your vicarage / manse that were paid for you.',
  personalExpenses: 'Personal expenses met for you — living accommodation, vouchers, etc.',
  excessMileage: 'Excess mileage allowance and passenger payments above the approved rates.',
  roundSumExpenses: 'Round-sum expense allowances and rent allowances received.',
  taxOffRoundSum: 'Tax taken off the round-sum expenses in box 8.',
  otherIncome: 'Other income as a minister — gifts, grants and balancing charges.',
  taxOffOtherIncome: 'Tax taken off the other income in box 10.',
  vicarageServicesBenefit: 'The value of vicarage or manse services benefits provided to you (heating, lighting, cleaning, gardening).',
  carBenefit: 'The taxable benefit of a car made available to you.',
  carFuelBenefit: 'The taxable benefit of fuel provided for a company car.',
  loansBenefit: 'The taxable benefit of interest-free or low-interest loans.',
  expensesReceived: 'Expenses payments received from the church/employer.',
  otherBenefits: 'Any other taxable benefits received.',
  travellingExpenses: 'Travelling and subsistence expenses you paid in performing your duties.',
  manseMaintenance: 'Maintenance, repairs and insurance of the manse / vicarage that you paid.',
  rent: 'Rent you paid.',
  secretarialAssistance: 'Cost of secretarial assistance you paid.',
  otherExpenses: 'Other allowable expenses you paid.',
  backPayAfterApril: 'Back pay you received after 5 April that relates to this year.',
  earlierYearBackPay: 'Back pay received this year that relates to an earlier year.',
  pensionPayments: 'Payments you made to registered pension schemes (used in the net-income calculation).',
  amountPaidTowardBenefit: 'Any amount you paid towards the service benefit received (reduces the taxable benefit).',
  chaplaincyIncome: 'Chaplaincy and other income you received as a minister, not already entered above.',
  taxOffChaplaincy: 'Tax taken off the chaplaincy income in box 36.',
  totalTaxTakenOff: 'Total tax taken off across your minister-of-religion income — computed from the tax boxes, but you can override it.',
} as const;

// SA102 Northern Ireland Legislative Assembly (also used for the other devolved
// legislature office schedules) — one hint per box.
export const NIA = {
  p60Pay: 'Total payments from your P60 (or P45) for your Assembly office.',
  payrolledBenefitsStudentLoan: 'The part of box 1 that is payrolled benefits which count towards your student loan repayments.',
  taxTakenOff: 'Tax taken off the pay in box 1 (from your P60 / P45).',
  officeCostExpenditure: 'Office Cost Expenditure allowance paid to you for running your office.',
  otherCashReimbursements: 'Other cash reimbursements you received in connection with your office.',
  allOtherBenefits: 'The cash-equivalent of all other benefits received (e.g. those on a P11D).',
  balancingCharges: 'Balancing charges arising when you dispose of an asset on which capital allowances were claimed.',
  secretarialAssistance: 'Amounts you paid personally for secretarial, clerical and research assistance.',
  officeExpenses: 'Office running expenses you paid personally.',
  otherExpensesCapitalAllowances: 'Other allowable expenses and any capital allowances you are claiming.',
  otherInformation: 'Any other information relevant to your Assembly office income, benefits or expenses.',
} as const;
