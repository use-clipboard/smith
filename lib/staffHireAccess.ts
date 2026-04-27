import { createClient } from '@/lib/supabase-server';

/**
 * Returns true if the user can access the Staff Hire tool.
 * Admins always have access. Staff users need an explicit grant in staff_hire_access.
 */
export async function hasStaffHireAccess(userId: string, firmId: string, userRole: string): Promise<boolean> {
  if (userRole === 'admin') return true;

  const supabase = createClient();
  const { data } = await supabase
    .from('staff_hire_access')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle();

  return !!data;
}
