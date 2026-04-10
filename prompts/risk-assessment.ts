interface RiskAssessmentPromptOptions {
  raUsersName: string;
  raClientName: string;
  raClientCode: string;
  raClientType: string;
  answersText: string;
}

export function buildRiskAssessmentPrompt(opts: RiskAssessmentPromptOptions): string {
  return `
You are a compliance officer for a UK accountancy firm, specializing in AML risk assessment based on ACCA guidelines. Your task is to analyze a completed client risk assessment questionnaire and produce a formal report. A 'Yes' answer generally indicates a higher risk factor. Pay special attention to questions about PEPs, sanctioned jurisdictions, cash-intensive businesses, and complex structures.

**Assessment Details:**
- Assessor's Name: ${opts.raUsersName || 'Not Provided'}
- Client Name: ${opts.raClientName || 'Not Provided'}
- Client Code: ${opts.raClientCode || 'Not Provided'}
- Client Type: ${opts.raClientType || 'Not Provided'}

**Questionnaire Answers:**
${opts.answersText}

**Your Task:**
Based on these answers, provide a report in JSON format. The report must contain:
1. \`overallRiskLevel\`: Your assessment of the client's risk ('Low', 'Medium', or 'High').
2. \`riskJustification\`: A detailed paragraph explaining your reasoning for the assigned risk level. You MUST reference specific answers that influenced your decision.
3. \`summaryOfAnswers\`: An array of objects, one for each question, containing the 'questionId', 'question' text, the 'answer' ('Yes' or 'No'), and any 'userComment'. This must include ALL questions, not just the high-risk ones.
4. \`suggestedControls\`: A plain text section detailing specific, actionable controls to mitigate the identified risks. Use double line breaks for paragraphs.
5. \`trainingSuggestions\`: A plain text section suggesting relevant training topics for the firm's staff based on the risks found. Use double line breaks for paragraphs.
`;
}
