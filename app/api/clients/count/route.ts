import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status');

  let query = supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('firm_id', ctx.firmId);

  if (statusFilter === 'active' || statusFilter === 'hold' || statusFilter === 'inactive') {
    query = query.eq('status', statusFilter);
  }

  const { count, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to count clients' }, { status: 500 });

  return NextResponse.json({ count: count ?? 0 });
}
