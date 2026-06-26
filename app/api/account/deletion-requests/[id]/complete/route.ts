import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { deleteUserCompletely } from '@/lib/accountDeletion';

// ── POST /api/account/deletion-requests/[id]/complete ────────────────────────
// Admin-only: carry out a pending account-deletion request — fully delete the
// user + their personal data (Google tokens revoked, auth account removed),
// then mark the request completed.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();

  const { data: request } = await service
    .from('account_deletion_requests')
    .select('id, user_id, firm_id, status')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (request.status !== 'pending') {
    return NextResponse.json({ error: `Request is already ${request.status}.` }, { status: 409 });
  }

  const targetUserId = request.user_id as string | null;

  // The user may already be gone (user_id set to null on a prior delete) — then
  // there's nothing to delete, just close the request.
  if (targetUserId) {
    // Re-check the last-admin guard at completion time.
    const { data: target } = await service
      .from('users').select('role').eq('id', targetUserId).eq('firm_id', ctx.firmId).maybeSingle();
    if (target?.role === 'admin') {
      const { count } = await service
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('firm_id', ctx.firmId)
        .eq('role', 'admin')
        .neq('id', targetUserId);
      if ((count ?? 0) < 1) {
        return NextResponse.json(
          { error: 'Cannot delete — this user is the only remaining admin. Promote another admin first.' },
          { status: 400 },
        );
      }
    }

    try {
      await deleteUserCompletely(service, targetUserId, ctx.firmId);
    } catch (e) {
      console.error('complete deletion', e);
      return NextResponse.json({ error: 'Deletion failed. Please try again.' }, { status: 500 });
    }
  }

  // user_id will have been nulled by the ON DELETE SET NULL FK — update by id.
  await service
    .from('account_deletion_requests')
    .update({ status: 'completed', completed_at: new Date().toISOString(), completed_by: ctx.userId })
    .eq('id', params.id);

  return NextResponse.json({ ok: true });
}
