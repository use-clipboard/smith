import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const IdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});

const BulkUpdateSchema = IdsSchema.extend({
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

  // Chunk to avoid PostgREST URL length limits (~8KB cap hits around 200 UUIDs)
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await supabase
      .from('clients')
      .update({ status })
      .in('id', ids.slice(i, i + CHUNK))
      .eq('firm_id', ctx.firmId);
    if (error) {
      console.error('[clients/bulk] Update error:', error);
      return NextResponse.json({ error: 'Failed to update clients' }, { status: 500 });
    }
  }

  return NextResponse.json({ updated: ids.length });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = IdsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const { ids } = parsed.data;
  const supabase = createClient();

  // Chunk to avoid PostgREST URL length limits
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await supabase
      .from('clients')
      .delete()
      .in('id', ids.slice(i, i + CHUNK))
      .eq('firm_id', ctx.firmId);
    if (error) {
      console.error('[clients/bulk] Delete error:', error);
      return NextResponse.json({ error: 'Failed to delete clients' }, { status: 500 });
    }
  }

  return NextResponse.json({ deleted: ids.length });
}
