import { createClient } from '@/lib/supabase-server';

export interface HrAccessResult {
  ok: boolean;
  isSelf: boolean;
  isManager: boolean;
  isAdmin: boolean;
  /** Convenience flag: caller can view this user's HR record */
  canView: boolean;
  /** Convenience flag: caller can edit non-sensitive fields on this user's record */
  canEdit: boolean;
}

/**
 * Resolve who a caller is in relation to a target user, scoped to the same firm.
 * Used by every Phase 3 API endpoint to decide read/write access.
 *
 *   canView  = self OR manager-of-target OR admin
 *   canEdit  = manager-of-target OR admin (some endpoints widen this for self
 *              writes — e.g. emergency contacts, training records)
 */
export async function checkHrAccess(
  callerUserId: string,
  callerFirmId: string,
  callerRole: 'admin' | 'staff',
  targetUserId: string,
): Promise<HrAccessResult> {
  if (callerUserId === targetUserId) {
    return { ok: true, isSelf: true, isManager: false, isAdmin: callerRole === 'admin', canView: true, canEdit: callerRole === 'admin' };
  }
  const supabase = createClient();
  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id, manager_id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (!target || target.firm_id !== callerFirmId) {
    return { ok: false, isSelf: false, isManager: false, isAdmin: false, canView: false, canEdit: false };
  }
  const isAdmin = callerRole === 'admin';
  const isManager = target.manager_id === callerUserId;
  return {
    ok: true,
    isSelf: false,
    isManager,
    isAdmin,
    canView: isManager || isAdmin,
    canEdit: isManager || isAdmin,
  };
}
