import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { isStripeConfigured, stripePublishableKey } from '@/lib/billing/stripe';

// GET /api/billing/stripe/status → whether Stripe is connected (env keys present).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  return NextResponse.json({
    configured: isStripeConfigured(),
    publishableKey: stripePublishableKey(),
    webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
}
