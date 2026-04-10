import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildP32Prompt } from '@/prompts/p32';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { uploadDocumentsToDrive, logAiUsage, saveOutput, saveDocumentsToVault } from '@/lib/driveUpload';

const FileSchema = z.object({ name: z.string(), mimeType: z.string(), base64: z.string() });

const RequestSchema = z.object({
  files: z.array(FileSchema),
  clientId: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  saveToDrive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { files, clientId, clientCode, saveToDrive } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('p32')) return moduleNotActive('p32');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);
    const prompt = buildP32Prompt();

    const fileContent = files.map(f => {
      if (f.mimeType === 'application/pdf') {
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      }
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } };
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are an expert UK payroll administrator. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 });
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

    if (userCtx) {
      if (saveToDrive && clientCode) {
        void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'p32_summary' });
        void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'p32_summary', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
      }
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'p32_summary', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'p32_summary' });
    }

    return NextResponse.json(JSON.parse(jsonText));
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/p32]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
