import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';
import { TAX_STUDIO_SYSTEM } from '@/prompts/tax-studio';

export const maxDuration = 60;

const ContextSchema = z.object({
  clientName: z.string().default(''),
  returnForm: z.string().default(''),
  returnLabel: z.string().default(''),
  taxYear: z.string().default(''),
  entity: z.string().default(''),
  stage: z.string().default(''),
  estimatedTax: z.number().nullable().optional(),
  totalIncome: z.number().nullable().optional(),
  context: z.string().default(''),
});

const RequestSchema = z.object({
  context: ContextSchema,
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(12),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { context, messages } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAccessTaxStudio(userCtx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    const gbp = (n: number | null | undefined) => (n == null) ? null : `£${Math.round(n).toLocaleString('en-GB')}`;
    const figs = [
      gbp(context.totalIncome) && `Total income ${gbp(context.totalIncome)}`,
      gbp(context.estimatedTax) && `Estimated tax ${gbp(context.estimatedTax)} (SMITH estimate)`,
    ].filter(Boolean).join('; ');

    const ctxLine = `Return context — Client: ${context.clientName || 'n/a'}; Return: ${context.returnForm} ${context.returnLabel}; Tax year: ${context.taxYear || 'n/a'}; Entity: ${context.entity || 'n/a'}; Current stage: ${context.stage || 'n/a'}.`
      + (figs ? `\nFigures — ${figs}. Use these where relevant; do not invent numbers.` : '')
      + (context.context ? `\nAccountant's context notes: ${context.context}` : '');

    const system = TAX_STUDIO_SYSTEM + '\n\n' + ctxLine;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system,
      messages: messages.length ? messages : [{ role: 'user', content: 'Introduce how you can help with this return.' }],
    });

    const textBlock = response.content.find(c => c.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    void logAiUsage({
      ...userCtx,
      clientId: null,
      feature: 'tax_studio',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return NextResponse.json({ reply: text || 'No response.' });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/tax-studio/assistant]', err);
    return NextResponse.json({ error: 'The assistant is unavailable right now. Please try again.' }, { status: 500 });
  }
}
