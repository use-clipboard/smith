import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';

export interface StaffDto {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  charge_out_rate_pence: number | null;
  weekly_capacity_hours: number | null;
  department: string | null;
  manager_id: string | null;
}

// GET /api/timesheets/staff — firm members with charge-out rate + capacity.
// Gracefully returns nulls for the rate columns if the migration hasn't run.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

  const service = createServiceClient();

  // Try the full select; if the rate columns are missing (pre-migration),
  // fall back to the base columns so the module still loads.
  let members: StaffDto[] = [];
  const full = await service
    .from('users')
    .select('id, full_name, email, role, charge_out_rate_pence, weekly_capacity_hours, department, manager_id')
    .eq('firm_id', ctx.firmId)
    .order('full_name');

  if (full.error) {
    const base = await service
      .from('users')
      .select('id, full_name, email, role, manager_id')
      .eq('firm_id', ctx.firmId)
      .order('full_name');
    if (base.error) {
      // manager_id may also be absent (no HR migration) — drop it too.
      const bare = await service.from('users').select('id, full_name, email, role').eq('firm_id', ctx.firmId).order('full_name');
      if (bare.error) return NextResponse.json({ error: bare.error.message }, { status: 500 });
      members = (bare.data ?? []).map(m => ({ ...m, charge_out_rate_pence: null, weekly_capacity_hours: null, department: null, manager_id: null })) as StaffDto[];
    } else {
      members = (base.data ?? []).map(m => ({ ...m, charge_out_rate_pence: null, weekly_capacity_hours: null, department: null })) as StaffDto[];
    }
  } else {
    members = (full.data ?? []) as StaffDto[];
  }

  return NextResponse.json({ members });
}
