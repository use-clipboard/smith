import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildGeneratePostingPrompt } from '@/prompts/staff-hire';
import { logAiUsage } from '@/lib/driveUpload';

const RequestSchema = z.object({
  job: z.object({
    title: z.string(),
    employment_type: z.enum(['full_time', 'part_time', 'contract']).optional(),
    location_type: z.enum(['in_office', 'remote', 'hybrid']).optional(),
    location: z.string().nullable().optional(),
    salary_from: z.number().nullable().optional(),
    salary_to: z.number().nullable().optional(),
    salary_display: z.string().nullable().optional(),
    benefits: z.string().nullable().optional(),
    experience_years_min: z.number().nullable().optional(),
    requirements: z.array(z.object({
      label: z.string(),
      category: z.string(),
      mandatory: z.boolean(),
      notes: z.string().optional(),
    })).default([]),
    description: z.string().nullable().optional(),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const prompt = buildGeneratePostingPrompt(parsed.data.job);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are an expert HR copywriter. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') throw new Error('No response content');

    let json = text.text.trim();
    if (json.startsWith('```json')) json = json.slice(7).trim();
    if (json.startsWith('```')) json = json.slice(3).trim();
    if (json.endsWith('```')) json = json.slice(0, -3).trim();

    const result = JSON.parse(json) as { posting: string };

    void logAiUsage({ ...ctx, clientId: null, feature: 'staff_hire_generate_posting', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    return NextResponse.json({ posting: result.posting });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError)
      return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[POST /api/staff-hire/generate-posting]', err);
    return NextResponse.json({ error: 'Failed to generate job posting' }, { status: 500 });
  }
}
