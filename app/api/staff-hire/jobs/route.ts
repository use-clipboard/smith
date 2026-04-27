import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { hasStaffHireAccess } from '@/lib/staffHireAccess';
import { createClient } from '@/lib/supabase-server';

const RequirementSchema = z.object({
  label: z.string(),
  category: z.string(),
  mandatory: z.boolean(),
  notes: z.string().optional(),
});

const CreateJobSchema = z.object({
  title: z.string().min(1),
  employment_type: z.enum(['full_time', 'part_time', 'contract']),
  location_type: z.enum(['in_office', 'remote', 'hybrid']),
  location: z.string().nullable().optional(),
  salary_from: z.number().nullable().optional(),
  salary_to: z.number().nullable().optional(),
  salary_display: z.string().nullable().optional(),
  benefits: z.string().nullable().optional(),
  experience_years_min: z.number().nullable().optional(),
  requirements: z.array(RequirementSchema).default([]),
  description: z.string().nullable().optional(),
  generated_posting: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'closed']).default('active'),
});

export async function GET() {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const supabase = createClient();
    const { data, error } = await supabase
      .from('job_postings')
      .select('id, title, employment_type, location_type, location, salary_display, salary_from, salary_to, status, applicant_count, created_at')
      .eq('firm_id', ctx.firmId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ jobs: data ?? [] });
  } catch (err) {
    console.error('[GET /api/staff-hire/jobs]', err);
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateJobSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (!await hasStaffHireAccess(ctx.userId, ctx.firmId, ctx.userRole))
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const supabase = createClient();
    const { data, error } = await supabase
      .from('job_postings')
      .insert({ ...parsed.data, firm_id: ctx.firmId, created_by: ctx.userId })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ job: data }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/staff-hire/jobs]', err);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
