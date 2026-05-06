import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';

const SuggestSchema = z.object({
  subject: z.string(),
  threadSummary: z.string(), // last few messages as text
  senderName: z.string().optional().default(''),
  senderEmail: z.string().optional().default(''),
  myName: z.string().optional().default(''),
  myEmail: z.string().optional().default(''),
  clientContext: z.string().optional().default(''),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = SuggestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { subject, threadSummary, senderName, myName, clientContext } = parsed.data;

  const anthropic = await getAnthropicForFirm(ctx.firmId);

  const systemPrompt = `You are an assistant helping a UK accountancy firm professional reply to emails.
Write professional, clear, and concise email replies. Use a formal but friendly tone appropriate for an accountancy practice.
Address the recipient by first name if known. Sign off naturally.
Return ONLY the email body as plain text (no subject line, no "Subject:" prefix). Include paragraph breaks.`;

  const userPrompt = `Please suggest a reply to the following email thread.

Subject: ${subject}
${clientContext ? `Client context: ${clientContext}` : ''}
${myName ? `My name: ${myName}` : ''}
${senderName ? `Sender: ${senderName}` : ''}

--- Email thread (most recent at bottom) ---
${threadSummary}
---

Write a professional reply.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error('AI reply suggestion error:', err);
    return NextResponse.json({ error: 'Failed to generate reply suggestion' }, { status: 500 });
  }
}
