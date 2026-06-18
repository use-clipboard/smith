export interface BankToCsvContext {
  accountName?: string | null;
  accountNumber?: string | null;
  yearEnd?: string | null;
}

export function buildBankToCsvPrompt(ctx?: BankToCsvContext): string {
  const contextLines: string[] = [];
  if (ctx?.accountName)   contextLines.push(`- Account name: ${ctx.accountName}`);
  if (ctx?.accountNumber) contextLines.push(`- Account number: ${ctx.accountNumber}`);
  if (ctx?.yearEnd)       contextLines.push(`- Client accounting year end: ${ctx.yearEnd} — use this to resolve any ambiguous transaction years (e.g. statements that show only the day and month).`);
  const contextBlock = contextLines.length
    ? `\n\nAdditional context for this statement (for your reference only — do not add it as columns):\n${contextLines.join('\n')}`
    : '';

  return `You are an expert UK bookkeeper. Your task is to extract all transactions from the provided bank statement document.

For each transaction extract:
- 'Date' (YYYY-MM-DD format)
- 'Description' (the transaction narrative exactly as it appears)
- 'Money In' (number or null)
- 'Money Out' (number or null)
- 'Balance' (running balance as a number, or null if not shown)

Return a single JSON object with one key: 'transactions', containing an array of transaction objects. Do not include any analysis, categorisation, or ledger suggestions.${contextBlock}`;
}
