import { createClient } from '@/lib/supabase-server';
import { OPTIONAL_MODULE_IDS } from '@/config/modules.config';

export interface UserContext {
  userId: string;
  firmId: string;
  userRole: 'admin' | 'staff';
  activeModules: string[];
}

/**
 * Resolves the authenticated user, their firm, role, and active modules
 * from the current request cookies.
 *
 * Returns null if the user is not logged in or doesn't have a firm assigned yet.
 * Never throws — callers should treat null as "no auth context available".
 *
 * Uses separate queries (not a join) so that a missing active_modules column
 * on firms (pre-migration) never breaks auth or role resolution.
 */
export async function getUserContext(): Promise<UserContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Fetch user profile — separate from firms to avoid join failures
    const { data: profile } = await supabase
      .from('users')
      .select('firm_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.firm_id) return null;

    // Fetch active modules from firms — gracefully handle missing column (pre-migration)
    let activeModules: string[] = OPTIONAL_MODULE_IDS;
    try {
      const { data: firm } = await supabase
        .from('firms')
        .select('active_modules')
        .eq('id', profile.firm_id)
        .single();

      const stored = (firm?.active_modules as string[] | null) ?? [];
      // Empty array means migration not run yet OR firm has no modules set — default to all active
      activeModules = stored.length > 0 ? stored : OPTIONAL_MODULE_IDS;
    } catch {
      // Column doesn't exist yet — treat all modules as active (Phase 1 behaviour)
      activeModules = OPTIONAL_MODULE_IDS;
    }

    return {
      userId: user.id,
      firmId: profile.firm_id,
      userRole: (profile.role as 'admin' | 'staff') ?? 'staff',
      activeModules,
    };
  } catch {
    return null;
  }
}
