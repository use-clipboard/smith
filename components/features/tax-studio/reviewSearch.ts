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
