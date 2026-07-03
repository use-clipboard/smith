import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { logAiUsage } from '@/lib/driveUpload';

export const maxDuration = 60;

const ContextSchema = z.object({
  companyName: z.string().default(''),
  entityType: z.string().default(''),
  framework: z.string().default(''),
  periodEnd: z.string().default(''),
});

const RequestSchema = z.object({
  mode: z.enum(['chat', 'rewrite', 'explain']),
  context: ContextSchema,
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(12).optional(),
  section: z.object({
    title: z.string(),
    requirement: z.string().default(''),
    content: z.string().default(''),
  }).optional(),
});

const BASE_SYSTEM = `You are SMITH, an expert assistant for a UK accountancy firm, embedded inside the Accounts Studio statutory accounts production tool.

Your remit is the PRODUCTION of statutory accounts and UK accounting standards: FRS 102 (including Section 1A), FRS 105, the Companies Act 2006, the Charities SORP, the LLP SORP, disclosure requirements, iXBRL and Companies House filing.

You do NOT perform analytical review, risk identification, suggested journals, or balance-sheet investigation — that is handled by the separate Accounts Review module. If asked to do those, briefly redirect the user to Accounts Review.

Be precise, practical and concise. Use British English and UK accounting terminology.`;

export async function POST(req: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { mode, context, messages, section } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('accounts-studio')) return moduleNotActive('accounts-studio');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    const ctxLine = `Engagement context — Company: ${context.companyName || 'n/a'}; Entity: ${context.entityType || 'n/a'}; Framework: ${context.framework || 'n/a'}; Year end: ${context.periodEnd || 'n/a'}.`;

    let system = BASE_SYSTEM + '\n\n' + ctxLine;
    let apiMessages: { role: 'user' | 'assistant'; content: string }[];
    let maxTokens = 1024;

    if (mode === 'chat') {
      apiMessages = (messages && messages.length > 0) ? messages : [{ role: 'user', content: 'Introduce how you can help with these accounts.' }];
      maxTokens = 1200;
    } else if (mode === 'explain') {
      const s = section;
      system += `\n\nThe user wants to understand a disclosure requirement. Explain, in 2–4 short sentences, WHY the "${s?.title}" disclosure is required for this entity under the applicable framework, and what must be included. Do not rewrite the disclosure — just explain the requirement.`;
      apiMessages = [{ role: 'user', content: `Disclosure: ${s?.title}\nRequirement summary: ${s?.requirement}\n\nExplain why this is required and what it must contain.` }];
      maxTokens = 500;
    } else {
      // rewrite
      const s = section;
      system += `\n\nRewrite the disclosure note below so it is clear, compliant and professionally worded for inclusion in the statutory accounts. Keep any specific figures the user has already entered. Return ONLY the disclosure text as clean HTML using <h3> for the note heading and <p> paragraphs (and <ul>/<li> if a list is appropriate). Do not include any preamble, explanation, or markdown fences.`;
      apiMessages = [{ role: 'user', content: `Note: ${s?.title}\nRequirement: ${s?.requirement}\nCurrent draft:\n${s?.content || '(no existing draft — write a first draft)'}` }];
      maxTokens = 1200;
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: apiMessages,
    });

    const textBlock = response.content.find(c => c.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    void logAiUsage({
      ...userCtx,
      clientId: null,
      feature: 'accounts_studio',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (mode === 'rewrite') {
      let html = text;
      if (html.startsWith('```html')) html = html.slice(7).trim();
      if (html.startsWith('```')) html = html.slice(3).trim();
      if (html.endsWith('```')) html = html.slice(0, -3).trim();
      return NextResponse.json({ html, reply: html });
    }

    return NextResponse.json({ reply: text || 'No response.' });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/accounts-studio/assistant]', err);
    return NextResponse.json({ error: 'The assistant is unavailable right now. Please try again.' }, { status: 500 });
  }
}
