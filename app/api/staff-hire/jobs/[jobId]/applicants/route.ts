import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { createClient } from '@/lib/supabase-server';

const CreateApplicantSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  cv_storage_path: z.string().nullable().optional(),
  cv_filename: z.string().nullable().optional(),
  cover_letter_storage_path: z.string().nullable().optional(),
  cover_letter_filename: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ jobId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const supabase = createClient();

    // Verify job belongs to firm
    const { data: job } = await supabase
      .from('job_postings')
      .select('id')
      .eq('id', jobId)
      .eq('firm_id', ctx.firmId)
      .single();
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data, error } = await supabase
      .from('job_applicants')
      .select('*')
      .eq('job_id', jobId)
      .eq('firm_id', ctx.firmId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ applicants: data ?? [] });
  } catch (err) {
    console.error('[GET /api/staff-hire/jobs/[jobId]/applicants]', err);
    return NextResponse.json({ error: 'Failed to load applicants' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { jobId } = await params;
    const body = await req.json();
    const parsed = CreateApplicantSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const supabase = createClient();

    // Verify job belongs to firm
    const { data: job } = await supabase
      .from('job_postings')
      .select('id')
      .eq('id', jobId)
      .eq('firm_id', ctx.firmId)
      .single();
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data, error } = await supabase
      .from('job_applicants')
      .insert({ ...parsed.data, job_id: jobId, firm_id: ctx.firmId, added_by: ctx.userId })
      .select()
      .single();

    if (error) throw error;

    // Increment applicant_count on the job (best-effort)
    void (async () => {
      const { data: current } = await supabase.from('job_postings').select('applicant_count').eq('id', jobId).single();
      const newCount = ((current as { applicant_count?: number } | null)?.applicant_count ?? 0) + 1;
      await supabase.from('job_postings').update({ applicant_count: newCount }).eq('id', jobId);
    })();

    return NextResponse.json({ applicant: data }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/staff-hire/jobs/[jobId]/applicants]', err);
    return NextResponse.json({ error: 'Failed to add applicant' }, { status: 500 });
  }
}
