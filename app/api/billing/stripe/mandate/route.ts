import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { createMandateCheckout, isStripeConfigured } from '@/lib/billing/stripe';

const Schema = z.object({ clientId: z.string().uuid() });

// POST /api/billing/stripe/mandate — start a Bacs Direct Debit mandate setup for
// a client. Returns a hosted URL to send them; the webhook activates the mandate.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not connected. Add your Stripe keys to enable Direct Debit.' }, { status: 400 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { data: client } = await supabase.from('clients').select('id, name, contact_email').eq('id', parsed.data.clientId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const base = getBaseUrl();
  try {
    const session = await createMandateCheckout({
      firmId: ctx.firmId, clientId: client.id, clientEmail: client.contact_email,
      successUrl: `${base}/billing?mandate=1`, cancelUrl: `${base}/billing`,
    });
    // Track a pending mandate so it shows in the DD tab immediately.
    const { data: existing } = await supabase.from('dd_mandates').select('id').eq('firm_id', ctx.firmId).eq('client_id', client.id).in('status', ['pending', 'active']).maybeSingle();
    if (!existing) {
      await supabase.from('dd_mandates').insert({ firm_id: ctx.firmId, client_id: client.id, provider: 'stripe', status: 'pending', reference: client.name });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('stripe mandate', err);
    return NextResponse.json({ error: 'Could not start the mandate.' }, { status: 502 });
  }
}
