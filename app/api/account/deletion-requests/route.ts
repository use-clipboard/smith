import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── GET /api/account/deletion-requests ───────────────────────────────────────
// Admin-only: pending account-deletion requests for the firm, for the Team tab.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('account_deletion_requests')
    .select('id, user_id, user_email, user_name, reason, requested_at, status')
    .eq('firm_id', ctx.firmId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}
