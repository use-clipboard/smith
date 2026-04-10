import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { ASK_SMITH_SYSTEM_PROMPT } from '@/prompts/ask-smith';

const AttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  attachments: z.array(AttachmentSchema).optional(),
});

const RequestSchema = z.object({
  messages: z.array(MessageSchema),
});

type Attachment = z.infer<typeof AttachmentSchema>;

function buildContentBlocks(text: string, attachments?: Attachment[]): Anthropic.Messages.MessageParam['content'] {
  const blocks: Anthropic.Messages.MessageParam['content'] = [];

  if (attachments && attachments.length > 0) {
    for (const file of attachments) {
      if (file.mimeType === 'application/pdf') {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file.base64 },
        });
      } else if (file.mimeType.startsWith('image/')) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: file.base64,
          },
        });
      }
    }
  }

  blocks.push({ type: 'text', text });
  return blocks;
}

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    const anthropicMessages = parsed.data.messages.map(msg => ({
      role: msg.role,
      content: msg.attachments && msg.attachments.length > 0 && msg.role === 'user'
        ? buildContentBlocks(msg.content, msg.attachments)
        : msg.content,
    }));

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: ASK_SMITH_SYSTEM_PROMPT,
      messages: anthropicMessages as Anthropic.Messages.MessageParam[],
    });

    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new NextResponse(readableStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked' },
    });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/chat]', err);
    return NextResponse.json({ error: 'Chat failed. Please try again.' }, { status: 500 });
  }
}
