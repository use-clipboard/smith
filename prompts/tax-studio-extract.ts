// Prompt for extracting SA100 figures from a taxpayer's uploaded documents.

export function buildSa100ExtractPrompt(taxYear: string): string {
  return `You are an expert UK personal-tax accountant preparing a Self Assessment (SA100) return for the ${taxYear} tax year (6 April to 5 April).

You have been given one or more of the taxpayer's documents (attached above). Identify each document and extract the figures relevant to their SA100 for ${taxYear}.

Capture EVERY figure a document gives you into the right field below — not just a headline total. If a set of accounts shows turnover, expenses and capital allowances, report all three; if a letting statement itemises expenses, split them into the expense fields. Only leave a field 0 when the document genuinely doesn't provide it.

Common documents and what to take:
- P60 / P45 (employment): employer name, gross pay for the year, and PAYE tax deducted.
- P11D (benefits in kind): the total cash-equivalent of benefits for that employment (→ "benefits").
- Employment expense claims (P87, professional subscriptions, mileage): allowable employment expenses per employment (→ "expenses").
- Self-employment accounts (per trade): "turnover" (total sales/receipts), total allowable "expenses", "netProfit" (accounts net profit), "capitalAllowances" (AIA/WDA claimed), and any "cis" (CIS tax deducted by contractors). If the accounts give turnover AND expenses, report both and the net profit; if you only have the net figure, put it in "netProfit" and leave turnover/expenses 0.
- Partnership statement (SA104): this partner's SHARE of the taxable "profit", plus any "taxTaken" (tax deducted from partnership income) and "cis" (CIS deductions) shown for this partner.
- Property / letting statements (per property): total "rents" received, then the allowable expenses split into "expPremises" (rent, rates, insurance, ground rents), "expRepairs" (repairs & maintenance), "expFinance" (mortgage/loan interest & other finance costs), "expProfessional" (letting-agent, legal & management fees) and "expOther" (everything else). Set "residential" true for a residential let (default) or false for commercial. If only a net figure is given, put it in "netProfit" and leave rents/expenses 0.
- Foreign income (SA106): list EACH foreign source SEPARATELY in "foreignItems" — one entry per source with the "country" (full country name), a "category" of exactly one of "interest" | "dividends" | "pension" | "property" | "other", the "income" (in GBP) and any "foreignTax" paid (in GBP).
- Dividend vouchers / statements: list EACH UK dividend SEPARATELY in "dividendList" (company, optional description, amount); also put the grand total in "dividends". Foreign company dividends go in "foreignItems" (category "dividends"), except small foreign dividends the client wants on the main return → "foreignDividends" (+ "foreignDividendsTax").
- Interest certificates / bank interest statements: UNTAXED interest → "savingsInterest" (SUM across accounts). Interest received NET of tax (with tax deducted) → list in "taxedInterestList" (description, "net" received, "tax" deducted).
- Private pension statements: taxable pension income received (→ "pensionsIncome"); and, SEPARATELY, any personal pension CONTRIBUTIONS the taxpayer paid (relief at source, net amount → "pensionContributions").
- State pension letter (DWP): the total STATE pension received in the year (→ "statePension", separate from private pensions).
- Gift Aid receipts: net donations paid (→ "giftAid").
- Trust / estate income (R185 statements — "Statement of income from trust" or "…from estate"): list EACH source SEPARATELY in "trustEstate" — one entry per statement with the "source" (trust/estate name), a "category" of exactly one of "discretionaryTrust" (a discretionary payment received net of 45% tax), "nonDiscTrust" (a non-discretionary income entitlement from a trust) or "ukEstate" (income from a deceased person's estate), and the net income split by type into "nonSavings", "savings" and "dividend". For a discretionary payment put the single net amount in "nonSavings".
- Child Benefit award notice: the total child benefit received in the year (→ "childBenefit", for the HICBC).
- SA302 / HMRC tax calculation: use only as a cross-check — do NOT double count figures already taken from source documents.

Rules:
- Only include figures for the ${taxYear} tax year. If a document clearly relates to a different year, exclude it and add it to "setAside" with the reason.
- Combine a P60 and a P11D for the SAME employer into ONE employment entry (pay from the P60, benefits from the P11D).
- For self-employment and property, don't double count: give the itemised figures (turnover/expenses, or rents/expenses) OR the single net figure — not both for the same amount.
- All amounts must be plain GBP numbers — no currency symbols, no commas, no words.
- Never invent figures. Only report what the documents show.

Also produce two review lists:
- "setAside": anything you found but did NOT put into a figure above — a document that isn't tax-relevant, is for the wrong year, is a duplicate, or a figure you couldn't confidently categorise or read. Give each a short human "label" and a plain-English "reason" a non-expert taxpayer would understand (e.g. "This looks like a 2023/24 P60, which is outside this return's year" or "I found £4,200 but couldn't tell if it's rent received or a returned deposit").
- "needs": specific things you would need from the taxpayer to make the entries accurate — a MISSING document, or missing CONTEXT. Be concrete. Examples: "To finish the capital gain I need the original purchase completion statement." / "Is the rental property let jointly with anyone else?" / "Is 12 High St residential or commercial?" / "Were any of these dividends from a foreign company?"

Return ONLY valid JSON (no prose, no code fences) matching EXACTLY this shape:

{
  "documents": [{ "fileName": string, "docType": string, "summary": string }],
  "employment": [{ "employer": string, "pay": number, "taxDeducted": number, "benefits": number, "expenses": number }],
  "selfEmployment": [{ "name": string, "turnover": number, "expenses": number, "netProfit": number, "capitalAllowances": number, "cis": number }],
  "partnerships": [{ "name": string, "profit": number, "taxTaken": number, "cis": number }],
  "property": [{ "address": string, "rents": number, "expPremises": number, "expRepairs": number, "expFinance": number, "expProfessional": number, "expOther": number, "netProfit": number, "residential": boolean }],
  "dividends": number,
  "dividendList": [{ "company": string, "description": string, "amount": number }],
  "savingsInterest": number,
  "taxedInterestList": [{ "description": string, "net": number, "tax": number }],
  "pensionsIncome": number,
  "statePension": number,
  "foreignItems": [{ "country": string, "category": "interest" | "dividends" | "pension" | "property" | "other", "income": number, "foreignTax": number }],
  "foreignDividends": number,
  "foreignDividendsTax": number,
  "trustEstate": [{ "source": string, "category": "discretionaryTrust" | "nonDiscTrust" | "ukEstate", "nonSavings": number, "savings": number, "dividend": number }],
  "otherIncome": number,
  "giftAid": number,
  "pensionContributions": number,
  "childBenefit": number,
  "notes": [string],
  "setAside": [{ "label": string, "reason": string }],
  "needs": [string]
}`;
}
