import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { isStripeConfigured } from '@/lib/billing/stripe';

// GET /api/billing/direct-debits → the firm's Bacs Direct Debit mandates.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const { data } = await supabase
    .from('dd_mandates')
    .select('id, client_id, status, bank_last4, reference, created_at, activated_at, client:clients(name)')
    .eq('firm_id', ctx.firmId).order('created_at', { ascending: false });

  const mandates = (data ?? []).map(r => {
    const c = Array.isArray(r.client) ? r.client[0] : r.client;
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: (c as { name?: string } | null)?.name ?? r.reference ?? '—',
      status: r.status,
      bankLast4: r.bank_last4,
      createdAt: r.created_at,
      activatedAt: r.activated_at,
    };
  });

  return NextResponse.json({ mandates, stripeConfigured: isStripeConfigured() });
}
