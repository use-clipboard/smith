import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/hr/team — list users in the firm with their HR fields.
// Visible to anyone in the firm so the org chart, holiday request form, etc. work.
// Sensitive fields (employment_start_date, holiday_entitlement_days_override) are
// only included for admins / the user themselves.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, avatar_url, department_id, manager_id, job_title, job_description, employment_start_date, holiday_entitlement_days_override')
    .eq('firm_id', ctx.firmId)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('[GET /api/hr/team]', error);
    return NextResponse.json({ error: 'Failed to load team' }, { status: 500 });
  }

  // Mask sensitive fields for non-admin / non-self viewers.
  const isAdmin = ctx.userRole === 'admin';
  const masked = (data ?? []).map(u => {
    if (isAdmin || u.id === ctx.userId) return u;
    return {
      ...u,
      employment_start_date: null,
      holiday_entitlement_days_override: null,
    };
  });

  return NextResponse.json({ members: masked });
}
