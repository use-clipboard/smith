import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const { subject, body, myName, mode } = await req.json() as {
    subject: string;
    body: string;
    myName: string;
    mode: 'rewrite' | 'recommend';
  };

  const anthropic = await getAnthropicForFirm(ctx.firmId);

  const systemPrompt = `You are an expert email writer for a UK accountancy firm.
Write professional, clear, concise emails suitable for client and business communication.
Return ONLY the email body content — no subject line, no "Dear X" unless explicitly included, no explanation.
Use British English spelling. Format output as plain HTML paragraphs (just <p> tags, no full HTML document).`;

  let userPrompt = '';

  if (mode === 'recommend') {
    const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
    userPrompt = `Draft a professional reply to the following email.

Subject: ${subject}
Email content:
${plainBody}

The reply is from: ${myName}

Write a complete, professional reply. Be concise and helpful.`;
  } else {
    const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
    userPrompt = `Rewrite the following email draft to be more professional, clear, and concise.
Keep the same intent and key points but improve the writing quality.

Subject: ${subject || '(no subject)'}
Current draft:
${plainBody}

Return the improved email body only.`;
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    return NextResponse.json({ result: text });
  } catch (err) {
    console.error('Email rewrite error:', err);
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 });
  }
}
