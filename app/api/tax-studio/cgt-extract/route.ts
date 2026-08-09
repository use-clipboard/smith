import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';
import { buildCgtExtractPrompt } from '@/prompts/tax-studio-cgt-extract';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const FileSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  base64: z.string().optional(),
  text: z.string().optional(),
}).refine(f => (f.base64 && f.base64.length > 0) || (f.text && f.text.length > 0), { message: 'File must include base64 or text' });

const BodySchema = z.object({ taxYear: z.string(), files: z.array(FileSchema).min(1).max(12) });

function parseJsonResponse(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  return JSON.parse(s);
}

// POST /api/tax-studio/cgt-extract — read documents and return the capital
// disposals (+ set-aside + needs) for the CGT calculator. Nothing is persisted.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const fileBlocks = body.files.map(f =>
      f.text != null && f.text.length > 0
        ? { type: 'text' as const, text: `Document "${f.name}":\n\n${f.text}` }
        : f.mimeType === 'application/pdf'
          ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 ?? '' } }
          : { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 ?? '' } },
    );

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are an expert UK Capital Gains Tax accountant. Always respond with valid JSON only — no prose, no code fences.',
      messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: buildCgtExtractPrompt(body.taxYear) }] }],
    });

    const textPart = response.content.find(c => c.type === 'text');
    if (!textPart || textPart.type !== 'text') return NextResponse.json({ error: 'No response from AI.' }, { status: 502 });

    let extraction: unknown;
    try { extraction = parseJsonResponse(textPart.text); }
    catch { return NextResponse.json({ error: 'Could not read the documents — please try again or enter the disposals manually.' }, { status: 502 }); }

    void logAiUsage({ ...ctx, clientId: null, feature: 'tax_studio', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    return NextResponse.json({ extraction });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[/api/tax-studio/cgt-extract]', err);
    return NextResponse.json({ error: 'Could not read the documents. Please try again.' }, { status: 502 });
  }
}
