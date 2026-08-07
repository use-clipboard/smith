import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';
import { SA103_BOX_CATALOG } from '@/components/features/tax-studio/integrations';

export const maxDuration = 60;

const RequestSchema = z.object({
  lines: z.array(z.object({
    label: z.string(),
    amount: z.number(),
    section: z.enum(['income', 'expense']),
  })).max(200),
});

// POST /api/tax-studio/integrations/map-trade-boxes
// Allocates each source P&L line to an SA103F box (15–30) using Claude. The
// client shows the result for review before it lands, and falls back to a
// turnover / other-costs split if this route is unavailable.
export async function POST(req: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { lines } = parsed.data;
    if (!lines.length) return NextResponse.json({ allocations: [] });

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAccessTaxStudio(userCtx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    const boxList = SA103_BOX_CATALOG.map(b => `  ${b.box} — ${b.label} (${b.section})`).join('\n');
    const lineList = lines.map((l, i) => `  [${i}] "${l.label}" — £${l.amount} (${l.section})`).join('\n');

    const system = `You are a UK tax assistant mapping a business's profit & loss lines to the boxes on HMRC form SA103F (Self-employment, full).

The SA103F income and expense boxes are:
${boxList}

Rules:
- Map EVERY line to exactly one box that matches its nature.
- Income lines must map to an income box (15 or 16); expense lines to an expense box (17–30).
- Turnover / sales / fees → box 15. Grants, other trading income → box 16.
- If an expense line does not clearly fit boxes 17–29, use box 30 (Other business expenses).
- Keep the amount exactly as given. Do NOT invent, split or merge lines.
- Reply with ONLY a JSON object: {"allocations":[{"index":<line index>,"box":"<box number>"}]}. No prose.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: `Map these ${lines.length} lines:\n${lineList}` }],
    });

    void logAiUsage({
      ...userCtx,
      clientId: null,
      feature: 'tax_studio',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const textBlock = response.content.find(c => c.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const match = text.match(/\{[\s\S]*\}/);
    const validBoxes = new Set(SA103_BOX_CATALOG.map(b => b.box));
    let allocations: { label: string; amount: number; box: string }[] = [];
    if (match) {
      try {
        const raw = JSON.parse(match[0]) as { allocations?: { index?: number; box?: string }[] };
        allocations = (raw.allocations ?? [])
          .map(a => {
            const line = typeof a.index === 'number' ? lines[a.index] : undefined;
            const box = String(a.box ?? '');
            if (!line || !validBoxes.has(box)) return null;
            return { label: line.label, amount: line.amount, box };
          })
          .filter((a): a is { label: string; amount: number; box: string } => a !== null);
      } catch { /* fall through to fallback below */ }
    }
    // Fallback: any line the model missed keeps a sensible default so no figure is lost.
    if (allocations.length !== lines.length) {
      const seen = new Set(allocations.map(a => a.label + '|' + a.amount));
      for (const l of lines) {
        if (!seen.has(l.label + '|' + l.amount)) allocations.push({ label: l.label, amount: l.amount, box: l.section === 'income' ? '15' : '30' });
      }
    }

    return NextResponse.json({ allocations });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[/api/tax-studio/integrations/map-trade-boxes]', err);
    return NextResponse.json({ error: 'Could not map the P&L lines.' }, { status: 500 });
  }
}
