import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';

// POST /api/email/ai-summary
// Summarises an email thread for a busy accountant and suggests next actions.
// Returns: { summary: string, actions: [{ label, type }] }
// `type` is constrained to actions the triage UI can actually perform.

const Schema = z.object({
  subject: z.string().default(''),
  threadText: z.string(),
  clientContext: z.string().optional().default(''),
});

const ALLOWED = ['reply', 'reply_all', 'forward', 'task', 'allocate'] as const;
type ActionType = typeof ALLOWED[number];

// Values 'fyi' and 'completed' display as 'Ad-hoc / Misc' and 'No Action
// Needed' in the UI — stored values kept for back-compat with existing rows.
const CATEGORIES = ['untriaged', 'needs_reply', 'to_do', 'waiting_client', 'documents', 'internal', 'fyi', 'completed'] as const;
type Category = typeof CATEGORIES[number];

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { subject, threadText, clientContext } = parsed.data;

  const anthropic = await getAnthropicForFirm(ctx.firmId);

  const system = `You are an assistant for a UK accountancy firm triaging client emails. Summarise an email thread for a busy accountant, classify it, and suggest the most useful next actions.
Return ONLY valid JSON (no markdown, no code fences) of exactly this shape:
{"summary": string, "category": "untriaged"|"needs_reply"|"to_do"|"waiting_client"|"documents"|"internal"|"fyi"|"completed", "actions": [{"label": string, "type": "reply"|"reply_all"|"forward"|"task"|"allocate"}]}
Rules:
- summary: 1–3 short sentences in plain text. Focus on what the sender wants and what needs doing. No greeting, no "This email...".
- category: the single best triage bucket. "needs_reply" = the latest message is from someone else and clearly wants a response. "to_do" = requires an action from us beyond a reply (do some work, file something, chase, prepare documents). "waiting_client" = we replied / are waiting on the other party. "documents" = the email is primarily about sending/receiving attachments or files. "internal" = internal correspondence between colleagues at the firm, not client-facing. "fyi" (shown as "Ad-hoc / Misc") = informational or doesn't fit any other bucket. "completed" (shown as "No Action Needed") = the thread is concluded and needs no follow-up at all. "untriaged" = unclear / can't tell.
- actions: 0–3 genuinely useful next steps, most important first. "label" is a short imperative (e.g. "Reply to Michael", "Create a task", "File to client"). "type" MUST be one of the five allowed values. Only suggest "allocate" if the email clearly relates to a client; only "task" if there's a concrete to-do.`;

  const user = `Subject: ${subject}
${clientContext ? `Allocated client: ${clientContext}\n` : ''}
--- Email thread (most recent at the bottom) ---
${threadText.slice(0, 12000)}
---`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
    let data: { summary?: string; category?: string; actions?: { label?: string; type?: string }[] };
    try {
      data = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      data = m ? JSON.parse(m[0]) : { summary: text.slice(0, 400), actions: [] };
    }

    const actions = (data.actions ?? [])
      .filter(a => a.label && ALLOWED.includes(a.type as ActionType))
      .slice(0, 3)
      .map(a => ({ label: a.label as string, type: a.type as ActionType }));

    const category: Category | null = CATEGORIES.includes(data.category as Category) ? (data.category as Category) : null;

    return NextResponse.json({ summary: (data.summary ?? '').trim(), category, actions });
  } catch (err) {
    console.error('AI summary error:', err);
    return NextResponse.json({ error: 'Failed to summarise' }, { status: 500 });
  }
}
