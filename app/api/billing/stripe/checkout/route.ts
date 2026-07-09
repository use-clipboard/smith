import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { balancePence } from '@/lib/billing/totals';
import { createInvoiceCheckout, isStripeConfigured } from '@/lib/billing/stripe';

const Schema = z.object({ invoiceId: z.string().uuid() });

// POST /api/billing/stripe/checkout — hosted card-payment link for one invoice.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not connected. Add your Stripe keys to enable card payments.' }, { status: 400 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { data: inv } = await supabase
    .from('invoices').select('id, number, client_id, total_pence, amount_paid_pence, status')
    .eq('id', parsed.data.invoiceId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const bal = balancePence(inv.total_pence, inv.amount_paid_pence);
  if (bal <= 0) return NextResponse.json({ error: 'This invoice has nothing to pay.' }, { status: 400 });

  let clientEmail: string | null = null;
  if (inv.client_id) {
    const { data: client } = await supabase.from('clients').select('contact_email').eq('id', inv.client_id).maybeSingle();
    clientEmail = client?.contact_email ?? null;
  }

  const base = getBaseUrl();
  try {
    const session = await createInvoiceCheckout({
      firmId: ctx.firmId, invoiceId: inv.id, invoiceNumber: inv.number ?? 'invoice', amountPence: bal,
      clientEmail, successUrl: `${base}/billing?paid=1`, cancelUrl: `${base}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('stripe checkout', err);
    return NextResponse.json({ error: 'Could not create a payment link.' }, { status: 502 });
  }
}
