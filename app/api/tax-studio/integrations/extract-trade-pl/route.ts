import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const FileSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  base64: z.string().optional(),
  text: z.string().optional(),
}).refine(f => (f.base64 && f.base64.length > 0) || (f.text && f.text.length > 0), {
  message: 'File must include base64 or text',
});

const BodySchema = z.object({ files: z.array(FileSchema).min(1).max(6) });

function parseJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  const m = s.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : s);
}

// POST /api/tax-studio/integrations/extract-trade-pl
// Read an uploaded set of accounts / trial balance and return ONLY the P&L
// (trading income & expense) lines, in the same PlLine shape the connected-tool
// pull-in uses — so they flow straight into the itemise-and-review modal.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);

    const fileBlocks = body.files.map(f =>
      f.text != null && f.text.length > 0
        ? { type: 'text' as const, text: `Document "${f.name}":\n\n${f.text}` }
        : f.mimeType === 'application/pdf'
          ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 ?? '' } }
          : { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 ?? '' } },
    );

    const instruction = `From the attached accounts or trial balance for a sole trader, extract ONLY the profit & loss (trading) lines — income and expenses.

Rules:
- IGNORE balance-sheet items entirely: fixed assets, stock, debtors, bank, cash, creditors, loans, VAT, capital, drawings, retained earnings.
- IGNORE any total / subtotal / net-profit / gross-profit lines — return only the individual account lines.
- Return each line's amount as a POSITIVE number and mark it "income" or "expense" (in a trial balance, income is the credit balance, expenses are the debit balance).
- Use the account's own name as the label.
- Also read the accounting period the statements cover, as ISO dates (yyyy-mm-dd) — periodStart and periodEnd. Omit them if not shown.

Reply with ONLY this JSON, no prose: {"lines":[{"label":"...","amount":123.45,"section":"income"}],"periodStart":"2025-04-06","periodEnd":"2026-04-05"}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are an expert UK accountant reading a set of accounts or a trial balance. Respond with valid JSON only — no prose, no code fences.',
      messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: instruction }] }],
    });

    void logAiUsage({ ...ctx, clientId: null, feature: 'tax_studio', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    const textPart = response.content.find(c => c.type === 'text');
    if (!textPart || textPart.type !== 'text') return NextResponse.json({ error: 'No response from AI.' }, { status: 502 });

    let raw: unknown;
    try { raw = parseJson(textPart.text); }
    catch { return NextResponse.json({ error: 'Could not read the accounts — please check the file or enter the figures manually.' }, { status: 502 }); }

    const r = raw as { lines?: unknown; periodStart?: unknown; periodEnd?: unknown };
    const lines = ((r.lines ?? []) as { label?: unknown; amount?: unknown; section?: unknown }[])
      .map(l => ({ label: String(l.label ?? '').trim(), amount: Math.round(Number(l.amount) || 0), section: l.section === 'income' ? 'income' as const : 'expense' as const }))
      .filter(l => l.label && l.amount !== 0);
    const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

    return NextResponse.json({ lines, periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd) });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[/api/tax-studio/integrations/extract-trade-pl]', err);
    return NextResponse.json({ error: 'Could not read the accounts. Please try again.' }, { status: 502 });
  }
}
