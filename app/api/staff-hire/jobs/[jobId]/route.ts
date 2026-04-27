import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { createClient } from '@/lib/supabase-server';

const UpdateJobSchema = z.object({
  title: z.string().min(1).optional(),
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
  })).optional(),
  description: z.string().nullable().optional(),
  generated_posting: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
});

type RouteParams = { params: Promise<{ jobId: string }> };

async function getCtxAndJob(jobId: string) {
  const ctx = await getUserContext();
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('staff-hire')) return { error: moduleNotActive('staff-hire') };
  if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };

  const supabase = createClient();
  const { data: job } = await supabase
    .from('job_postings')
    .select('*')
    .eq('id', jobId)
    .eq('firm_id', ctx.firmId)
    .single();

  if (!job) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { ctx, supabase, job };
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;
    const result = await getCtxAndJob(jobId);
    if ('error' in result) return result.error;
    return NextResponse.json({ job: result.job });
  } catch (err) {
    console.error('[GET /api/staff-hire/jobs/[jobId]]', err);
    return NextResponse.json({ error: 'Failed to load job' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;
    const body = await req.json();
    const parsed = UpdateJobSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const result = await getCtxAndJob(jobId);
    if ('error' in result) return result.error;

    const { data, error } = await result.supabase
      .from('job_postings')
      .update(parsed.data)
      .eq('id', jobId)
      .eq('firm_id', result.ctx.firmId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ job: data });
  } catch (err) {
    console.error('[PATCH /api/staff-hire/jobs/[jobId]]', err);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;
    const result = await getCtxAndJob(jobId);
    if ('error' in result) return result.error;

    const { error } = await result.supabase
      .from('job_postings')
      .delete()
      .eq('id', jobId)
      .eq('firm_id', result.ctx.firmId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/staff-hire/jobs/[jobId]]', err);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
