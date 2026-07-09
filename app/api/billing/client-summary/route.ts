import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';
import { mapInvoiceRow, mapRecurringRow, type InvoiceRow, type RecurringRow } from '@/lib/billing/map';

const NON_SALES = ['draft', 'cancelled'];

// GET /api/billing/client-summary?clientId= → one client's billing picture.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

  const supabase = createClient();
  const [{ data: client }, { data: invData }, { data: payData }, { data: recData }, { data: tokenRow }] = await Promise.all([
    supabase.from('clients').select('name').eq('id', clientId).eq('firm_id', ctx.firmId).maybeSingle(),
    supabase.from('invoices').select('*').eq('firm_id', ctx.firmId).eq('client_id', clientId).order('created_at', { ascending: false }).limit(500),
    supabase.from('payments').select('id, method, amount_pence, received_date, reference').eq('firm_id', ctx.firmId).eq('client_id', clientId).order('received_date', { ascending: false }).limit(500),
    supabase.from('recurring_invoices').select('*').eq('firm_id', ctx.firmId).eq('client_id', clientId).order('next_run_date', { ascending: true }).limit(200),
    supabase.from('billing_portal_tokens').select('token').eq('firm_id', ctx.firmId).eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const invoices = (invData ?? []) as InvoiceRow[];
  const outstandingPence = invoices.reduce((s, r) => s + (['sent', 'viewed', 'part_paid', 'overdue'].includes(r.status) ? balancePence(r.total_pence, r.amount_paid_pence) : 0), 0);
  const billedPence = invoices.reduce((s, r) => s + (NON_SALES.includes(r.status) ? 0 : r.total_pence), 0);
  const paidPence = invoices.reduce((s, r) => s + r.amount_paid_pence, 0);

  return NextResponse.json({
    clientName: client.name,
    outstandingPence, billedPence, paidPence,
    portalToken: tokenRow?.token ?? null,
    invoices: invoices.map(r => mapInvoiceRow(r)),
    payments: (payData ?? []).map(p => ({ id: p.id, method: p.method, amountPence: p.amount_pence, receivedDate: p.received_date, reference: p.reference })),
    recurring: (recData ?? []).map(r => mapRecurringRow(r as RecurringRow)),
  });
}
