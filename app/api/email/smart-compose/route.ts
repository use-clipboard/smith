import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── POST /api/email/smart-compose ────────────────────────────────────────────
// Gmail-style autocomplete: given the text the user has typed up to their
// caret, return a short continuation (a few words) to show as faint ghost text
// they can accept with Tab. Kept deliberately tiny (low max_tokens) so it's
// quick and cheap — the client debounces and only calls on a typing pause.
//
// NOTE: uses claude-sonnet-4-6 (the only model configured). Pointing this at a
// Haiku-tier model later would cut latency/cost further — it's the ideal fit.

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const { context, subject, threadSummary } = await req.json().catch(() => ({})) as {
    context?: string;
    subject?: string;
    threadSummary?: string;
  };
  const typed = (context ?? '').slice(-1200);
  if (typed.trim().length < 8) return NextResponse.json({ suggestion: '' });

  let anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ suggestion: '' });
    throw err;
  }

  const systemPrompt = `You are an inline autocomplete for a UK accountancy firm's email composer (like Gmail Smart Compose).
Given the text the user has typed so far (ending exactly at their cursor), predict the immediate continuation.
Rules:
- Return ONLY the text to append at the cursor — no quotes, no explanation, no preamble.
- Keep it SHORT: at most the rest of the current sentence, ideally just the next few words (≤ 8 words).
- Continue naturally in the same tone, British English. If the text ends mid-word, finish that word.
- Include a leading space if one is needed to separate from the preceding character.
- If there is no confident, useful continuation, return an empty string.`;

  const userPrompt = `${subject ? `Email subject: ${subject}\n` : ''}${threadSummary ? `Replying to: ${threadSummary.slice(0, 800)}\n` : ''}Text typed so far (continue from the very end):
"""
${typed}
"""
Continuation:`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 24,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    let suggestion = message.content[0]?.type === 'text' ? message.content[0].text : '';
    // Strip surrounding quotes the model sometimes adds; collapse newlines.
    suggestion = suggestion.replace(/^["'`]+|["'`]+$/g, '').replace(/\n+/g, ' ');
    // Guard against the model echoing the whole sentence — keep it short.
    if (suggestion.length > 120) suggestion = suggestion.slice(0, 120);
    return NextResponse.json({ suggestion });
  } catch (err) {
    console.error('smart-compose error:', err);
    return NextResponse.json({ suggestion: '' });
  }
}
