// Prompt for extracting SA100 figures from a taxpayer's uploaded documents.

export function buildSa100ExtractPrompt(taxYear: string): string {
  return `You are an expert UK personal-tax accountant preparing a Self Assessment (SA100) return for the ${taxYear} tax year (6 April to 5 April).

You have been given one or more of the taxpayer's documents (attached above). Identify each document and extract the figures relevant to their SA100 for ${taxYear}.

Common documents and what to take:
- P60 / P45 (employment): employer name, gross pay for the year, and PAYE tax deducted.
- P11D (benefits in kind): the total cash-equivalent of benefits for that employment.
- Dividend vouchers / statements: the dividend amount(s). SUM all dividends across every voucher into one total.
- Interest certificates / bank interest statements: taxable interest received. SUM across all accounts.
- Pension statements: taxable pension income received; and, SEPARATELY, any personal pension CONTRIBUTIONS the taxpayer paid (relief at source, net amount).
- Gift Aid receipts: net donations paid.
- Property / letting statements: net rental profit per property.
- Self-employment accounts: net trade profit per trade.
- Child Benefit award notice: the total child benefit received in the year (for the HICBC).
- SA302 / HMRC tax calculation: use only as a cross-check — do NOT double count figures already taken from source documents.

Rules:
- Only include figures for the ${taxYear} tax year. If a document clearly relates to a different year, exclude it and say so in "notes".
- Combine a P60 and a P11D for the SAME employer into ONE employment entry (pay from the P60, benefits from the P11D).
- All amounts must be plain GBP numbers — no currency symbols, no commas, no words.
- If a figure is unclear, or a document is not tax-relevant, set it to 0 (or omit that entry) and add a short line to "notes" explaining what to check.
- Never invent figures. Only report what the documents show.

Return ONLY valid JSON (no prose, no code fences) matching EXACTLY this shape:

{
  "documents": [{ "fileName": string, "docType": string, "summary": string }],
  "employment": [{ "employer": string, "pay": number, "taxDeducted": number, "benefits": number }],
  "selfEmployment": [{ "name": string, "profit": number }],
  "property": [{ "address": string, "profit": number }],
  "dividends": number,
  "savingsInterest": number,
  "pensionsIncome": number,
  "otherIncome": number,
  "giftAid": number,
  "pensionContributions": number,
  "childBenefit": number,
  "notes": [string]
}`;
}
