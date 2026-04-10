import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildPerformancePrompt } from '@/prompts/performance';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { uploadDocumentsToDrive, logAiUsage, saveOutput, saveDocumentsToVault } from '@/lib/driveUpload';

// Allow up to 5 minutes — the performance report is a long generation task
export const maxDuration = 300;

const FileSchema = z.object({ name: z.string(), mimeType: z.string(), base64: z.string() });

const RequestSchema = z.object({
  paBusinessName: z.string(),
  paBusinessType: z.string(),
  paBusinessTrade: z.string(),
  paTradingLocation: z.string().default(''),
  paRelevantInfo: z.string().default(''),
  paAnalysisPeriod: z.string(),
  paAnalysisPeriodDescription: z.string().default(''),
  selectedSections: z.array(z.string()).default([]),
  clientId: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  saveToDrive: z.boolean().optional(),
  files: z.array(FileSchema),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { files, clientId, clientCode, saveToDrive, paBusinessName, selectedSections, ...opts } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('performance')) return moduleNotActive('performance');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);
    const prompt = buildPerformancePrompt({ paBusinessName, selectedSections, ...opts });

    const fileContent = files.map(f => {
      if (f.mimeType === 'application/pdf') {
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      }
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } };
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: `You are a world-class UK business analyst.
CRITICAL: You must respond with a single valid JSON object. The JSON must be parseable by JSON.parse().
When embedding HTML inside a JSON string value you MUST escape all double-quotes as \\" and all backslashes as \\\\.
Do not use unescaped newlines inside JSON string values — use \\n instead.
Do not add any text before or after the JSON object.`,
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    }, {
      headers: { 'anthropic-beta': 'output-128k-2025-02-19' },
    });

    if (response.stop_reason === 'max_tokens') {
      console.error('[/api/performance] response truncated at max_tokens');
      return NextResponse.json({ error: 'The report was too large to generate in one pass. Try uploading fewer files, or reduce the number of prior period documents.' }, { status: 500 });
    }

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response from AI. Please try again.' }, { status: 500 });
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

    let reportData: { reportHtml?: string; chartDataJson?: string };
    try {
      reportData = JSON.parse(jsonText) as { reportHtml?: string; chartDataJson?: string };
    } catch (parseErr) {
      console.error('[/api/performance] JSON.parse failed, attempting regex extraction. Error:', parseErr);
      console.error('[/api/performance] First 500 chars of response:', jsonText.slice(0, 500));

      // Fallback: extract reportHtml by finding the value between "reportHtml": " ... "
      // Use a regex that captures everything between the first "reportHtml":" and the matching close
      const htmlMatch = jsonText.match(/"reportHtml"\s*:\s*"([\s\S]*)"\s*(?:,\s*"chartDataJson"|}\s*$)/);
      if (htmlMatch?.[1]) {
        // Unescape JSON string escapes
        let extracted = htmlMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        console.log('[/api/performance] Regex extraction succeeded, html length:', extracted.length);
        reportData = { reportHtml: extracted, chartDataJson: '[]' };
      } else {
        // Last resort: if the response itself looks like raw HTML, use it directly
        if (jsonText.includes('<h') || jsonText.includes('<p>') || jsonText.includes('<div')) {
          console.log('[/api/performance] Response appears to be raw HTML, using directly');
          reportData = { reportHtml: jsonText, chartDataJson: '[]' };
        } else {
          return NextResponse.json({ error: 'The AI response could not be read. Please try again.' }, { status: 500 });
        }
      }
    }

    if (!reportData.reportHtml) {
      return NextResponse.json({ error: 'No report was returned by the AI. Please try again.' }, { status: 500 });
    }

    if (userCtx) {
      if (saveToDrive && clientCode) {
        void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'performance_analysis' });
        void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'performance_analysis', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
      }
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'performance_analysis', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'performance_analysis' });
    }

    return NextResponse.json(reportData);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/performance]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
