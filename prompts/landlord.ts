export interface LandlordPastContext {
  pastIncome: Array<{ Date: string; PropertyAddress: string; Description: string; Amount: number }>;
  pastExpenses: Array<{ DueDate: string; Description: string; Category: string; Supplier: string; PropertyAddress: string; Amount: number; CapitalExpense: boolean; TenantPayable: boolean }>;
}

function buildPastContextSection(ctx: LandlordPastContext | null | undefined): string {
  if (!ctx) return '';
  const incCount = ctx.pastIncome?.length ?? 0;
  const expCount = ctx.pastExpenses?.length ?? 0;
  if (incCount === 0 && expCount === 0) return '';

  return `

**Reference: Prior Analyses for the Same Client**

Below are past income and expense entries that this client's previous analyses produced. Use them — and only them — as a hint for:
- Choosing the SAME canonical PropertyAddress when an address you extract obviously refers to the same property the past entries used (e.g. partial-vs-full match).
- Reusing the SAME Supplier name when the supplier on the current document is clearly the same entity (avoid "Brit Gas" vs "British Gas Plc" splits).
- Picking the SAME Category for recurring expenses from the same supplier or for the same kind of work.
- Reusing the same TenantPayable / CapitalExpense classification for like-for-like items unless the new document plainly says otherwise.
- Detecting probable duplicates: if the current document matches a past income/expense by date + amount + property/supplier, flag it with reason "Possible duplicate of past analysis".

Do NOT copy past entries into your output. Only extract from the documents you are given. Past entries are reference, not source material.

Past income (${incCount} entries):
${JSON.stringify(ctx.pastIncome ?? []).slice(0, 12000)}

Past expenses (${expCount} entries):
${JSON.stringify(ctx.pastExpenses ?? []).slice(0, 18000)}
`;
}

export function buildLandlordPrompt(pastContext?: LandlordPastContext | null): string {
  const categories = [
    "Allowable loan interest and other financial costs",
    "Non-residential loan interest and other financial costs",
    "Car, van and other travel expenses",
    "Costs of services provided, including wages",
    "Legal, management and other professional fees",
    "Other allowable property expenses",
    "Property repairs and maintenance",
    "Rent, rates, insurance, ground rents"
  ];

  return `You are an expert UK bookkeeper for landlords. Your task is to analyze the provided documents which could be expense receipts, invoices, OR landlord statements from letting agents.

Your goal is to extract both INCOME and EXPENSE transactions and flag anything irrelevant.

**Task 1: Extract Income Transactions**
- Look for landlord statements from letting agents or other evidence of rental income.
- For each income transaction, extract:
    1. **Date**: The payment or statement date. Format as YYYY-MM-DD.
    2. **PropertyAddress**: The address of the rental property.
    3. **Description**: A concise summary, e.g., "Rent for April 2024". Also include any service period found.
    4. **Category**: This MUST be the exact string "Total rents and other income from property".
    5. **Amount**: The total gross income received.
- Populate the 'income' array with these objects.

**Task 2: Extract Expense Transactions**
- Look for invoices and receipts for property-related expenses.
- For each expense transaction, extract:
    1. **DueDate**: The main date on the invoice/receipt. Format as YYYY-MM-DD.
    2. **Description**: A concise summary of the expense.
    3. **Category**: You MUST assign one of the following exact categories: [${categories.join(', ')}].
       - **Finance costs** (mortgage/loan interest, arrangement/broker fees): use "Allowable loan interest and other financial costs" for RESIDENTIAL lets (the default — these are restricted, giving a 20% tax reducer). Use "Non-residential loan interest and other financial costs" ONLY when the property is clearly commercial (office, shop, warehouse, land). If unsure, default to the residential one.
    4. **Amount**: The total gross amount of the expense.
    5. **Supplier**: The name of the supplier.
    6. **TenantPayable**: Set to \`true\` if the cost is to be recharged to a tenant, otherwise \`false\`.
    7. **CapitalExpense**: Set to \`true\` if it is an improvement (capital), \`false\` if it is a repair/maintenance.
    8. **PropertyAddress**: The address of the rental property this expense relates to. First, look for an address in the document's description. If not found, use the address the document is made out to. If no address can be found anywhere, you MUST use the string "No Address".
- Populate the 'expenses' array with these objects.

**Task 3: Flagging Rules:**
- If a document is clearly not property-related (e.g., a personal shopping receipt), you MUST flag it.
- When flagging an entry, you MUST still attempt to extract and include the 'date', 'supplier', 'amount', 'description', and 'PropertyAddress' (if available, otherwise "No Address") in the flagged entry object.

Return a single JSON object with three keys: 'income', 'expenses', and 'flaggedEntries'.${buildPastContextSection(pastContext)}`;
}

export function buildAddressGroupingPrompt(addresses: string[]): string {
  return `You are an address normalization expert. The following is a list of property addresses extracted from documents: ${JSON.stringify(addresses)}.

Your task is to group addresses that refer to the SAME physical property, even when written with different levels of detail.

CRITICAL RULES — apply these in order:

1. **Partial vs full address**: If one address is simply a shorter version of another (missing town, county, or postcode), they are THE SAME property. For example:
   - "9 Rothley Close" and "9 Rothley Close, Shrewsbury, SY3 6AN" → SAME property
   - "14 High Street" and "14 High Street, Birmingham, B1 1AA" → SAME property
   Always use the most complete version as the canonical address.

2. **Postcode present vs absent**: An address with a postcode and the same address without one are the same property.

3. **Abbreviations**: Standardise — "Rd" = "Road", "St" = "Street", "Ave" = "Avenue", "Cl" = "Close", "Dr" = "Drive", "Ln" = "Lane", "Ct" = "Court".

4. **Minor typos**: If two addresses clearly refer to the same street and number despite a spelling difference, group them.

5. **Always pick the MOST COMPLETE version** (most address components, includes postcode) as the canonical.

6. "No Address" must always map to "No Address".

Return ONLY a single JSON object with key 'addressMap'. Each key is an original address from the input; each value is the canonical address for its group.

Example input: ["9 Rothley Close", "9 Rothley Close, Shrewsbury, SY3 6AN", "10 Glen Rd", "10 Glenn Road, Leeds"]
Example output: {"9 Rothley Close": "9 Rothley Close, Shrewsbury, SY3 6AN", "9 Rothley Close, Shrewsbury, SY3 6AN": "9 Rothley Close, Shrewsbury, SY3 6AN", "10 Glen Rd": "10 Glenn Road, Leeds", "10 Glenn Road, Leeds": "10 Glenn Road, Leeds"}`;
}
