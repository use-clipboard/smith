import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';

// GET /api/billing/audit?invoiceId= → activity for one invoice (or the firm).
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const invoiceId = new URL(req.url).searchParams.get('invoiceId');
  const supabase = createClient();
  let q = supabase.from('billing_audit')
    .select('id, invoice_id, action, detail, created_at, user:users(full_name, email)')
    .eq('firm_id', ctx.firmId).order('created_at', { ascending: false }).limit(invoiceId ? 100 : 200);
  if (invoiceId) q = q.eq('invoice_id', invoiceId);

  const { data } = await q;
  const events = (data ?? []).map(r => {
    const u = Array.isArray(r.user) ? r.user[0] : r.user;
    return { id: r.id, action: r.action, detail: r.detail, createdAt: r.created_at, by: (u as { full_name?: string; email?: string } | null)?.full_name || (u as { email?: string } | null)?.email || 'SMITH' };
  });
  return NextResponse.json({ events });
}
