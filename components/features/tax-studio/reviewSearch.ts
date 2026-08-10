// Search index for the Review & Adjust "jump to" box — lets you find a section,
// field or box code and be taken straight to it. `page` is the SA-page tab id;
// `section` (when present) is the core-page accordion title to open & scroll to.

export interface SearchEntry {
  label: string;      // what shows as the result title
  context: string;    // secondary line (where it lives)
  page: string;       // PageId — the SA-page tab to switch to
  section?: string;   // core accordion title to reveal (Income & reliefs only)
  keywords: string;   // extra terms (synonyms, box codes) to match on
}

// Core-page ("Income & reliefs") accordions.
const CORE_SECTIONS: { title: string; kw: string }[] = [
  { title: 'Interest & dividends', kw: 'interest dividends savings bank building society taxed untaxed foreign box 1 2 3 4 5 6 7' },
  { title: 'UK pensions & benefits', kw: 'state pension pensions annuity incapacity esa jobseekers jsa benefits lump sum box 8 9 10 11 12 13 14 15 16' },
  { title: 'Other UK income', kw: 'other taxable income pre-owned assets miscellaneous casual box 17 18 19 20 21' },
  { title: 'Pension payments', kw: 'pension contributions relief at source retirement annuity employer overseas one-off tr4' },
  { title: 'Charitable giving', kw: 'gift aid charity donations one-off carry back future shares securities land buildings box 5 6 7 8 9 10' },
  { title: 'Blind allowance & student loan', kw: 'blind person allowance student loan postgraduate plan 1 2 4 5 tax region scotland' },
  { title: 'Child benefit', kw: 'child benefit hicbc high income charge winter fuel payment wfp pawhp children' },
  { title: 'Marriage allowance', kw: 'marriage allowance spouse civil partner transfer in out 252' },
  { title: 'Tax refunded or set off', kw: 'tax refunded set off hmrc jobcentre paye code collect' },
  { title: 'Paid too much tax — repayment details', kw: 'repayment refund bank building society account sort code nominee' },
  { title: 'Your tax adviser', kw: 'tax adviser accountant agent reference phone address' },
  { title: 'Signing your form', kw: 'signing signature provisional figures capacity supplementary pages' },
];

// SA-page tabs.
const PAGE_ENTRIES: { label: string; code: string; page: string; kw: string }[] = [
  { label: 'Income & reliefs', code: 'SA100', page: 'core', kw: 'core main return reliefs' },
  { label: 'Employment', code: 'SA102', page: 'employment', kw: 'employment employer pay p60 p11d benefits director' },
  { label: 'Self-employment', code: 'SA103', page: 'selfemp', kw: 'self employment sole trader trade business turnover expenses' },
  { label: 'Partnership', code: 'SA104', page: 'partnership', kw: 'partnership partner share' },
  { label: 'Property', code: 'SA105', page: 'property', kw: 'property rental landlord rent' },
  { label: 'Foreign', code: 'SA106', page: 'foreign', kw: 'foreign overseas income ftcr' },
  { label: 'Capital gains', code: 'SA108', page: 'cgt', kw: 'capital gains cgt disposals shares property' },
  { label: 'Trusts', code: 'SA107', page: 'trusts', kw: 'trust estate settlement beneficiary' },
  { label: 'Residence', code: 'SA109', page: 'residence', kw: 'residence domicile remittance fig split year non-resident' },
  { label: 'Additional info', code: 'SA101', page: 'additional', kw: 'additional information eis seis vct life insurance gains' },
];

// Notable fields — so a field name or box code jumps to the right place.
const FIELD_ENTRIES: SearchEntry[] = [
  // Self-employment (SA103)
  { label: 'Turnover', context: 'Self-employment · box 15 / 9', page: 'selfemp', keywords: 'turnover sales fees takings box 15 9' },
  { label: 'Allowable expenses', context: 'Self-employment · boxes 17–30', page: 'selfemp', keywords: 'expenses costs materials wages rent motor' },
  { label: 'Disallowable expenses', context: 'Self-employment · boxes 32–46', page: 'selfemp', keywords: 'disallowable add back depreciation entertaining box 32 46' },
  { label: 'Capital allowances', context: 'Self-employment · boxes 49–57', page: 'selfemp', keywords: 'capital allowances aia wda pool writing down box 23 24 49 57' },
  { label: 'Annual Investment Allowance (AIA)', context: 'Self-employment · box 49 / 23', page: 'selfemp', keywords: 'aia annual investment allowance 100% box 49 23' },
  { label: 'Balancing charge', context: 'Self-employment · box 59 / 26', page: 'selfemp', keywords: 'balancing charge disposal box 59 26' },
  { label: 'Loss carried forward', context: 'Self-employment · box 80 / 35', page: 'selfemp', keywords: 'loss carried forward brought back sideways box 74 78 79 80' },
  { label: 'Class 2 / Class 4 NIC', context: 'Self-employment · boxes 100–102 / 36–37', page: 'selfemp', keywords: 'class 2 class 4 nic national insurance voluntary exempt' },
  { label: 'CIS deductions', context: 'Self-employment · box 81 / 38', page: 'selfemp', keywords: 'cis construction industry scheme subcontractor deductions box 81 38' },
  { label: 'Balance sheet', context: 'Self-employment · boxes 83–99', page: 'selfemp', keywords: 'balance sheet assets liabilities capital account debtors creditors' },
  // Employment (SA102)
  { label: 'Pay from employment', context: 'Employment · box 6', page: 'employment', keywords: 'pay salary p60 gross box 6' },
  { label: 'Benefits (P11D)', context: 'Employment · boxes 9–16', page: 'employment', keywords: 'benefits p11d company car fuel medical box 9 16' },
  // Partnership (SA104)
  { label: 'Partnership reference number (UTR)', context: 'Partnership · box 1', page: 'partnership', keywords: 'partnership reference number utr box 1' },
  { label: 'Share of profit', context: 'Partnership · box 8', page: 'partnership', keywords: 'share of profit loss partnership box 8' },
  { label: 'Adjusted / taxable profit', context: 'Partnership · boxes 16–20', page: 'partnership', keywords: 'adjusted profit taxable profit total taxable profits transition box 16 18 20' },
  { label: 'Partnership loss allocation', context: 'Partnership · boxes 21–24', page: 'partnership', keywords: 'loss against other income carried back carry forward box 21 22 23 24' },
  { label: 'Partnership Class 2 / Class 4 NIC', context: 'Partnership · boxes 25–27', page: 'partnership', keywords: 'class 2 class 4 nic national insurance voluntary exempt box 25 26 27' },
  { label: 'Partnership untaxed savings income', context: 'Partnership · boxes 28–35', page: 'partnership', keywords: 'untaxed savings interest uk foreign box 28 30 34 35' },
  { label: 'Partnership UK property income', context: 'Partnership · boxes 36–41', page: 'partnership', keywords: 'uk property rental finance costs box 36 41' },
  { label: 'Partnership other untaxed UK income', context: 'Partnership · boxes 45–51', page: 'partnership', keywords: 'other untaxed uk income box 45 48 51' },
  { label: 'Partnership offshore funds', context: 'Partnership · boxes 52–55', page: 'partnership', keywords: 'offshore funds income box 52 55' },
  { label: 'Partnership foreign income', context: 'Partnership · boxes 56–63', page: 'partnership', keywords: 'other untaxed foreign income box 56 60 63' },
  { label: 'Partnership taxed income', context: 'Partnership · boxes 68–76', page: 'partnership', keywords: 'taxed income 10% 20% other taxed box 68 70 71 73 74 76' },
  { label: 'Partnership tax paid & CIS deductions', context: 'Partnership · boxes 77–80', page: 'partnership', keywords: 'tax taken off cis deductions trading income box 77 78 79 80' },
  // Property (SA105)
  { label: 'Number of properties / let jointly', context: 'Property · boxes 1–4', page: 'property', keywords: 'number of properties let jointly rent a room ceased box 1 2 3 4' },
  { label: 'Property income', context: 'Property · boxes 20–23', page: 'property', keywords: 'total rents property income allowance premiums reverse premiums box 20 21 22 23' },
  { label: 'Property expenses', context: 'Property · boxes 24–29', page: 'property', keywords: 'rent rates insurance repairs loan interest legal management services other box 24 25 26 27 28 29' },
  { label: 'Property allowances & taxable profit', context: 'Property · boxes 30–43', page: 'property', keywords: 'private use balancing aia sba capital allowances domestic items adjusted taxable profit loss box 30 38 40 41 43' },
  { label: 'Residential property finance costs', context: 'Property · boxes 44–45', page: 'property', keywords: 'residential finance costs mortgage interest 20% reducer box 44 45' },
  // Foreign (SA106)
  { label: 'Unremittable income / FTCR on income', context: 'Foreign · boxes 1–2', page: 'foreign', keywords: 'unremittable foreign tax credit relief ftcr box 1 2' },
  { label: 'Foreign interest & other income', context: 'Foreign · Overseas income', page: 'foreign', keywords: 'foreign interest savings overseas income arising box 3 4 country' },
  { label: 'Foreign dividends', context: 'Foreign · Overseas income', page: 'foreign', keywords: 'foreign dividends companies remitted box 6 7' },
  { label: 'Foreign pensions', context: 'Foreign · Overseas income', page: 'foreign', keywords: 'overseas pensions social security royalties box 8 9' },
  { label: 'Foreign land & property', context: 'Foreign · boxes 14–32', page: 'foreign', keywords: 'foreign property rents overseas letting abroad box 14 18 24 27 32' },
  { label: 'Foreign tax paid / capital gains', context: 'Foreign · boxes 33–46', page: 'foreign', keywords: 'foreign tax paid capital gains life insurance ftcr box 33 39 43 46' },
  { label: 'Non-resident trusts / Transfer of Assets', context: 'Foreign · boxes 49–64', page: 'foreign', keywords: 'non-resident trusts transfer of assets abroad settlements fig box 49 54 58 62 64' },
  // Capital gains (SA108)
  { label: 'Residential property gains', context: 'Capital gains · Property and Assets · boxes 3–13C', page: 'cgt', keywords: 'residential property gains disposals proceeds allowable costs losses carried interest ppt box 3 4 5 6 7 8 9 10 11 12 13' },
  { label: 'Cryptoassets gains', context: 'Capital gains · Property and Assets · boxes 13.1–13.8', page: 'cgt', keywords: 'crypto cryptoassets bitcoin ethereum token gains disposals real time transaction box 13.1 13.4 13.5 13.7' },
  { label: 'Other property, assets and gains', context: 'Capital gains · Property and Assets · boxes 14–22', page: 'cgt', keywords: 'other property assets gains chattels goodwill land badr box 14 15 16 17 19 21 22' },
  { label: 'Listed shares and securities', context: 'Capital gains · Shares and Securities · boxes 23–30', page: 'cgt', keywords: 'listed shares securities quoted gains disposals proceeds box 23 24 25 26 27 29' },
  { label: 'Unlisted shares and securities', context: 'Capital gains · Shares and Securities · boxes 31–44', page: 'cgt', keywords: 'unlisted shares securities eis seis ess share loss relief box 31 34 39 40 41 42 43 44' },
  { label: 'Capital losses & adjustments', context: 'Capital gains · Losses and adjustments · boxes 45–52', page: 'cgt', keywords: 'losses brought forward carried forward entrepreneurs relief business asset disposal badr adjustments box 45 46 47 48 49 50 51 52' },
  { label: 'Business Asset Disposal Relief (BADR)', context: 'Capital gains · Losses and adjustments · box 50', page: 'cgt', keywords: 'badr business asset disposal relief entrepreneurs 14% lifetime limit box 50 50.1' },
  { label: 'Non-resident Capital Gains Tax (NRCGT)', context: 'Capital gains · Non-resident CGT · boxes 52.1–52QL', page: 'cgt', keywords: 'nrcgt non resident capital gains uk property indirect eis qahc box 52.1 52.2 52.3 52EG 52QG' },
  { label: 'CGT estimates or valuations', context: 'Capital gains · Any other information · boxes 53–54', page: 'cgt', keywords: 'estimates valuations any other information note box 53 54' },
  // Trusts & estates (SA107)
  { label: 'Discretionary trust income', context: 'Trusts · Income from Trusts · boxes 1–2', page: 'trusts', keywords: 'discretionary trust payment net amount settlor-interested box 1 2' },
  { label: 'Non-discretionary trust income', context: 'Trusts · Income from Trusts · boxes 3–6', page: 'trusts', keywords: 'non-discretionary trust entitlement non-savings savings dividend trustees non-resident box 3 4 5 6' },
  { label: 'Income chargeable on settlors', context: 'Trusts · Income from Trusts · boxes 7–15', page: 'trusts', keywords: 'settlor chargeable basic rate trust rate gross life assurance box 7 8 9 10 11 12 13 14 15' },
  { label: 'Income from UK estates', context: 'Trusts · Income from the estates · boxes 16–19', page: 'trusts', keywords: 'estate deceased r185 non-savings savings dividend after tax non-repayable box 16 17 18 19' },
  { label: 'Income from foreign estates', context: 'Trusts · Income from the estates · boxes 22–24', page: 'trusts', keywords: 'foreign estate income foreign tax uk tax withheld ftcr fig box 22 23 24' },
  // Residence (SA109)
  { label: 'Residence status', context: 'Residence · Residence status · boxes 1–14', page: 'residence', keywords: 'residence status not resident non-resident split year srt statutory residence test automatic overseas test home overseas ties box 1 3 4 7 9 12' },
  { label: 'Days spent in the UK', context: 'Residence · Residence status · boxes 10–14', page: 'residence', keywords: 'days spent uk exceptional circumstances transit midnight workdays ties count days box 10 11 12 13 14' },
  { label: 'Split-year treatment', context: 'Residence · Residence status · boxes 3–6', page: 'residence', keywords: 'split year treatment case date arrival departure box 3 3.1 6' },
  { label: 'Personal allowances (non-resident / DTA)', context: 'Residence · Personal allowances and domicile · boxes 15–22', page: 'residence', keywords: 'personal allowances non-resident dual resident dta double taxation agreement treaty relief country codes box 15 16 17 18 19 20 21 22' },
  { label: 'Foreign income and gains (FIG) regime', context: 'Residence · FIG regime & remittance basis · boxes 23–30', page: 'residence', keywords: 'fig foreign income gains regime claim relief arrival qahc qualifying asset holding company box 23 24 28 29 30' },
  { label: 'Remittance basis', context: 'Residence · FIG regime & remittance basis · boxes 37–39', page: 'residence', keywords: 'remittance basis nominated income business investment relief companies box 37 38 39' },
  { label: 'Overseas Workday Relief (OWR)', context: 'Residence · OWR & TRF · boxes 40–49', page: 'residence', keywords: 'overseas workday relief owr election claim transitional qualifying employment income financial limit box 40 41 43 44 46 47 48 49' },
  { label: 'Temporary repatriation facility (TRF)', context: 'Residence · OWR & TRF · boxes 50–53', page: 'residence', keywords: 'temporary repatriation facility trf election designations remitted box 50 51 52 53' },
  { label: 'Residence — any other information', context: 'Residence · Any other information · box 54', page: 'residence', keywords: 'residence any other information note box 54' },
  // Additional information (SA101)
  { label: 'Gilt / securities interest', context: 'Additional info · Other UK Income · boxes 1–3', page: 'additional', keywords: 'gilt gilts gilt-edged securities deeply discounted accrued income interest box 1 2 3' },
  { label: 'Life insurance gains', context: 'Additional info · Life insurance gains · boxes 4–11', page: 'additional', keywords: 'life insurance assurance chargeable event gains bond voided isa deficiency relief top-slicing box 4 5 6 7 8 9 10 11' },
  { label: 'Stock dividends & bonus issues', context: 'Additional info · Stock dividends & Bonus issues · boxes 12–13.1', page: 'additional', keywords: 'stock dividends bonus issues securities redeemable shares close company loans written off box 12 13' },
  { label: 'Business receipts taxed as income', context: 'Additional info · Business receipts · boxes 14–15', page: 'additional', keywords: 'post-cessation business receipts earlier year box 14 15' },
  { label: 'Share schemes & lump sums', context: 'Additional info · Share schemes · boxes 1–15', page: 'additional', keywords: 'share schemes taxable amount lump sums efrbs redundancy seafarers foreign earnings patent royalties box 1 3 5 11 15' },
  { label: 'Other tax reliefs (EIS / SEIS / VCT / CITR)', context: 'Additional info · Other tax reliefs · boxes 1–12', page: 'additional', keywords: 'venture capital trust vct eis seis enterprise investment scheme citr community annual payments qualifying loan interest maintenance post-cessation bonus shares box 1 2 3 4 5 6 7 8 9 10 12' },
  { label: "Married Couple's Allowance", context: 'Additional info · MCA · boxes 1–11', page: 'additional', keywords: 'married couple allowance mca spouse civil partner surplus transfer half all 1935 box 1 3 4 6 7 10 11' },
  { label: 'Income Tax losses & limit on relief', context: 'Additional info · Other information · boxes 1–6', page: 'additional', keywords: 'income tax losses earlier years carried forward trade loss later year limit payroll giving box 1 2 3 4 5 6' },
  { label: 'Pension savings tax charges', context: 'Additional info · Pension savings tax charges · boxes 10–18', page: 'additional', keywords: 'pension savings annual allowance charge scheme pays overseas transfer unauthorised payment surcharge foreign lump sum short service refund box 10 11 12 13 14 15 16 17 18' },
  { label: 'Tax avoidance schemes', context: 'Additional info · Tax avoidance schemes · boxes 19–20', page: 'additional', keywords: 'tax avoidance scheme reference number dotas expected advantage box 19 20' },
  // Core page fields
  { label: 'Taxed / untaxed UK interest', context: 'Income & reliefs · Interest & dividends', page: 'core', section: 'Interest & dividends', keywords: 'interest savings bank taxed untaxed box 1 2' },
  { label: 'Dividends', context: 'Income & reliefs · Interest & dividends · box 4', page: 'core', section: 'Interest & dividends', keywords: 'dividends shares box 4' },
  { label: 'State Pension', context: 'Income & reliefs · UK pensions & benefits · box 8', page: 'core', section: 'UK pensions & benefits', keywords: 'state pension box 8' },
  { label: 'Gift Aid', context: 'Income & reliefs · Charitable giving · box 5', page: 'core', section: 'Charitable giving', keywords: 'gift aid charity donation box 5' },
  { label: 'Pension contributions', context: 'Income & reliefs · Pension payments', page: 'core', section: 'Pension payments', keywords: 'pension contributions relief personal payments' },
  { label: 'Marriage Allowance', context: 'Income & reliefs · Marriage allowance', page: 'core', section: 'Marriage allowance', keywords: 'marriage allowance spouse transfer 252' },
  { label: 'Blind Person’s Allowance', context: 'Income & reliefs · Blind allowance & student loan', page: 'core', section: 'Blind allowance & student loan', keywords: 'blind person allowance registered' },
  { label: 'Student loan', context: 'Income & reliefs · Blind allowance & student loan', page: 'core', section: 'Blind allowance & student loan', keywords: 'student loan plan postgraduate repayment' },
  { label: 'Child Benefit charge (HICBC)', context: 'Income & reliefs · Child benefit', page: 'core', section: 'Child benefit', keywords: 'child benefit hicbc high income charge winter fuel' },
];

/** The full searchable index. */
export const SEARCH_INDEX: SearchEntry[] = [
  ...PAGE_ENTRIES.map(p => ({ label: p.label, context: `Section · ${p.code}`, page: p.page, keywords: `${p.kw} ${p.code}` })),
  ...CORE_SECTIONS.map(s => ({ label: s.title, context: 'Income & reliefs section', page: 'core', section: s.title, keywords: s.kw })),
  ...FIELD_ENTRIES,
];

/** Rank the index against a query (matches label + context + keywords). */
export function searchReview(query: string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const scored = SEARCH_INDEX.map(e => {
    const hay = `${e.label} ${e.context} ${e.keywords}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!hay.includes(t)) return { e, score: -1 };
      if (e.label.toLowerCase().startsWith(t)) score += 3;
      else if (e.label.toLowerCase().includes(t)) score += 2;
      else score += 1;
    }
    return { e, score };
  });
  return scored.filter(s => s.score >= 0).sort((a, b) => b.score - a.score).slice(0, 8).map(s => s.e);
}
