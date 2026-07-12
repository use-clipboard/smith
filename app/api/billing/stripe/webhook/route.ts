import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { verifyStripeWebhook, retrieveSetupIntent, retrievePaymentMethod } from '@/lib/billing/stripe';
import { recordPayment } from '@/lib/billing/recordPayment';

// POST /api/billing/stripe/webhook
// Stripe posts events here. We verify the signature against STRIPE_WEBHOOK_SECRET,
// then record card payments and Bacs Direct Debit mandates. Raw body is required
// for signature verification, so we read req.text() (no JSON parsing first).
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!verifyStripeWebhook(raw, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad payload' }, { status: 400 }); }

  const supabase = createServiceClient();
  const obj = event.data.object;

  try {
    if (event.type === 'checkout.session.completed') {
      const mode = obj.mode as string;
      const metadata = (obj.metadata as Record<string, string> | null) ?? {};

      if (mode === 'payment') {
        const firmId = metadata.firm_id;
        const invoiceId = metadata.invoice_id;
        const amountPence = Number(obj.amount_total ?? 0);
        const paymentIntent = (obj.payment_intent as string) ?? null;
        if (firmId && invoiceId && amountPence > 0) {
          // Idempotency: skip if we've already recorded this payment intent.
          const { data: existing } = await supabase
            .from('payments').select('id').eq('firm_id', firmId).eq('provider_ref', paymentIntent).maybeSingle();
          if (!existing) {
            await recordPayment(supabase, {
              firmId, invoiceId, amountPence, receivedDate: new Date().toISOString().slice(0, 10),
              method: 'stripe_card', providerRef: paymentIntent, matchedBy: 'user',
            });
          }
        }
      } else if (mode === 'setup') {
        // Bacs Direct Debit mandate collected. Retrieve the setup intent to get
        // the payment method (needed to collect against later) + bank last-4.
        const firmId = metadata.firm_id;
        const clientId = metadata.client_id || null;
        let customer = (obj.customer as string) ?? null;
        const setupIntentId = (obj.setup_intent as string) ?? null;
        let paymentMethod: string | null = null;
        let last4: string | null = null;
        if (setupIntentId) {
          try {
            const si = await retrieveSetupIntent(setupIntentId);
            paymentMethod = si.payment_method; customer = si.customer ?? customer;
            if (paymentMethod) { const pm = await retrievePaymentMethod(paymentMethod); last4 = pm.bacs_debit?.last4 ?? null; }
          } catch (e) { console.error('setup intent retrieve', e); }
        }
        if (firmId) {
          const { data: pending } = await supabase
            .from('dd_mandates').select('id').eq('firm_id', firmId).eq('client_id', clientId).eq('status', 'pending').maybeSingle();
          const patch = { status: 'active', stripe_customer_id: customer, payment_method_id: paymentMethod, bank_last4: last4, provider_mandate_id: setupIntentId, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          if (pending) await supabase.from('dd_mandates').update(patch).eq('id', pending.id);
          else await supabase.from('dd_mandates').insert({ firm_id: firmId, client_id: clientId, provider: 'stripe', ...patch });
        }
      }
    } else if (event.type === 'payment_intent.succeeded') {
      // Bacs Direct Debit collection settled → record the payment (card payments
      // are recorded on checkout.session.completed, so we only act on our own DD
      // collections, tagged kind='bacs_collection').
      const metadata = (obj.metadata as Record<string, string> | null) ?? {};
      if (metadata.kind === 'bacs_collection' && metadata.firm_id && metadata.invoice_id) {
        const providerRef = obj.id as string;
        const amountPence = Number(obj.amount_received ?? obj.amount ?? 0);
        const { data: existing } = await supabase.from('payments').select('id').eq('firm_id', metadata.firm_id).eq('provider_ref', providerRef).maybeSingle();
        if (!existing && amountPence > 0) {
          await recordPayment(supabase, {
            firmId: metadata.firm_id, invoiceId: metadata.invoice_id, amountPence,
            receivedDate: new Date().toISOString().slice(0, 10), method: 'stripe_bacs_dd', providerRef, matchedBy: 'user',
          });
        }
      }
    } else if (event.type === 'setup_intent.setup_failed') {
      const setupIntent = obj.id as string;
      await supabase.from('dd_mandates').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('provider_mandate_id', setupIntent);
    }
  } catch (err) {
    console.error('stripe webhook handler', err);
    // Return 200 so Stripe doesn't hammer retries for an app-side logging issue;
    // real signature/parse failures already returned 400 above.
  }

  return NextResponse.json({ received: true });
}
