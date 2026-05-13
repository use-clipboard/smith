import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';
import { AGENT_SMITH_SYSTEM_PROMPT } from '@/prompts/agent-smith';
import { AGENT_TOOLS, runTool, type ToolResult } from '@/lib/agent/tools';

const MAX_TURNS = 10; // hard cap on agentic loop iterations per request

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const RequestSchema = z.object({
  messages: z.array(MessageSchema),
});

interface UsageRecord {
  input: number;
  output: number;
}

async function checkBudget(supabase: ReturnType<typeof createClient>, firmId: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('firm_id', firmId)
    .maybeSingle();

  if (settings && settings.enabled === false) {
    return { ok: false, reason: 'Agent Smith is disabled for this firm. Re-enable it in Settings → Agent Smith.' };
  }

  if (!settings) {
    // Seed defaults
    await supabase.from('agent_settings').insert({ firm_id: firmId });
    return { ok: true };
  }

  // Reset window if past 24h
  const windowStart = new Date(settings.usage_window_started_at).getTime();
  if (Date.now() - windowStart > 24 * 60 * 60_000) {
    await supabase.from('agent_settings').update({
      usage_input_tokens: 0, usage_output_tokens: 0, usage_window_started_at: new Date().toISOString(),
    }).eq('firm_id', firmId);
    return { ok: true };
  }

  if (settings.usage_input_tokens >= settings.daily_input_token_cap) {
    return { ok: false, reason: 'Daily input token budget reached. Try again later or raise the limit in Settings → Agent Smith.' };
  }
  if (settings.usage_output_tokens >= settings.daily_output_token_cap) {
    return { ok: false, reason: 'Daily output token budget reached.' };
  }
  return { ok: true };
}

async function recordUsage(supabase: ReturnType<typeof createClient>, firmId: string, usage: UsageRecord) {
  // Note: lacking Supabase RPC for increments, fall back to read-modify-write.
  const { data: row } = await supabase.from('agent_settings').select('usage_input_tokens, usage_output_tokens').eq('firm_id', firmId).maybeSingle();
  await supabase.from('agent_settings').update({
    usage_input_tokens:  (row?.usage_input_tokens  ?? 0) + usage.input,
    usage_output_tokens: (row?.usage_output_tokens ?? 0) + usage.output,
    updated_at: new Date().toISOString(),
  }).eq('firm_id', firmId);
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Agent Smith is admin-only.' }, { status: 403 });

  const supabase = createClient();
  const budget = await checkBudget(supabase, ctx.firmId);
  if (!budget.ok) return NextResponse.json({ error: budget.reason }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  let anthropic: Anthropic;
  try { anthropic = await getAnthropicForFirm(ctx.firmId); }
  catch (e) {
    if (e instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: 'Anthropic API key not configured for this firm.' }, { status: 400 });
    throw e;
  }

  // Build initial message list. The model receives multi-turn user/assistant
  // messages plus tool_use/tool_result pairs as it runs.
  const conversation: Anthropic.Messages.MessageParam[] = parsed.data.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Use server-sent events so the client can update the preview pane in
  // real time as tools run. Each event is a JSON object on a `data:` line.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      const toolCtx = { supabase, firmId: ctx.firmId, userId: ctx.userId, userRole: ctx.userRole };
      const usage: UsageRecord = { input: 0, output: 0 };

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: AGENT_SMITH_SYSTEM_PROMPT,
            tools: AGENT_TOOLS,
            messages: conversation,
          });
          usage.input  += response.usage.input_tokens;
          usage.output += response.usage.output_tokens;

          // Surface any assistant text immediately
          const assistantBlocks = response.content;
          for (const block of assistantBlocks) {
            if (block.type === 'text') {
              send({ type: 'text', text: block.text });
            }
          }
          conversation.push({ role: 'assistant', content: assistantBlocks });

          // If no tool calls, we're done
          const toolUses = assistantBlocks.filter(b => b.type === 'tool_use') as Anthropic.Messages.ToolUseBlock[];
          if (toolUses.length === 0) break;

          // Run each tool and feed results back
          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: 'tool_start', name: tu.name });
            let result: ToolResult;
            try {
              result = await runTool(tu.name, tu.input, toolCtx);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Tool failed';
              result = { forModel: { error: msg } };
            }
            if (result.uiUpdate) send({ type: 'ui', update: result.uiUpdate });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(result.forModel),
            });
            send({ type: 'tool_end', name: tu.name });
          }
          conversation.push({ role: 'user', content: toolResults });

          // Stop reason might say `end_turn` even with tools — but we already
          // peeled them off above, so check stop_reason for safety
          if (response.stop_reason === 'end_turn' && toolUses.length === 0) break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        send({ type: 'error', error: msg });
      } finally {
        await recordUsage(supabase, ctx.firmId, usage);
        send({ type: 'done', usage });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
