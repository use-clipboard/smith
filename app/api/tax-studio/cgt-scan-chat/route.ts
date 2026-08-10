import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';
import { buildCgtScanChatSystem } from '@/prompts/tax-studio-cgt-scan-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  taxYear: z.string(),
  documents: z.array(z.object({ docType: z.string(), summary: z.string() })).default([]),
  disposals: z.array(z.object({ description: z.string(), assetClass: z.string(), proceeds: z.number(), gain: z.number() })).default([]),
  needs: z.array(z.string()).default([]),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1).max(40),
});

// Brace-balanced JSON extraction (tolerant of a prose prefix / code fences).
function parseJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf('{');
  if (start === -1) throw new Error('no JSON object in response');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('unterminated JSON object in response');
}

// POST /api/tax-studio/cgt-scan-chat — one turn of the CGT scanner relief chat.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const system = buildCgtScanChatSystem({ taxYear: body.taxYear, documents: body.documents, disposals: body.disposals, needs: body.needs });
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
    console.error('[/api/tax-studio/cgt-scan-chat]', err);
    return NextResponse.json({ error: 'SMITH is unavailable right now. Please try again.' }, { status: 502 });
  }
}
