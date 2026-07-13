// MTD IT analyse prompts — one builder per income stream.
//
// Each prompt instructs Claude to return ONLY a JSON object matching a fixed
// schema. The /api/mtd-it/analyse route parses the response and writes each
// entry into the mtd_it_entries table. The categories are constrained to the
// canonical lists in lib/mtdIt/categories.ts; if Claude returns something off-
// list we coerce to "Other Income" / "Other Expense" server-side.

import {
  SOLE_TRADER_INCOME, SOLE_TRADER_EXPENSES,
  UK_RENTAL_INCOME,   UK_RENTAL_EXPENSES,
} from '@/lib/mtdIt/categories';
import type { MtdItStream } from '@/types';

export interface PromptContext {
  taxYearLabel: string;            // e.g. "2026/27"
  quarterLabel: string;            // e.g. "Q1 (1 Apr – 30 Jun 2026)"
  fromIso: string;                 // YYYY-MM-DD, inclusive
  toIso:   string;                 // YYYY-MM-DD, inclusive
  /** Property addresses available to tag rental rows against. */
  properties?: Array<{ id: string; address: string; currency: string }>;
  /** Trade names available to tag sole-trader rows against. */
  trades?:     Array<{ id: string; name: string }>;
}

const COMMON_RULES = `
**Output rules**
- Respond with VALID JSON ONLY. No prose, no \`\`\` fences, no leading commentary.
- The top-level object MUST have an "entries" array. Empty array if nothing was extractable.
- Use ISO dates (YYYY-MM-DD) throughout.
- gross_amount, net_amount, vat_amount are numbers (no currency symbols, no thousands separators).
- Where you can't determine net or VAT, set them to null. gross_amount must always be filled.
- If the document seems to fall outside the requested quarter (${'see range below'}), still extract the row but set flagged_reason to "Outside quarter date range".
- If you see what looks like a duplicate within the same file, set flagged_reason to "Possible duplicate in same document".
`;

function buildPropertyHint(props?: PromptContext['properties']): string {
  if (!props || props.length === 0) {
    return `**Properties**: none defined yet. Leave property_id null.`;
  }
  const list = props.map(p => `  - id: ${p.id}  |  ${p.address} (${p.currency})`).join('\n');
  return `**Properties (tag each row against one if you can match it confidently by address; otherwise null):**
${list}`;
}

function buildTradeHint(trades?: PromptContext['trades']): string {
  if (!trades || trades.length === 0) {
    return `**Trades**: none defined yet. Leave trade_id null.`;
  }
  const list = trades.map(t => `  - id: ${t.id}  |  ${t.name}`).join('\n');
  return `**Trades (tag each row against one if the document plainly belongs to that trade; otherwise null):**
${list}`;
}

export function buildMtdItPrompt(stream: MtdItStream, ctx: PromptContext): string {
  if (stream === 'sole') {
    return `You are an expert UK bookkeeper preparing a sole-trader's MTD IT quarterly return.

**Tax year**: ${ctx.taxYearLabel}
**Quarter**: ${ctx.quarterLabel}
**Date range**: ${ctx.fromIso} to ${ctx.toIso} (inclusive)

${buildTradeHint(ctx.trades)}

**Your task**
Extract EVERY income or expense transaction visible in the documents. Categorise each against the closed list below.

**Income categories** (entry_type: "income"): ${JSON.stringify(SOLE_TRADER_INCOME)}
**Expense categories** (entry_type: "expense"): ${JSON.stringify(SOLE_TRADER_EXPENSES)}

If a transaction doesn't obviously fit a specific category, use "Other Income" / "Other Expense".

${COMMON_RULES}

**Required JSON schema**
{
  "entries": [
    {
      "page_number": number | null,
      "entry_date": "YYYY-MM-DD",
      "description": string,
      "supplier": string | null,
      "invoice_number": string | null,  // invoice / receipt reference if visible on the document, else null
      "category": string,            // one of the allowed categories above
      "entry_type": "income" | "expense",
      "gross_amount": number,
      "net_amount": number | null,
      "vat_amount": number | null,
      "currency": "GBP",             // sole-trader is always GBP for MTD IT
      "trade_id": string | null,     // pick from the trades list if applicable
      "flagged_reason": string | null
    }
  ]
}
Return ONLY this object.`;
  }

  if (stream === 'uk_rental') {
    return `You are an expert UK bookkeeper preparing a landlord's MTD IT quarterly UK property return.

**Tax year**: ${ctx.taxYearLabel}
**Quarter**: ${ctx.quarterLabel}
**Date range**: ${ctx.fromIso} to ${ctx.toIso} (inclusive)

${buildPropertyHint(ctx.properties)}

**Your task**
Extract EVERY income or expense transaction visible in the documents. Categorise each against the closed list below.

**Income categories** (entry_type: "income"): ${JSON.stringify(UK_RENTAL_INCOME)}
**Expense categories** (entry_type: "expense"): ${JSON.stringify(UK_RENTAL_EXPENSES)}

If a transaction doesn't obviously fit, use "Other Income" / "Other Expenses".

${COMMON_RULES}

**Required JSON schema**
{
  "entries": [
    {
      "page_number": number | null,
      "entry_date": "YYYY-MM-DD",
      "description": string,
      "supplier": string | null,
      "category": string,
      "entry_type": "income" | "expense",
      "gross_amount": number,
      "net_amount": number | null,
      "vat_amount": number | null,
      "currency": "GBP",             // UK rentals are always GBP
      "property_id": string | null,  // pick from the property list if you can match it
      "flagged_reason": string | null
    }
  ]
}
Return ONLY this object.`;
  }

  // foreign_rental
  return `You are an expert UK bookkeeper preparing a UK-resident landlord's MTD IT quarterly FOREIGN property return.

**Tax year**: ${ctx.taxYearLabel}
**Quarter**: ${ctx.quarterLabel}
**Date range**: ${ctx.fromIso} to ${ctx.toIso} (inclusive)

${buildPropertyHint(ctx.properties)}

**Your task**
Extract EVERY income or expense transaction visible in the documents. Categorise each against the closed list below. Detect the currency of each transaction (the document may not be in GBP). Use ISO 4217 codes (e.g. EUR, USD, AUD). Do NOT convert to GBP — the user enters FX rates separately.

**Income categories** (entry_type: "income"): ${JSON.stringify(UK_RENTAL_INCOME)}
**Expense categories** (entry_type: "expense"): ${JSON.stringify(UK_RENTAL_EXPENSES)}

If a transaction doesn't obviously fit, use "Other Income" / "Other Expenses".

${COMMON_RULES}

**Required JSON schema**
{
  "entries": [
    {
      "page_number": number | null,
      "entry_date": "YYYY-MM-DD",
      "description": string,
      "supplier": string | null,
      "category": string,
      "entry_type": "income" | "expense",
      "gross_amount": number,
      "net_amount": number | null,
      "vat_amount": number | null,
      "currency": string,            // ISO 4217 — e.g. "EUR", "USD"
      "property_id": string | null,
      "flagged_reason": string | null
    }
  ]
}
Return ONLY this object.`;
}
