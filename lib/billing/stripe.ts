// Billing module — minimal Stripe client over the REST API (no SDK dependency).
//
// Platform keys live in env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. Everything is guarded on STRIPE_SECRET_KEY
// so the app runs fine without Stripe configured — the Payments/DD features
// simply report "not connected" until keys are set.

import crypto from 'crypto';

export class StripeNotConfiguredError extends Error {
  constructor() { super('Stripe is not configured'); this.name = 'StripeNotConfiguredError'; }
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
export function stripePublishableKey(): string | null {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;
}

type FormValue = string | number | boolean | null | undefined | FormObject | FormValue[];
interface FormObject { [k: string]: FormValue }

/** Serialise a nested object into Stripe's bracket form-encoding. */
function toForm(obj: FormObject, prefix = ''): string[] {
  const enc = encodeURIComponent;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') parts.push(...toForm(item as FormObject, `${key}[${i}]`));
        else parts.push(`${enc(key)}[${i}]=${enc(String(item))}`);
      });
    } else if (typeof v === 'object') {
      parts.push(...toForm(v as FormObject, key));
    } else {
      parts.push(`${enc(key)}=${enc(String(v))}`);
    }
  }
  return parts;
}

async function stripeRequest<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, params?: FormObject): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? toForm(params).join('&') : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json?.error?.message as string) ?? 'Stripe request failed');
  return json as T;
}

interface CheckoutSession { id: string; url: string | null }

/** Create a hosted Checkout Session to pay one invoice by card. */
export async function createInvoiceCheckout(args: {
  firmId: string; invoiceId: string; invoiceNumber: string; amountPence: number;
  clientEmail?: string | null; successUrl: string; cancelUrl: string;
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>('POST', 'checkout/sessions', {
    mode: 'payment',
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    ...(args.clientEmail ? { customer_email: args.clientEmail } : {}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: args.amountPence,
        product_data: { name: `Invoice ${args.invoiceNumber}` },
      },
    }],
    metadata: { invoice_id: args.invoiceId, firm_id: args.firmId },
    payment_intent_data: { metadata: { invoice_id: args.invoiceId, firm_id: args.firmId } },
  });
}

/** Create a Checkout Session in setup mode to collect a Bacs Direct Debit mandate. */
export async function createMandateCheckout(args: {
  firmId: string; clientId: string; clientEmail?: string | null; successUrl: string; cancelUrl: string;
}): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>('POST', 'checkout/sessions', {
    mode: 'setup',
    currency: 'gbp',
    payment_method_types: ['bacs_debit'],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    ...(args.clientEmail ? { customer_email: args.clientEmail } : {}),
    metadata: { client_id: args.clientId, firm_id: args.firmId, kind: 'bacs_mandate' },
  });
}

interface SetupIntent { id: string; payment_method: string | null; customer: string | null }
interface PaymentMethodObj { id: string; bacs_debit?: { last4?: string } | null }
interface PaymentIntent { id: string; status: string }

/** Retrieve a SetupIntent (to get the mandate's payment method + customer). */
export async function retrieveSetupIntent(id: string): Promise<SetupIntent> {
  return stripeRequest<SetupIntent>('GET', `setup_intents/${id}`);
}
/** Retrieve a PaymentMethod (for the Bacs last-4). */
export async function retrievePaymentMethod(id: string): Promise<PaymentMethodObj> {
  return stripeRequest<PaymentMethodObj>('GET', `payment_methods/${id}`);
}

/** Collect a payment off-session against a stored Bacs Direct Debit mandate.
 *  Bacs settles asynchronously — the PaymentIntent goes 'processing' then later
 *  'succeeded'; the webhook records the payment on succeeded. */
export async function collectViaBacs(args: {
  amountPence: number; customer: string; paymentMethod: string; invoiceId: string; firmId: string;
}): Promise<PaymentIntent> {
  return stripeRequest<PaymentIntent>('POST', 'payment_intents', {
    amount: args.amountPence,
    currency: 'gbp',
    customer: args.customer,
    payment_method: args.paymentMethod,
    payment_method_types: ['bacs_debit'],
    confirm: true,
    off_session: true,
    metadata: { invoice_id: args.invoiceId, firm_id: args.firmId, kind: 'bacs_collection' },
  });
}

/** Verify a Stripe webhook signature (t=…,v1=… scheme). */
export function verifyStripeWebhook(payload: string, sigHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map(kv => kv.split('=')));
  const t = parts['t']; const v1 = parts['v1'];
  if (!t || !v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch { return false; }
}

export { stripeRequest };
