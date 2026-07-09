import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { balancePence } from '@/lib/billing/totals';
import { createInvoiceCheckout, isStripeConfigured } from '@/lib/billing/stripe';

const Schema = z.object({ invoiceId: z.string().uuid() });

// POST /api/billing/portal/[token]/pay — PUBLIC. A client pays one of their own
// invoices by card from the statement portal. Token scopes it to their firm+client.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Card payments are not available.' }, { status: 400 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data: tok } = await supabase
    .from('billing_portal_tokens').select('firm_id, client_id, expires_at').eq('token', params.token).maybeSingle();
  if (!tok || (tok.expires_at as string) < nowIso) return NextResponse.json({ error: 'Link expired' }, { status: 404 });

  // The invoice must belong to this token's firm + client.
  const { data: inv } = await supabase
    .from('invoices').select('id, number, total_pence, amount_paid_pence')
    .eq('id', parsed.data.invoiceId).eq('firm_id', tok.firm_id).eq('client_id', tok.client_id).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const bal = balancePence(inv.total_pence, inv.amount_paid_pence);
  if (bal <= 0) return NextResponse.json({ error: 'This invoice is already paid.' }, { status: 400 });

  const base = getBaseUrl();
  try {
    const session = await createInvoiceCheckout({
      firmId: tok.firm_id, invoiceId: inv.id, invoiceNumber: inv.number ?? 'invoice', amountPence: bal,
      successUrl: `${base}/statement/${params.token}?paid=1`, cancelUrl: `${base}/statement/${params.token}`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('portal pay', err);
    return NextResponse.json({ error: 'Could not start payment.' }, { status: 502 });
  }
}
