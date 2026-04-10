import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildBankToCsvPrompt } from '@/prompts/bank-to-csv';
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
    const validation = RequestSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { files, clientId, clientCode, saveToDrive } = validation.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('bank-to-csv')) return moduleNotActive('bank-to-csv');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);
    const prompt = buildBankToCsvPrompt();

    const fileContent = files.map(f => {
      if (f.mimeType === 'application/pdf') {
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      }
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } };
    });

    // Use streaming to support large bank statements without SDK timeout restrictions
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      system: 'You are an expert UK bookkeeper. Always respond with valid JSON only. Output every single transaction — do not summarise or skip any.',
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    });
    const response = await stream.finalMessage();

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response from AI' }, { status: 500 });

    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

    // If response was cut off, salvage all complete transactions from the partial JSON
    let truncated = false;
    if (response.stop_reason === 'max_tokens') {
      console.warn('[/api/bank-to-csv] Response truncated — salvaging partial results');
      truncated = true;
      const lastComplete = jsonText.lastIndexOf('},');
      if (lastComplete !== -1) {
        jsonText = jsonText.substring(0, lastComplete + 1) + ']}';
      } else {
        jsonText = '{"transactions":[]}';
      }
    }

    if (userCtx) {
      if (saveToDrive && clientCode) {
        void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'bank_to_csv' });
        void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'bank_to_csv', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
      }
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'bank_to_csv', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'bank_to_csv' });
    }

    const result = JSON.parse(jsonText);
    return NextResponse.json({ ...result, truncated });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/bank-to-csv]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
