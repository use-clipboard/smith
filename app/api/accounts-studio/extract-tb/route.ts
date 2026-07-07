import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { logAiUsage } from '@/lib/driveUpload';

export const maxDuration = 60;

// ── POST /api/accounts-studio/extract-tb ─────────────────────────────────────
// The user uploads a trial balance as a PDF or image. Claude reads it and returns
// the full list of accounts — name, statement type and debit/credit — which the
// client drops into the shared trial-balance editor for the user to review, edit
// and build the statements from. Nothing is persisted here.

const ACCOUNT_TYPES = ['income', 'expense', 'asset', 'liability', 'equity'] as const;

const FileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});
const Body = z.object({ files: z.array(FileSchema).min(1).max(5) });

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const r2 = (n: number) => +Number(n).toFixed(2);

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // ── Build the document/image content blocks (mirrors /api/analyse). ─────────
  const contentBlocks: Anthropic.ContentBlockParam[] = [];
  for (const f of body.files) {
    if (f.mimeType === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } });
    } else if (IMAGE_TYPES.has(f.mimeType)) {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } });
    }
  }
  if (contentBlocks.length === 0) {
    return NextResponse.json({ error: 'Unsupported file — upload a PDF, JPG or PNG of the trial balance.' }, { status: 400 });
  }

  const tool: Anthropic.Tool = {
    name: 'return_trial_balance',
    description: 'Return the full trial balance extracted from the document.',
    input_schema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: 'One row per account in the trial balance — profit-and-loss and balance-sheet accounts alike.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The account / nominal name exactly as shown.' },
              type: { type: 'string', enum: ACCOUNT_TYPES as unknown as string[], description: 'income, expense, asset, liability or equity.' },
              debit: { type: 'number', description: 'Debit balance (positive number). 0 if this is a credit.' },
              credit: { type: 'number', description: 'Credit balance (positive number). 0 if this is a debit.' },
            },
            required: ['name', 'type', 'debit', 'credit'],
          },
        },
        detected_year_end: { type: 'string', description: 'The balance/period-end date shown (YYYY-MM-DD), if visible.' },
        note: { type: 'string', description: 'One short sentence on anything the user should check (e.g. a figure that was hard to read, or debits and credits not tallying).' },
      },
      required: ['rows'],
    },
  };

  const systemPrompt = `You are an expert UK accountant extracting a TRIAL BALANCE from a client's document (a PDF or scan/photo).

Read every account line and return it. Rules:
- Include ALL accounts — both profit-and-loss (income, expenses) and balance-sheet (assets, liabilities, equity).
- Classify each account's "type" as income, expense, asset, liability or equity based on its meaning.
- Each account is single-sided: put its figure in EITHER debit OR credit (positive numbers), reading the document's own Dr/Cr columns where present. Assets and expenses are normally debits; income, liabilities and equity are normally credits. A figure in brackets or marked Cr is a credit.
- Use the figures in the document exactly. Do NOT invent lines or force the balance — if the source's debits and credits don't tally, return what's there and mention it in note.
- Ignore sub-totals, section headers and the grand total rows — return only the individual account lines.

Call return_trial_balance with the result.`;

  let anthropic: Anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 402 });
    }
    console.error('[accounts-studio] extract-tb anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  let parsed: { rows?: unknown[]; detected_year_end?: string; note?: string };
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'return_trial_balance' },
      messages: [{ role: 'user', content: contentBlocks }],
    });
    void logAiUsage({
      ...ctx,
      clientId: null,
      feature: 'accounts_studio',
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    });
    const toolUse = message.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
    if (!toolUse) return NextResponse.json({ error: 'SMITH could not read a trial balance from that document. Try a clearer scan.' }, { status: 422 });
    parsed = toolUse.input as typeof parsed;
  } catch (err) {
    console.error('[accounts-studio] extract-tb failed', err);
    return NextResponse.json({ error: 'SMITH hit a problem reading the document. Please try again.' }, { status: 500 });
  }

  // ── Validate the rows. ──────────────────────────────────────────────────────
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const rows = rawRows.map(raw => {
    const r = raw as Record<string, unknown>;
    const name = String(r.name ?? '').trim().slice(0, 200);
    const type = (ACCOUNT_TYPES as readonly string[]).includes(String(r.type)) ? String(r.type) : 'expense';
    const debit = r2(Math.max(0, Number(r.debit ?? 0) || 0));
    const credit = r2(Math.max(0, Number(r.credit ?? 0) || 0));
    return { name, type, debit, credit };
  }).filter(r => r.name && (r.debit !== 0 || r.credit !== 0));

  if (!rows.length) {
    return NextResponse.json({ error: 'No account lines were found in that document. Try a clearer scan, or use CSV / manual entry.' }, { status: 422 });
  }

  const detectedYearEnd = typeof parsed.detected_year_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.detected_year_end)
    ? parsed.detected_year_end : null;

  return NextResponse.json({ rows, detectedYearEnd, note: typeof parsed.note === 'string' ? parsed.note : '' });
}
