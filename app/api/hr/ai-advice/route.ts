import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { EDUCATIONAL_HR_PROMPT, DRAFTING_HR_PROMPT } from '@/prompts/hr-advice';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const RequestSchema = z.object({
  mode: z.enum(['educational', 'drafting']).default('educational'),
  messages: z.array(MessageSchema).min(1),
});

// POST /api/hr/ai-advice — streams Claude's reply for the HR adviser chat.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('hr')) return moduleNotActive('hr');

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const system = parsed.data.mode === 'drafting' ? DRAFTING_HR_PROMPT : EDUCATIONAL_HR_PROMPT;

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      messages: parsed.data.messages as Anthropic.Messages.MessageParam[],
    });

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new NextResponse(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked' },
    });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/hr/ai-advice]', err);
    return NextResponse.json({ error: 'Failed. Please try again.' }, { status: 500 });
  }
}
