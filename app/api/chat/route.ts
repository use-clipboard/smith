import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';
import { ASK_SMITH_SYSTEM_PROMPT } from '@/prompts/ask-smith';
import { READ_ONLY_AGENT_TOOLS, runTool, type ToolResult } from '@/lib/agent/tools';

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

// Hard cap on the agentic loop — Ask Smith should never need this many
// hops; we ride higher than expected just to be safe with chained lookups.
const MAX_TURNS = 8;

function buildUserBlocks(text: string, attachments?: Attachment[]): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
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
    const supabase = createClient();

    // Convert the wire-format messages into Anthropic content blocks. User
    // turns may carry PDF/image attachments which we encode as content
    // blocks; assistant turns are plain text.
    const conversation: Anthropic.Messages.MessageParam[] = parsed.data.messages.map(msg => {
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        return { role: 'user' as const, content: buildUserBlocks(msg.content, msg.attachments) };
      }
      return { role: msg.role, content: msg.content };
    });

    const toolCtx = { supabase, firmId: userCtx.firmId, userId: userCtx.userId, userRole: userCtx.userRole };

    // Stream the FINAL assistant text only — the bubble UI consumes a
    // plain-text stream and doesn't know about tool calls. We still run an
    // agentic loop server-side: the model can issue read-only tool calls,
    // we execute them, feed the results back, and only stream the user-
    // facing reply that comes after all tool turns have settled. This
    // keeps every user (admin or staff) able to ask data questions
    // ("what's the year end for X?", "how many limited-company year-end
    // tasks are still open?") without any write capability.
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for (let turn = 0; turn < MAX_TURNS; turn++) {
            const isLastAllowedTurn = turn === MAX_TURNS - 1;
            const useStream = !isLastAllowedTurn; // safety: don't stream if we might still need another tool turn
            // We run unstreamed turns while there might be tool calls so we
            // can inspect the full response. Once the model stops asking
            // for tools we re-run the final reply in streaming mode so the
            // user sees it appear progressively.

            // Non-streaming probe to see if there are tool calls.
            const probe = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              system: ASK_SMITH_SYSTEM_PROMPT,
              tools: READ_ONLY_AGENT_TOOLS,
              messages: conversation,
            });

            const toolUses = probe.content.filter(b => b.type === 'tool_use') as Anthropic.Messages.ToolUseBlock[];

            if (toolUses.length === 0) {
              // No more tool calls — emit the assistant's text and stop.
              for (const block of probe.content) {
                if (block.type === 'text') {
                  controller.enqueue(encoder.encode(block.text));
                }
              }
              break;
            }

            // Persist the assistant turn (tool_use blocks must stay in the
            // transcript so the matching tool_result blocks reference real
            // ids in the next user turn).
            conversation.push({ role: 'assistant', content: probe.content });

            // Execute each requested tool and feed the results back.
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const tu of toolUses) {
              let result: ToolResult;
              try {
                result = await runTool(tu.name, tu.input, toolCtx);
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Tool failed';
                result = { forModel: { error: msg } };
              }
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: JSON.stringify(result.forModel),
              });
            }
            conversation.push({ role: 'user', content: toolResults });

            if (useStream) continue;
            // Out of tool turns — break and let the final loop emit text.
            // (Reached only when MAX_TURNS is exhausted.)
            controller.enqueue(encoder.encode(
              "I've gathered some data but ran out of search steps before composing a full answer. Try narrowing the question and asking again.",
            ));
            break;
          }
        } catch (err) {
          console.error('[/api/chat] tool loop', err);
          controller.enqueue(encoder.encode('Sorry, something went wrong looking that up. Please try again.'));
        } finally {
          controller.close();
        }
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
