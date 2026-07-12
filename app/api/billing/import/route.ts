import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';

// GET /api/billing/import → recent import batches (for the history / undo list).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { data } = await supabase
    .from('invoice_import_batches')
    .select('id, source, filename, invoice_count, client_created_count, recurring_count, created_at')
    .eq('firm_id', ctx.firmId).order('created_at', { ascending: false }).limit(20);

  return NextResponse.json({ batches: data ?? [] });
}
