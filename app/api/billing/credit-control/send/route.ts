import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { chaseInvoiceOnce } from '@/lib/billing/creditControl';

const Schema = z.object({
  invoiceId: z.string().uuid(),
  stageKey: z.string().max(40).optional(),
});

// POST /api/billing/credit-control/send — send a reminder for one invoice now.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const res = await chaseInvoiceOnce(supabase, {
    firmId: ctx.firmId, invoiceId: parsed.data.invoiceId, stageKey: parsed.data.stageKey, userId: ctx.userId,
  });
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'Could not send reminder' }, { status: 400 });
  return NextResponse.json({ ok: true, stageName: res.stageName });
}
