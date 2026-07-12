import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';
import { collectViaBacs, isStripeConfigured } from '@/lib/billing/stripe';

const Schema = z.object({ invoiceId: z.string().uuid() });

// POST /api/billing/stripe/collect — collect an invoice's balance by Bacs
// Direct Debit against the client's active mandate. Bacs settles in ~3 working
// days; the webhook records the payment when it succeeds.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not connected.' }, { status: 400 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { data: inv } = await supabase
    .from('invoices').select('id, number, client_id, total_pence, amount_paid_pence, credit_pence')
    .eq('id', parsed.data.invoiceId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  if (!inv.client_id) return NextResponse.json({ error: 'This invoice has no client to collect from.' }, { status: 400 });

  const bal = balancePence(inv.total_pence, inv.amount_paid_pence, inv.credit_pence ?? 0);
  if (bal <= 0) return NextResponse.json({ error: 'Nothing outstanding to collect.' }, { status: 400 });

  const { data: mandate } = await supabase
    .from('dd_mandates').select('stripe_customer_id, payment_method_id')
    .eq('firm_id', ctx.firmId).eq('client_id', inv.client_id).eq('status', 'active').maybeSingle();
  if (!mandate?.stripe_customer_id || !mandate?.payment_method_id) {
    return NextResponse.json({ error: 'This client has no active Direct Debit mandate. Request one from the Direct Debits tab first.' }, { status: 400 });
  }

  try {
    const pi = await collectViaBacs({
      amountPence: bal, customer: mandate.stripe_customer_id, paymentMethod: mandate.payment_method_id,
      invoiceId: inv.id, firmId: ctx.firmId,
    });
    return NextResponse.json({ ok: true, status: pi.status });
  } catch (err) {
    console.error('bacs collect', err);
    return NextResponse.json({ error: 'Could not start the Direct Debit collection.' }, { status: 502 });
  }
}
