import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import type { CreditControlEvent, CreditControlEventType } from '@/lib/billing/types';

interface EventRow {
  id: string; invoice_id: string | null; type: string; stage_key: string | null; stage_name: string | null;
  channel: string | null; subject: string | null; body: string | null;
  promised_date: string | null; promised_amount_pence: number | null; note: string | null;
  created_by: string | null; created_at: string;
}
function mapEvent(r: EventRow): CreditControlEvent {
  return {
    id: r.id, invoiceId: r.invoice_id, type: r.type as CreditControlEventType,
    stageKey: r.stage_key, stageName: r.stage_name, channel: r.channel, subject: r.subject, body: r.body,
    promisedDate: r.promised_date, promisedAmountPence: r.promised_amount_pence, note: r.note,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

// GET /api/billing/credit-control/events?invoiceId= → timeline for an invoice.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const invoiceId = new URL(req.url).searchParams.get('invoiceId');
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });

  const supabase = createClient();
  const { data } = await supabase
    .from('credit_control_events').select('*').eq('firm_id', ctx.firmId).eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  return NextResponse.json({ events: (data as EventRow[] ?? []).map(mapEvent) });
}

const LogSchema = z.object({
  invoiceId: z.string().uuid(),
  type: z.enum(['call_logged', 'promise_to_pay', 'escalated', 'note', 'paused', 'resumed']),
  note: z.string().max(2000).nullable().optional(),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  promisedAmountPence: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});

// POST /api/billing/credit-control/events — log a manual credit-control action.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = LogSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
  const p = parsed.data;

  const supabase = createClient();
  const { data: inv } = await supabase
    .from('invoices').select('id, client_id').eq('id', p.invoiceId).eq('firm_id', ctx.firmId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const { error } = await supabase.from('credit_control_events').insert({
    firm_id: ctx.firmId, invoice_id: inv.id, client_id: inv.client_id, type: p.type,
    note: p.note ?? null, promised_date: p.promisedDate ?? null, promised_amount_pence: p.promisedAmountPence ?? null,
    created_by: ctx.userId,
  });
  if (error) return NextResponse.json({ error: 'Could not log event' }, { status: 500 });

  // Pause / resume toggles the invoice's chase flag so the cron respects it.
  if (p.type === 'paused' || p.type === 'resumed') {
    await supabase.from('invoices').update({ auto_chase: p.type === 'resumed' }).eq('id', inv.id).eq('firm_id', ctx.firmId);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
