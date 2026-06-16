interface FinalAccountsPromptOptions {
  businessName: string;
  clientCode: string;
  businessType: string;
  isVatRegistered: boolean;
  periodStart: string;
  periodEnd: string;
  relevantContext: string;
}

// Step 1 — the review. Returns ONLY the review points, so the response stays
// small and never truncates. The working papers (A1 narrative + extracted
// schedules) are produced separately by buildWorkingPapersPrompt below, on a
// second request, to keep each AI response well within the output limit.
export function buildFinalAccountsPrompt(opts: FinalAccountsPromptOptions): string {
  return `You are an expert UK chartered accountant performing a final accounts review based on UK GAAP (FRS 102/105).
**Client Context:**
- Business Name: ${opts.businessName || 'Not Provided'}
- Client Code: ${opts.clientCode || 'Not Provided'}
- Business Type: ${opts.businessType}
- VAT Registered: ${opts.isVatRegistered ? 'Yes' : 'No'}
- Accounting Period: ${opts.periodStart} to ${opts.periodEnd}
- Additional Context: ${opts.relevantContext || 'None provided'}

**Task:**
Review the attached financial documents. Your goal is to identify potential errors, omissions, and areas for further investigation and categorize their severity.

For each point you identify, provide:
1. **area**: The area of the accounts affected (e.g., 'Balance Sheet', 'P&L', 'Compliance').
2. **subArea**: The specific account or sub-area (e.g., 'Director Loan Account', 'Petty Cash', 'Revenue', 'Trade Creditors'). Empty string if not applicable.
3. **issue**: A short title for the issue (e.g., 'Overdrawn Director's Loan Account').
4. **tag**: A very short summary phrase (3-5 words) capturing the headline concern (e.g., 'Potential s455 exposure', 'Fundamental accounting error', 'Requires explanation and support', 'Within acceptable tolerance').
5. **metric**: A single structured headline figure that best quantifies the point:
    - **value**: the figure as a display string (e.g., '£69,914', '(£39,747)', '+48%', '+23 days'). Empty string if no single figure applies.
    - **label**: a short label for the figure (e.g., 'Balance', 'vs prior year', 'Variance').
    - **delta**: the movement vs prior year if known (e.g., '+£6,295'), else empty string.
6. **explanation**: A clear description of WHAT the issue is (2-4 sentences).
7. **risk**: The implication — WHY it matters (tax, compliance or financial risk), 1-3 sentences. Empty string if there is no material risk.
8. **severity**: Classify as 'Serious', 'Medium' or 'Minor'.
    - **'Serious'**: Likely material, a compliance breach, significant tax implications (like an overdrawn Director's Loan Account / s455), or a fundamental accounting error.
    - **'Medium'**: Should be reviewed and explained — notable analytical variances (e.g. revenue/margin swings), liquidity or creditor-day movements, or items needing supporting evidence.
    - **'Minor'**: Low priority — small presentational points or variances within tolerance.
9. **suggestedJournal**: A suggested journal entry to correct the error, if applicable. If not applicable, return \`null\` for this field.

**Review Checklist:**
- **Compliance:** Check for items inconsistent with the business type (e.g., a Director's Loan Account for a Sole Trader should be 'Drawings' - this is a 'Serious' issue).
- **Balance Sheet Sanity Checks:**
    - Is cash/bank negative? ('Serious')
    - Are there fixed assets but no depreciation charge? ('Serious')
    - Is a Director's Loan Account overdrawn for a Limited Company? ('Serious' due to s455 tax implications).
- **P&L Analysis:** Look for glaring omissions (e.g., no partner profit allocation for a partnership).
- **Prior Year Comparison (if available):** Identify and comment on line items with variances > 20%. Classify as 'Medium' (or 'Serious' if the variance is exceptionally large and unexplained).
- **Contextual Review:** Take into account the 'Additional Context' provided.

Return a single JSON object with this exact shape and nothing else:
{ "reviewPoints": [ { "area": string, "subArea": string, "issue": string, "tag": string, "metric": { "value": string, "label": string, "delta": string }, "explanation": string, "risk": string, "severity": "Serious" | "Medium" | "Minor", "suggestedJournal": { "debitAccount": string, "creditAccount": string, "amount": number, "description": string } | null } ] }`;
}

interface WorkingPapersPromptOptions {
  businessName: string;
  clientCode: string;
  businessType: string;
  isVatRegistered: boolean;
  periodStart: string;
  periodEnd: string;
  relevantContext: string;
  preparerName: string;
  reviewPoints: unknown[];
}

// Step 2 — the working papers. Runs AFTER the review, as its own request, with
// the same financial documents attached. Produces the A1 "Notes for the
// Principal" narrative AND extracts the figures that pre-populate the working
// paper schedules. Splitting this out from the review keeps both responses
// comfortably under the output-token limit.
export function buildWorkingPapersPrompt(opts: WorkingPapersPromptOptions): string {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-GB');

  // Summarise each review point concisely so the prompt stays small regardless of count.
  const pointsSummary = (opts.reviewPoints as Array<{ area?: string; issue?: string; severity?: string; explanation?: string }>)
    .map((p, i) => `${i + 1}. [${p.severity ?? 'Minor'}] ${p.area ?? ''} — ${p.issue ?? ''}: ${p.explanation ?? ''}`)
    .join('\n');

  return `You are an expert UK chartered accountant preparing working papers for a final accounts review (UK GAAP, FRS 102/105).

**Client Context:**
- Business Name: ${opts.businessName || 'Not Provided'}
- Client Code: ${opts.clientCode || 'N/A'}
- Business Type: ${opts.businessType}
- VAT Registered: ${opts.isVatRegistered ? 'Yes' : 'No'}
- Accounting Period: ${opts.periodStart} to ${opts.periodEnd}
- Prepared by: ${opts.preparerName || 'Not Specified'} | Date: ${formattedDate}
- Additional Context: ${opts.relevantContext || 'None provided'}

The review has already been completed. These are the review points that were identified:
${pointsSummary || '(no review points)'}

**Task 1 — Write the A1 "Notes for the Principal" section.**
STRICT RULES:
- Plain text only. No markdown, no '#', no '**', no backticks.
- Structure: one short paragraph (3-4 sentences) summarising the overall position and key themes; then one clearly-labelled paragraph per review point — label each as "Point [N] — [Issue Title]:" then 2-3 sentences of commentary on implications and what action is needed; then one closing paragraph with overall recommendations for the partner.
- Keep each per-point commentary to 2-3 sentences maximum. Do not repeat the issue title verbatim — write a flowing commentary.

**Task 2 — Extract working paper data from the attached accounts.**
Read the financial documents and extract the figures below to pre-populate the working paper schedules. Use null for any figure you cannot find. All amounts must be numbers (no currency symbols).

Return a single JSON object with this exact shape and nothing else:
{
  "a1Content": "<the plain text A1 narrative as a single string>",
  "workingPaperData": {
    "fixedAssets": [ { "account": string, "bfwd": number, "additions": number, "disposals": number, "cfwd": number } ],
    "depreciationSchedule": [ { "asset": string, "cost": number, "ratePercent": number | null, "charge": number } ],
    "debtorsAndPrepayments": [ { "name": string, "amount": number, "notes": string } ],
    "bankAccounts": [ { "name": string, "bookBalance": number } ],
    "cashBalance": number | null,
    "creditorsAndAccruals": [ { "name": string, "amount": number, "notes": string } ],
    "plItems": {
      "insurance": number | null,
      "repairsRenewals": number | null,
      "legalProfessional": number | null,
      "rent": number | null,
      "rates": number | null,
      "sundry": number | null
    },
    "directorsEmoluments": [ { "name": string, "grossSalary": number, "payeNi": number, "pension": number, "netPay": number } ]
  }
}`;
}
