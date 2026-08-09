import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';
import { buildScanChatSystem } from '@/prompts/tax-studio-scan-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  taxYear: z.string(),
  documents: z.array(z.object({ docType: z.string(), summary: z.string() })).default([]),
  proposals: z.array(z.object({ label: z.string(), amount: z.number(), dest: z.string() })).default([]),
  setAside: z.array(z.object({ label: z.string(), reason: z.string() })).default([]),
  needs: z.array(z.string()).default([]),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1).max(40),
});

function parseJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  return JSON.parse(s);
}

// POST /api/tax-studio/scan-chat — one turn of the scan-review "Ask SMITH" chat.
// Returns { reply, edits } — edits are proposed changes the user applies one-click.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const system = buildScanChatSystem({
      taxYear: body.taxYear, documents: body.documents, proposals: body.proposals, setAside: body.setAside, needs: body.needs,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: body.messages.map(m => ({ role: m.role, content: m.content })),
    });

    const textPart = response.content.find(c => c.type === 'text');
    if (!textPart || textPart.type !== 'text') return NextResponse.json({ error: 'No response from AI.' }, { status: 502 });

    let parsed: { reply?: unknown; edits?: unknown };
    try { parsed = parseJson(textPart.text) as { reply?: unknown; edits?: unknown }; }
    catch { parsed = { reply: textPart.text, edits: [] }; }

    void logAiUsage({ ...ctx, clientId: null, feature: 'tax_studio', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    return NextResponse.json({
      reply: typeof parsed.reply === 'string' ? parsed.reply : 'Sorry, I didn’t catch that — could you rephrase?',
      edits: Array.isArray(parsed.edits) ? parsed.edits : [],
    });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[/api/tax-studio/scan-chat]', err);
    return NextResponse.json({ error: 'SMITH is unavailable right now. Please try again.' }, { status: 502 });
  }
}
