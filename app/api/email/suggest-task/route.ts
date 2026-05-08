import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';
import { createClient } from '@/lib/supabase-server';

const Schema = z.object({
  subject:   z.string(),
  body:      z.string(),
  fromEmail: z.string().optional().default(''),
  fromName:  z.string().optional().default(''),
});

interface SuggestTaskResult {
  title: string;
  steps: string[];
  dueDate: string | null;
}

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

  const { subject, body, fromEmail, fromName } = parsed.data;

  // ── Look up client by sender email ─────────────────────────────────────────
  const supabase = await createClient();
  let clientId: string | null = null;
  let clientName: string | null = null;

  if (fromEmail) {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, name')
      .eq('firm_id', ctx.firmId)
      .ilike('contact_email', fromEmail.trim())
      .maybeSingle();

    if (clientRow) {
      clientId   = clientRow.id as string;
      clientName = clientRow.name as string;
    }
  }

  // ── Ask Claude for task suggestions ────────────────────────────────────────
  const anthropic = await getAnthropicForFirm(ctx.firmId);

  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are an assistant helping a UK accountancy firm create tasks from emails.
Given an email, extract or infer:
1. A concise task title (≤ 10 words)
2. Up to 5 clear, actionable steps needed to complete this task (each ≤ 12 words). Return fewer steps if the task is simple.
3. A suggested due date if the email implies a deadline (return as YYYY-MM-DD, or null if not implied).

Today's date is ${today}.
Return ONLY valid JSON — no markdown, no explanation — matching this exact shape:
{"title":"...","steps":["...","..."],"dueDate":"YYYY-MM-DD or null"}`;

  const userPrompt = `Email subject: ${subject}
${fromName ? `From: ${fromName} <${fromEmail}>` : fromEmail ? `From: ${fromEmail}` : ''}

Email body:
${body.slice(0, 3000)}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '{}';

    let suggestion: SuggestTaskResult = { title: subject, steps: [], dueDate: null };
    try {
      // Strip any accidental markdown fences
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(clean) as Partial<SuggestTaskResult>;
      suggestion = {
        title:   typeof parsed.title   === 'string'  ? parsed.title                        : subject,
        steps:   Array.isArray(parsed.steps)          ? parsed.steps.filter(s => typeof s === 'string') : [],
        dueDate: typeof parsed.dueDate === 'string' && parsed.dueDate !== 'null' ? parsed.dueDate : null,
      };
    } catch {
      // Fall back to email subject as title
    }

    return NextResponse.json({ ...suggestion, clientId, clientName });
  } catch (err) {
    console.error('Task suggestion error:', err);
    // Return a graceful fallback so the UI can still open with partial data
    return NextResponse.json({
      title: subject,
      steps: [],
      dueDate: null,
      clientId,
      clientName,
    });
  }
}
