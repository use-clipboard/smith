import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildScorecardPrompt } from '@/prompts/staff-hire';
import { logAiUsage } from '@/lib/driveUpload';
import { createClient } from '@/lib/supabase-server';
import type { JobPosting, ScorecardCriterion } from '@/types';

const GenerateScorecardSchema = z.object({
  action: z.literal('generate'),
  jobId: z.string().uuid(),
  applicantId: z.string().uuid(),
});

const SaveScorecardSchema = z.object({
  action: z.literal('save'),
  scorecardId: z.string().uuid().optional(),
  applicantId: z.string().uuid(),
  criteria: z.array(z.object({
    category: z.string(),
    criterion: z.string(),
    description: z.string(),
    weight: z.number(),
    score: z.number().nullable(),
    notes: z.string(),
  })),
  overall_score: z.number().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  interviewer_notes: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});

const RequestSchema = z.discriminatedUnion('action', [GenerateScorecardSchema, SaveScorecardSchema]);

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

    if (parsed.data.action === 'generate') {
      const { data: job } = await supabase
        .from('job_postings')
        .select('*')
        .eq('id', parsed.data.jobId)
        .eq('firm_id', ctx.firmId)
        .single();
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

      const anthropic = await getAnthropicForFirm(ctx.firmId);
      const prompt = buildScorecardPrompt(job as JobPosting);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: 'You are an HR professional. Always respond with valid JSON only.',
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content.find(c => c.type === 'text');
      if (!text || text.type !== 'text') throw new Error('No response');

      let json = text.text.trim();
      if (json.startsWith('```json')) json = json.slice(7).trim();
      if (json.startsWith('```')) json = json.slice(3).trim();
      if (json.endsWith('```')) json = json.slice(0, -3).trim();

      const result = JSON.parse(json) as { criteria: ScorecardCriterion[] };

      // Save new scorecard
      const { data: saved } = await supabase
        .from('applicant_scorecards')
        .insert({
          applicant_id: parsed.data.applicantId,
          firm_id: ctx.firmId,
          criteria: result.criteria,
        })
        .select()
        .single();

      void logAiUsage({ ...ctx, clientId: null, feature: 'staff_hire_scorecard', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

      return NextResponse.json({ scorecard: saved });
    }

    // action === 'save'
    const { scorecardId, applicantId, criteria, overall_score, recommendation, interviewer_notes, completed } = parsed.data;

    const updates = {
      criteria,
      overall_score: overall_score ?? null,
      recommendation: recommendation ?? null,
      interviewer_notes: interviewer_notes ?? null,
      completed_at: completed ? new Date().toISOString() : null,
    };

    let result;
    if (scorecardId) {
      const { data } = await supabase
        .from('applicant_scorecards')
        .update(updates)
        .eq('id', scorecardId)
        .eq('firm_id', ctx.firmId)
        .select()
        .single();
      result = data;
    } else {
      const { data } = await supabase
        .from('applicant_scorecards')
        .insert({ ...updates, applicant_id: applicantId, firm_id: ctx.firmId })
        .select()
        .single();
      result = data;
    }

    return NextResponse.json({ scorecard: result });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError)
      return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[POST /api/staff-hire/scorecard]', err);
    return NextResponse.json({ error: 'Failed to process scorecard' }, { status: 500 });
  }
}
