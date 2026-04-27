import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildEvaluateApplicantPrompt } from '@/prompts/staff-hire';
import { logAiUsage } from '@/lib/driveUpload';
import { createClient } from '@/lib/supabase-server';
import type { JobPosting } from '@/types';

const FileSchema = z.object({ name: z.string(), mimeType: z.string(), base64: z.string() });

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  applicantId: z.string().uuid(),
  files: z.array(FileSchema).min(1, 'At least one document (CV or cover letter) is required'),
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

    const supabase = createClient();
    const { data: job } = await supabase
      .from('job_postings')
      .select('*')
      .eq('id', parsed.data.jobId)
      .eq('firm_id', ctx.firmId)
      .single();
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const prompt = buildEvaluateApplicantPrompt(job as JobPosting);

    const fileContent = parsed.data.files.map(f => {
      if (f.mimeType === 'application/pdf')
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: f.base64 } };
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are a senior HR professional. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') throw new Error('No response');

    let json = text.text.trim();
    if (json.startsWith('```json')) json = json.slice(7).trim();
    if (json.startsWith('```')) json = json.slice(3).trim();
    if (json.endsWith('```')) json = json.slice(0, -3).trim();

    const evaluation = JSON.parse(json);

    // Save evaluation back to the applicant record
    await supabase
      .from('job_applicants')
      .update({
        ai_evaluation: evaluation,
        ai_score: evaluation.overallScore ?? null,
        ai_summary: evaluation.summary ?? null,
      })
      .eq('id', parsed.data.applicantId)
      .eq('firm_id', ctx.firmId);

    void logAiUsage({ ...ctx, clientId: null, feature: 'staff_hire_evaluate', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    return NextResponse.json({ evaluation });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError)
      return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[POST /api/staff-hire/evaluate]', err);
    return NextResponse.json({ error: 'Failed to evaluate applicant' }, { status: 500 });
  }
}
