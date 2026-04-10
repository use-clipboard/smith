export function buildSummarisePrompt(): string {
  return `You are an expert UK bookkeeper. Analyze the provided financial documents.

**Primary Goal:** For EACH document, extract its details into a structured object.

**Intelligent Date Analysis**
For each document, you MUST determine its **relevant service date or period**. This is not just the invoice date.
- Look for phrases like "for the period...", "services rendered in...", "rent for month of...".
- If a service period is found (e.g., "November 2025"), use a representative date from that period (e.g., "2025-11-01").
- If no service period is found, use the main invoice date.
- The final determined relevant date for each document MUST be in YYYY-MM-DD format and assigned to the 'detectedDate' field.

**Output Generation**
Return a single JSON object with ONE key: 'documents'.
The 'documents' key should contain a flat array where each object represents a single document you analyzed. Each object in the array must contain:
- 'fileName': The name of the source file.
- 'detectedDate': The relevant date you determined, in YYYY-MM-DD format.
- 'entityName': The name of the supplier or customer.
- 'detailedCategory': A detailed accounting category (e.g., 'Expense - Electricity', 'Income - Sales').
- 'totalNetAmount': The total net amount. Use 0 if not applicable.
- 'totalVatAmount': The total VAT amount. Use 0 if not applicable.
- 'totalGrossAmount': The total gross amount.`;
}
