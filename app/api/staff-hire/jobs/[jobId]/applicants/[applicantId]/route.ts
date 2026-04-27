import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { createClient } from '@/lib/supabase-server';

const UpdateApplicantSchema = z.object({
  full_name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  stage: z.enum(['applied', 'shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired', 'rejected']).optional(),
  cv_storage_path: z.string().nullable().optional(),
  cv_filename: z.string().nullable().optional(),
  cover_letter_storage_path: z.string().nullable().optional(),
  cover_letter_filename: z.string().nullable().optional(),
  ai_evaluation: z.record(z.string(), z.unknown()).nullable().optional(),
  ai_score: z.number().nullable().optional(),
  ai_summary: z.string().nullable().optional(),
  ranking_position: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ jobId: string; applicantId: string }> };

async function getCtxAndApplicant(jobId: string, applicantId: string) {
  const ctx = await getUserContext();
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('staff-hire')) return { error: moduleNotActive('staff-hire') };
  if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };

  const supabase = createClient();
  const { data: applicant } = await supabase
    .from('job_applicants')
    .select('*')
    .eq('id', applicantId)
    .eq('job_id', jobId)
    .eq('firm_id', ctx.firmId)
    .single();

  if (!applicant) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { ctx, supabase, applicant };
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId, applicantId } = await params;
    const result = await getCtxAndApplicant(jobId, applicantId);
    if ('error' in result) return result.error;

    // Also fetch questions and scorecard
    const [questionsRes, scorecardRes] = await Promise.all([
      result.supabase
        .from('applicant_questions')
        .select('*')
        .eq('applicant_id', applicantId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      result.supabase
        .from('applicant_scorecards')
        .select('*')
        .eq('applicant_id', applicantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      applicant: result.applicant,
      questions: questionsRes.data ?? null,
      scorecard: scorecardRes.data ?? null,
    });
  } catch (err) {
    console.error('[GET /api/staff-hire/.../applicants/[id]]', err);
    return NextResponse.json({ error: 'Failed to load applicant' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId, applicantId } = await params;
    const body = await req.json();
    const parsed = UpdateApplicantSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const result = await getCtxAndApplicant(jobId, applicantId);
    if ('error' in result) return result.error;

    const { data, error } = await result.supabase
      .from('job_applicants')
      .update(parsed.data)
      .eq('id', applicantId)
      .eq('firm_id', result.ctx.firmId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ applicant: data });
  } catch (err) {
    console.error('[PATCH /api/staff-hire/.../applicants/[id]]', err);
    return NextResponse.json({ error: 'Failed to update applicant' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId, applicantId } = await params;
    const result = await getCtxAndApplicant(jobId, applicantId);
    if ('error' in result) return result.error;

    const { error } = await result.supabase
      .from('job_applicants')
      .delete()
      .eq('id', applicantId)
      .eq('firm_id', result.ctx.firmId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/staff-hire/.../applicants/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete applicant' }, { status: 500 });
  }
}
