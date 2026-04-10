import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildRiskAssessmentPrompt } from '@/prompts/risk-assessment';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { logAiUsage, saveOutput } from '@/lib/driveUpload';

const RequestSchema = z.object({
  raUsersName: z.string().default(''),
  raClientName: z.string().default(''),
  raClientCode: z.string().default(''),
  raClientType: z.string().default(''),
  clientId: z.string().nullable().optional(),
  answersText: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { clientId, ...rest } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('risk-assessment')) return moduleNotActive('risk-assessment');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);
    const prompt = buildRiskAssessmentPrompt(rest);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are a compliance officer for a UK accountancy firm. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 });
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

    if (userCtx) {
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'risk_assessment', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'risk_assessment' });
    }

    return NextResponse.json(JSON.parse(jsonText));
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/risk-assessment]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
