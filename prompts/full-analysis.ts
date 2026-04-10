export type TargetSoftware = 'vt' | 'capium' | 'xero' | 'quickbooks' | 'freeagent' | 'sage' | 'general';

interface FullAnalysisPromptOptions {
  clientName: string;
  clientAddress: string;
  isVatRegistered: boolean;
  fileNames: string[];
  targetSoftware: TargetSoftware;
  pastTransactionsContent?: string | null;
  ledgersContent?: string | null;
}

const CURRENCY_AND_DESCRIPTION = `
**Description Formatting:**
The main description field MUST be formatted as: "[Invoice Number] - [Supplier/Customer Name] - [Short Description] - [Service Period]".
- [Short Description]: A 1-2 word summary of the invoice's content (e.g., "Rent", "Office Supplies").
- [Service Period]: The date range if specified. Omit if not present.

**Currency Conversion:**
- If an invoice is not in GBP (£), you MUST convert ALL money values to GBP.
- Use the historical exchange rate for the currency to GBP on the invoice's date.
- ALL monetary fields in the final JSON output MUST be in GBP.
- If a conversion was performed, you MUST append the exchange rate used to the end of the description field in the format " (FX Rate: [value] [CUR]/GBP)".
`;

/**
 * Returns the static, cacheable part of the prompt.
 * This contains the software format rules + VAT rules + description/currency rules + flagging rules.
 * It is IDENTICAL for every request with the same targetSoftware + isVatRegistered, so Anthropic
 * can cache it and avoid re-processing these tokens on every call.
 */
export function buildStaticInstructions(targetSoftware: TargetSoftware, isVatRegistered: boolean): string {
  const vatInstruction = isVatRegistered
    ? `**VAT Status: REGISTERED.**\n- You MUST only extract a VAT amount if a VAT value (e.g., "VAT", "Value Added Tax") and a corresponding amount is explicitly listed on the document.\n- If the document does not explicitly state a VAT amount, the VAT value MUST be 0.\n- If a VAT registration number is present, it is a strong indicator that VAT might be applicable, but you still must find an explicit VAT amount on the document to extract it.`
    : `**VAT Status: NOT REGISTERED.**\n- The client is NOT VAT registered. For ALL transactions, the VAT amount MUST be 0.`;

  let taskPrompt = '';
  if (targetSoftware === 'vt') {
    taskPrompt = `**Task 1: Valid Transactions (VT Transaction+ Format)**\nRules: 'type' is PIN/SIN/PAY/REC/PCR. 'refNo' is "[auto]". 'date' is YYYY-MM-DD. 'primaryAccount' is the supplier/customer name. 'total' is the invoice's total GROSS amount. 'vat' is the invoice's total VAT amount. 'analysis' is the invoice's total NET amount. 'analysisAccount' MUST match the provided chart of accounts or be flagged. 'transactionNotes' is empty. Each document should result in a single transaction representing the invoice totals. ${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '' : "CRITICAL: 'vat' MUST be 0 and 'analysis' MUST equal 'total'."}`;
  } else if (targetSoftware === 'capium') {
    taskPrompt = `**Task 1: Valid Transactions (Capium Format)**\nRules: 'contacttype' is Supplier/Customer. 'invoicedate' is YYYY-MM-DD. 'accountname'/'accountcode' from chart of accounts. 'isvatincluded' is "Yes". 'amount' is the invoice's total GROSS amount. 'vatamount' is the total VAT. 'netAmount' is the total NET amount. For unpaid purchase invoices, leave 'paydate', 'payaccountname', 'payaccountcode' blank. ${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '' : "CRITICAL: 'vatamount' MUST be 0."}`;
  } else if (targetSoftware === 'xero') {
    taskPrompt = `**Task 1: Valid Transactions (Xero Bills Format)**\nRules: Format for single-line bills. Flag sales docs. 'invoiceNumber' is mandatory. 'dueDate' is invoiceDate + 30 days if not specified. 'quantity' is 1. 'unitAmount' is the invoice's NET amount. 'grossAmount' is the invoice's total GROSS amount. 'accountCode' from chart of accounts. ${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '`taxType` must be chosen from "20% (VAT on Expenses)", "5% (VAT on Expenses)", "Zero Rated Expenses", or "Exempt Expenses". If no VAT amount is explicitly stated on the document, you MUST use "No VAT" or "Exempt Expenses".' : 'CRITICAL: `unitAmount` MUST be the GROSS value (and therefore `grossAmount` must be the same value) and `taxType` MUST be "No VAT" or "Exempt Expenses".'}`;
  } else if (targetSoftware === 'quickbooks') {
    taskPrompt = `**Task 1: Valid Transactions (QuickBooks Online UK — Purchase Bills Format)**\nOutput one line per invoice/bill. Rules:\n- 'invoiceNo': Invoice or bill reference number from the document.\n- 'supplier': Supplier/vendor name exactly as it appears on the document.\n- 'invoiceDate': YYYY-MM-DD.\n- 'dueDate': YYYY-MM-DD (use invoiceDate + 30 days if not stated).\n- 'description': Follow the description formatting rules below.\n- 'quantity': Always 1.\n- 'unitAmount': NET amount (excluding VAT). This is the amount before VAT.\n- 'vatAmount': VAT amount (0 if client is not VAT registered or no VAT on invoice).\n- 'grossAmount': Total GROSS amount (unitAmount + vatAmount).\n- 'taxCode': QBO UK VAT code — use exactly one of: "20% (VAT on Purchases)", "5% (VAT on Purchases)", "Zero Rated (Purchases)", "Exempt (Purchases)", or "No VAT".\n- 'accountCode': Nominal/expense account code from the chart of accounts provided (e.g., "5000").\n- 'accountName': Full account name from the chart of accounts.\n${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '' : "CRITICAL: 'vatAmount' MUST be 0, 'unitAmount' MUST equal 'grossAmount', and 'taxCode' MUST be 'No VAT'."}`;
  } else if (targetSoftware === 'freeagent') {
    taskPrompt = `**Task 1: Valid Transactions (FreeAgent Bank Upload Format)**\nFreeAgent uses a strict 3-column positional CSV: Date, Amount, Description. Output one row per invoice/payment. Rules:\n- 'date': YYYY-MM-DD.\n- 'amount': Numeric amount to 2 decimal places. Payments OUT (purchase invoices, expenses, supplier payments) MUST be NEGATIVE (e.g., -150.00). Money received IN (sales receipts, refunds received) MUST be POSITIVE. No £ symbol, no comma separators.\n- 'description': Brief single-line description formatted as: "[Invoice/Ref No] [Supplier Name] [short description]". CRITICAL: No commas allowed anywhere in this field — replace any commas with a space or dash.\n${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '' : 'CRITICAL: Amounts should reflect gross totals as no VAT is applicable.'}`;
  } else if (targetSoftware === 'general') {
    taskPrompt = `**Task 1: Valid Transactions (General Spreadsheet Format)**\nProduce a clean, human-readable spreadsheet export suitable for any purpose. Output one row per invoice/document. Rules:\n- 'date': YYYY-MM-DD invoice or document date.\n- 'supplier': Supplier or customer name as shown on the document.\n- 'invoiceNumber': Invoice or reference number.\n- 'description': Clear description following the formatting rules below.\n- 'netAmount': Net amount excluding VAT.\n- 'vatAmount': VAT amount (0 if not VAT registered or no VAT shown).\n- 'grossAmount': Total gross amount (netAmount + vatAmount).\n- 'currency': Three-letter currency code (e.g., GBP, USD, EUR). Always GBP after conversion.\n- 'documentType': Type of document — use one of: "Purchase Invoice", "Sales Invoice", "Credit Note", "Receipt", "Bank Statement".\n- 'category': Suggested expense or income category (e.g., "Office Supplies", "Travel", "Professional Fees", "Rent", "Utilities").\n- 'notes': Any relevant notes, flags, or the FX rate used if currency was converted. Leave blank if nothing to note.\n${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '' : "CRITICAL: 'vatAmount' MUST be 0 and 'netAmount' MUST equal 'grossAmount'."}`;
  } else {
    // sage
    taskPrompt = `**Task 1: Valid Transactions (Sage 50 UK — Audit Trail Import Format)**\nOutput one row per invoice line. Rules:\n- 'TYPE': Transaction type code. Use 'PI' for Purchase Invoice, 'SI' for Sales Invoice, 'PC' for Purchase Credit Note, 'SC' for Sales Credit Note, 'BP' for Bank Payment, 'BR' for Bank Receipt.\n- 'ACCOUNT_REF': Supplier or customer account reference as it appears in Sage (short code, max 8 chars, no spaces — e.g., "AMAZON01", "SMITH001"). Derive from supplier name.\n- 'NOMINAL_CODE': Nominal/expense ledger code from the chart of accounts provided (numeric, e.g., 5000 for purchases, 7000 for overheads).\n- 'DATE': DD/MM/YYYY.\n- 'REFERENCE': Invoice reference number (max 30 chars).\n- 'DETAILS': Short description (max 60 chars) — supplier name and brief description.\n- 'NET_AMOUNT': Net amount excluding VAT (positive number).\n- 'TAX_CODE': Sage VAT tax code. Use 'T1' for standard 20% VAT, 'T5' for reduced 5% VAT, 'T0' for zero-rated, 'T9' for exempt or outside scope. ${isVatRegistered ? '' : "CRITICAL: Always use 'T9' and TAX_AMOUNT must be 0."}\n- 'TAX_AMOUNT': VAT amount (0 if T0/T9 or client not VAT registered).\n- 'EXCHANGE_RATE': Always 1.00 for GBP. If invoice is in foreign currency, convert all amounts to GBP first and note the rate in DETAILS.\n${CURRENCY_AND_DESCRIPTION} ${isVatRegistered ? '' : "CRITICAL: 'TAX_AMOUNT' MUST be 0 and 'TAX_CODE' MUST be 'T9'."}`;
  }

  const flaggingPrompt = `**Task 2: Flagging Entries**\nFlag irrelevant, unprocessable, or potential duplicate documents. Include the page number where the flagged item was found. When checking for duplicates within the current batch, if you find multiple identical documents, you MUST process the first occurrence as a valid transaction and flag all subsequent occurrences as duplicates.`;

  return [
    vatInstruction,
    taskPrompt,
    flaggingPrompt,
    `Return a single JSON object with keys: 'validTransactions' and 'flaggedEntries'.`,
  ].join('\n\n');
}

/**
 * Returns the dynamic, per-request part of the prompt.
 * This contains the specific file names, client info, and any context data.
 * It changes on every request so it cannot be cached.
 */
export function buildDynamicContext(opts: {
  fileNames: string[];
  clientName: string;
  clientAddress: string;
  pastTransactionsContent?: string | null;
  ledgersContent?: string | null;
}): string {
  const { fileNames, clientName, clientAddress, pastTransactionsContent, ledgersContent } = opts;

  let context = `**Documents to analyse:** [${fileNames.join(', ')}]\n\n**CRITICAL INSTRUCTIONS:**\n1. You MUST process every single document provided. Each document must result in an entry in either the 'validTransactions' array OR the 'flaggedEntries' array. Do not omit any document from the final JSON output.\n2. For the 'fileName' field in your response, you MUST use the exact filename from the provided list: [${fileNames.join(', ')}].\n3. For each transaction or flagged entry, you MUST identify the page number (starting from 1) in the source document where it was found.`;

  if (clientName.trim()) {
    context += `\n\n**Client Information for Context:**\nThe client is "${clientName.trim()}", address: "${clientAddress.trim()}".\n**Critical Instructions based on Client Info:**\n- A document is a **purchase** if addressed TO the client. Use type 'PIN'.\n- A document is a **sale** if issued BY the client. Use type 'SIN'.\n- If addressed to a different entity, flag it as "Potentially irrelevant".\n- If unsure, flag as "Uncertain transaction type".`;
  }

  if (pastTransactionsContent) {
    context += `\n\nPast transactions for context (use for duplicate detection — a duplicate is primarily identified by a matching **Invoice Number**; also consider same supplier + date within 7 days + total within £1.00):\n---\n${pastTransactionsContent}\n---`;
  }

  if (ledgersContent) {
    context += `\n\nChart of accounts to use:\n---\n${ledgersContent}\n---`;
  }

  return context;
}

/** @deprecated Use buildStaticInstructions + buildDynamicContext instead */
export function buildFullAnalysisPrompt(opts: FullAnalysisPromptOptions): string {
  const staticPart = buildStaticInstructions(opts.targetSoftware, opts.isVatRegistered);
  const dynamicPart = buildDynamicContext({
    fileNames: opts.fileNames,
    clientName: opts.clientName,
    clientAddress: opts.clientAddress,
    pastTransactionsContent: opts.pastTransactionsContent,
    ledgersContent: opts.ledgersContent,
  });
  return dynamicPart + '\n\n' + staticPart;
}
