import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildRankApplicantsPrompt } from '@/prompts/staff-hire';
import { logAiUsage } from '@/lib/driveUpload';
import { createClient } from '@/lib/supabase-server';
import type { JobPosting, JobApplicant } from '@/types';

type RouteParams = { params: Promise<{ jobId: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const supabase = createClient();

    const [jobRes, applicantsRes] = await Promise.all([
      supabase.from('job_postings').select('*').eq('id', jobId).eq('firm_id', ctx.firmId).single(),
      supabase.from('job_applicants').select('*').eq('job_id', jobId).eq('firm_id', ctx.firmId).neq('stage', 'rejected'),
    ]);

    if (!jobRes.data) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    const applicants = (applicantsRes.data ?? []) as JobApplicant[];

    if (applicants.length < 2) {
      return NextResponse.json({ error: 'At least 2 applicants are required to generate a ranking' }, { status: 400 });
    }

    const unevaluated = applicants.filter(a => !a.ai_evaluation);
    if (unevaluated.length > 0) {
      return NextResponse.json({
        error: `${unevaluated.length} applicant${unevaluated.length !== 1 ? 's' : ''} have not been evaluated yet. Please evaluate all applicants before ranking.`,
      }, { status: 400 });
    }

    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const prompt = buildRankApplicantsPrompt(
      jobRes.data as JobPosting,
      applicants.map(a => ({
        id: a.id,
        name: a.full_name,
        score: a.ai_score,
        summary: a.ai_summary,
        evaluation: a.ai_evaluation,
      }))
    );

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are a senior HR director. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') throw new Error('No response');

    let json = text.text.trim();
    if (json.startsWith('```json')) json = json.slice(7).trim();
    if (json.startsWith('```')) json = json.slice(3).trim();
    if (json.endsWith('```')) json = json.slice(0, -3).trim();

    const result = JSON.parse(json) as {
      rankings: Array<{ applicantId: string; rank: number; overallScore: number; hiringRecommendation: string; comparativeSummary: string }>;
      overallRecommendation: string;
    };

    // Save ranking positions back to applicants
    await Promise.all(
      result.rankings.map(r =>
        supabase
          .from('job_applicants')
          .update({ ranking_position: r.rank })
          .eq('id', r.applicantId)
          .eq('firm_id', ctx.firmId)
      )
    );

    void logAiUsage({ ...ctx, clientId: null, feature: 'staff_hire_rank', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    return NextResponse.json({ rankings: result.rankings, overallRecommendation: result.overallRecommendation });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError)
      return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[POST /api/staff-hire/jobs/[jobId]/rank]', err);
    return NextResponse.json({ error: 'Failed to rank applicants' }, { status: 500 });
  }
}
