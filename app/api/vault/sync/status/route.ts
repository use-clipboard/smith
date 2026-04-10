import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

export async function GET(_req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const db = createServiceClient();

    const [{ data: syncState }, { count: untaggedCount }] = await Promise.all([
      db
        .from('vault_sync_state')
        .select('*')
        .eq('firm_id', userCtx.firmId)
        .eq('user_id', userCtx.userId)
        .maybeSingle(),
      db
        .from('vault_documents')
        .select('*', { count: 'exact', head: true })
        .eq('firm_id', userCtx.firmId)
        .eq('tagging_status', 'untagged'),
    ]);

    return NextResponse.json({
      syncState: syncState ?? null,
      untaggedCount: untaggedCount ?? 0,
    });
  } catch (err) {
    console.error('[/api/vault/sync/status]', err);
    return NextResponse.json({ error: 'Failed to load sync status.' }, { status: 500 });
  }
}
