interface FinalAccountsPromptOptions {
  businessName: string;
  clientCode: string;
  businessType: string;
  isVatRegistered: boolean;
  periodStart: string;
  periodEnd: string;
  relevantContext: string;
}

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
2. **issue**: A short title for the issue (e.g., 'Negative Cash Balance').
3. **explanation**: A detailed explanation of why this is a potential issue.
4. **severity**: Classify the issue as either 'Serious' or 'Minor'.
    - **'Serious'**: Issues that are likely material, indicate a compliance breach, have significant tax implications (like an overdrawn Director's Loan Account), or represent a fundamental accounting error.
    - **'Minor'**: Issues that are less likely to be material, such as small analytical review variances that require explanation, or presentational points.
5. **suggestedJournal**: A suggested journal entry to correct the error, if applicable. If not applicable, return \`null\` for this field.

**Review Checklist:**
- **Compliance:** Check for items inconsistent with the business type (e.g., a Director's Loan Account for a Sole Trader should be 'Drawings' - this is a 'Serious' issue).
- **Balance Sheet Sanity Checks:**
    - Is cash/bank negative? ('Serious')
    - Are there fixed assets but no depreciation charge? ('Serious')
    - Is a Director's Loan Account overdrawn for a Limited Company? ('Serious' due to s455 tax implications).
- **P&L Analysis:** Look for glaring omissions (e.g., no partner profit allocation for a partnership).
- **Prior Year Comparison (if available):** Identify and comment on line items with variances > 20%. Classify as 'Minor' unless the variance is exceptionally large and unexplained.
- **Contextual Review:** Take into account the 'Additional Context' provided.

**Also produce A1 Working Paper Notes:**
As part of the same response, write the "A1 - Notes for the Principal" working paper section.
- Plain text only — no markdown, no '#', no '**', no backticks.
- Structure: one short overall summary paragraph (3-4 sentences), then one labelled paragraph per review point ("Point N — Issue Title: ...commentary in 2-3 sentences"), then one closing paragraph with recommendations for the partner.
- Keep each per-point commentary concise — 2-3 sentences maximum.

**Also extract Working Paper Data from the accounts:**
Read the financial documents and extract the following data to pre-populate the working paper schedules. Use null for any figure you cannot find. All amounts should be numbers (no currency symbols).

Return a single JSON object with these keys:
- "reviewPoints": array as described above
- "a1Notes": the plain text A1 narrative as a single string
- "workingPaperData": an object with the following structure:
  {
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
  }`;
}

interface WorkingPapersPromptOptions {
  businessName: string;
  clientCode: string;
  businessType: string;
  periodStart: string;
  periodEnd: string;
  preparerName: string;
  reviewPoints: unknown[];
}

export function buildWorkingPapersPrompt(opts: WorkingPapersPromptOptions): string {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-GB');

  // Summarise each review point concisely so the prompt stays small regardless of count
  const pointsSummary = (opts.reviewPoints as Array<{ area?: string; issue?: string; severity?: string; explanation?: string }>)
    .map((p, i) => `${i + 1}. [${p.severity ?? 'Minor'}] ${p.area ?? ''} — ${p.issue ?? ''}: ${p.explanation ?? ''}`)
    .join('\n');

  return `You are an expert UK chartered accountant. Prepare the A1 "Notes for the Principal" working paper section.

STRICT RULES:
- Plain text only. No markdown, no '#', no '**', no backticks.
- Keep each review point commentary to 2-3 sentences maximum.
- Do not repeat the issue title verbatim — write as a flowing commentary.

Client: ${opts.businessName || 'Not Provided'} (${opts.clientCode || 'N/A'})
Type: ${opts.businessType} | Period: ${opts.periodStart} to ${opts.periodEnd}
Prepared by: ${opts.preparerName || 'Not Specified'} | Date: ${formattedDate}

Review points to address:
${pointsSummary}

Write the A1 section in this exact structure:
1. One short paragraph (3-4 sentences) summarising the overall position and key themes.
2. One clearly-labelled paragraph per review point — label each as "Point [N] — [Issue Title]:" then 2-3 sentences of commentary on implications and what action is needed.
3. One closing paragraph with any overall recommendations for the partner.

Return ONLY a JSON object: {"a1Content": "<your plain text here>"}`;
}
