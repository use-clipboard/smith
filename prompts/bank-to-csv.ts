export function buildBankToCsvPrompt(): string {
  return `You are an expert UK bookkeeper. Your task is to extract all transactions from the provided bank statement document.

For each transaction extract:
- 'Date' (YYYY-MM-DD format)
- 'Description' (the transaction narrative exactly as it appears)
- 'Money In' (number or null)
- 'Money Out' (number or null)
- 'Balance' (running balance as a number, or null if not shown)

Return a single JSON object with one key: 'transactions', containing an array of transaction objects. Do not include any analysis, categorisation, or ledger suggestions.`;
}
