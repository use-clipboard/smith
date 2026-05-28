import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PatchSchema = z.object({
  department_id: z.string().uuid().nullable().optional(),
  manager_id: z.string().uuid().nullable().optional(),
  job_title: z.string().nullable().optional(),
  job_description: z.string().nullable().optional(),
  employment_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  holiday_entitlement_days_override: z.number().min(0).max(366).nullable().optional(),
  pro_rata_first_year: z.boolean().optional(),
  // Admins can also maintain DOB + the "show to team" flag from the People
  // view — the self-serve endpoint /api/users/me/birthday handles the same
  // fields for the logged-in user.
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  show_birthday_to_team: z.boolean().optional(),
});

// PATCH /api/hr/team/[id] — admin-only update of a user's HR fields.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let patch: z.infer<typeof PatchSchema>;
  try { patch = PatchSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // Don't allow setting a user as their own manager.
  if (patch.manager_id && patch.manager_id === params.id) {
    return NextResponse.json({ error: 'A user cannot be their own manager.' }, { status: 400 });
  }

  const supabase = createClient();

  // Verify the target user is in the same firm before updating.
  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!target || target.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'User not found in your firm' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select('id, full_name, email, role, department_id, manager_id, job_title, job_description, employment_start_date, holiday_entitlement_days_override, pro_rata_first_year, date_of_birth, show_birthday_to_team')
    .single();

  if (error) {
    console.error('[PATCH /api/hr/team/:id]', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
  return NextResponse.json({ member: data });
}
