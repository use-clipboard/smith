import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildInterviewQuestionsPrompt } from '@/prompts/staff-hire';
import { logAiUsage } from '@/lib/driveUpload';
import { createClient } from '@/lib/supabase-server';
import type { JobPosting } from '@/types';

const FileSchema = z.object({ name: z.string(), mimeType: z.string(), base64: z.string() });

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  applicantId: z.string().uuid(),
  applicantName: z.string(),
  files: z.array(FileSchema),
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
    const prompt = buildInterviewQuestionsPrompt(job as JobPosting, parsed.data.applicantName);

    const fileContent = parsed.data.files.map(f => {
      if (f.mimeType === 'application/pdf')
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: f.base64 } };
    });

    const messages = parsed.data.files.length > 0
      ? [{ role: 'user' as const, content: [...fileContent, { type: 'text' as const, text: prompt }] }]
      : [{ role: 'user' as const, content: prompt }];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are a senior accountancy practice manager. Always respond with valid JSON only.',
      messages,
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') throw new Error('No response');

    let json = text.text.trim();
    if (json.startsWith('```json')) json = json.slice(7).trim();
    if (json.startsWith('```')) json = json.slice(3).trim();
    if (json.endsWith('```')) json = json.slice(0, -3).trim();

    const result = JSON.parse(json) as { questions: unknown[] };

    // Save to database
    const { data: saved } = await supabase
      .from('applicant_questions')
      .insert({
        applicant_id: parsed.data.applicantId,
        job_id: parsed.data.jobId,
        firm_id: ctx.firmId,
        questions: result.questions,
      })
      .select()
      .single();

    void logAiUsage({ ...ctx, clientId: null, feature: 'staff_hire_questions', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    return NextResponse.json({ questions: result.questions, id: saved?.id });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError)
      return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[POST /api/staff-hire/questions]', err);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}
