import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  status: z.enum(['active', 'hold', 'inactive']),
});

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = BulkUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const { ids, status } = parsed.data;
  const supabase = createClient();

  const { error } = await supabase
    .from('clients')
    .update({ status })
    .in('id', ids)
    .eq('firm_id', ctx.firmId);

  if (error) {
    console.error('[clients/bulk] Update error:', error);
    return NextResponse.json({ error: 'Failed to update clients' }, { status: 500 });
  }

  return NextResponse.json({ updated: ids.length });
}
