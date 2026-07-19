import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';

export const maxDuration = 60;

const Schema = z.object({
  mode: z.enum(['full', 'rewrite', 'subject', 'shorten', 'expand', 'adjust_tone']).default('full'),
  prompt: z.string().max(4000).optional().default(''),
  tone: z.string().max(60).optional().default('professional'),
  currentBody: z.string().max(20000).optional().default(''),
  selection: z.string().max(8000).optional().default(''),
});

const SYSTEM = `You are a copywriter for a UK accountancy firm, writing client communications (newsletters, tax reminders, deadline notices, record requests).
Rules:
- Plain, warm, professional British English. No hype, no emoji unless clearly appropriate.
- You may personalise using merge tags in double braces with a fallback, e.g. {{client.first_name | default: "there"}}, {{client.business_name}}, {{company.confirmation_statement_due}}, {{billing.balance_outstanding}}. Only use tags that make sense; never invent tag names.
- NEVER invent specific tax figures, thresholds, rates or deadlines. If a specific date/number is needed, use a merge tag or a clear placeholder like [DATE] for the sender to fill in.
- Body must be simple, email-safe HTML: <p>, <ul>/<li>, <strong>, <a href>. No <style>, <script>, <head> or full-document tags. Keep paragraphs short.`;

export async function POST(req: NextRequest) {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { mode, prompt, tone, currentBody, selection } = parsed.data;

  let instruction: string;
  let expectJson = false;
  switch (mode) {
    case 'full':
      expectJson = true;
      instruction = `Write a complete campaign email in a ${tone} tone. Brief: "${prompt}".\nReturn ONLY valid JSON (no markdown, no code fences): {"subject": string, "previewText": string, "bodyHtml": string}. previewText is the inbox preview line (max ~90 chars).`;
      break;
    case 'subject':
      expectJson = true;
      instruction = `Suggest 5 subject lines (${tone} tone) for this email. Brief: "${prompt}". Body so far:\n${currentBody.slice(0, 4000)}\nReturn ONLY valid JSON: {"subjects": string[]}.`;
      break;
    case 'rewrite':
      instruction = `Rewrite the following passage in a ${tone} tone${prompt ? `, taking this into account: "${prompt}"` : ''}. Return ONLY the rewritten HTML passage, nothing else.\n---\n${selection || currentBody}`;
      break;
    case 'shorten':
      instruction = `Make the following email noticeably more concise while keeping the meaning and any merge tags. Return ONLY the HTML.\n---\n${selection || currentBody}`;
      break;
    case 'expand':
      instruction = `Expand the following email with a little more helpful detail, keeping a ${tone} tone and any merge tags. Return ONLY the HTML.\n---\n${selection || currentBody}`;
      break;
    case 'adjust_tone':
    default:
      instruction = `Rewrite the following email in a ${tone} tone, keeping all merge tags. Return ONLY the HTML.\n---\n${selection || currentBody}`;
      break;
  }

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: instruction }],
    });
    const text = message.content[0]?.type === 'text' ? message.content[0].text : '';

    if (expectJson) {
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); }
      catch { const m = text.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : {}; }
      return NextResponse.json(data);
    }
    // Strip any accidental code fences from a plain-HTML response.
    const html = text.replace(/^```html?\s*/i, '').replace(/```\s*$/i, '').trim();
    return NextResponse.json({ html });
  } catch (err) {
    console.error('[campaigns/ai/generate]', err);
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 });
  }
}
