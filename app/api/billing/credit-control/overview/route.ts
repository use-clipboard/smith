import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';

const OUTSTANDING = ['sent', 'viewed', 'part_paid', 'overdue'];

type Risk = 'low' | 'medium' | 'high';
function riskLevel(daysOverdue: number, reminders: number, brokenPromise: boolean): Risk {
  if (brokenPromise || daysOverdue > 60 || reminders >= 3) return 'high';
  if (daysOverdue > 21 || reminders >= 1) return 'medium';
  return 'low';
}

// GET /api/billing/credit-control/overview → KPIs + the "needs attention" queue.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: invData }, { data: evData }, { data: settings }] = await Promise.all([
    supabase.from('invoices')
      .select('id, number, client_name, status, due_date, total_pence, amount_paid_pence, auto_chase')
      .eq('firm_id', ctx.firmId).in('status', OUTSTANDING).limit(3000),
    supabase.from('credit_control_events')
      .select('invoice_id, type, stage_name, promised_date, created_at')
      .eq('firm_id', ctx.firmId).in('type', ['reminder_sent', 'promise_to_pay']).limit(5000),
    supabase.from('billing_settings').select('auto_chase_enabled').eq('firm_id', ctx.firmId).maybeSingle(),
  ]);

  const invoices = (invData ?? []) as {
    id: string; number: string | null; client_name: string | null; status: string;
    due_date: string | null; total_pence: number; amount_paid_pence: number; auto_chase: boolean;
  }[];
  const events = (evData ?? []) as { invoice_id: string | null; type: string; stage_name: string | null; promised_date: string | null; created_at: string }[];

  // Index events per invoice.
  const reminderCount = new Map<string, number>();
  const lastReminder = new Map<string, { stageName: string | null; at: string }>();
  const openPromise = new Map<string, string>(); // invoice_id → promised_date
  for (const e of events) {
    if (!e.invoice_id) continue;
    if (e.type === 'reminder_sent') {
      reminderCount.set(e.invoice_id, (reminderCount.get(e.invoice_id) ?? 0) + 1);
      const prev = lastReminder.get(e.invoice_id);
      if (!prev || e.created_at > prev.at) lastReminder.set(e.invoice_id, { stageName: e.stage_name, at: e.created_at });
    } else if (e.type === 'promise_to_pay' && e.promised_date) {
      const prev = openPromise.get(e.invoice_id);
      if (!prev || e.promised_date > prev) openPromise.set(e.invoice_id, e.promised_date);
    }
  }

  let outstandingPence = 0;
  let overduePence = 0;
  let overdueCount = 0;
  let promisesOpen = 0;
  const needsAttention: unknown[] = [];

  for (const inv of invoices) {
    const bal = balancePence(inv.total_pence, inv.amount_paid_pence);
    if (bal <= 0) continue;
    outstandingPence += bal;

    const isOverdue = !!inv.due_date && inv.due_date < today;
    const promise = openPromise.get(inv.id) ?? null;
    const promiseOpen = !!promise && promise >= today;
    if (promiseOpen) promisesOpen++;

    if (!isOverdue) continue;
    overduePence += bal;
    overdueCount += 1;

    const daysOverdue = Math.floor((Date.parse(today) - Date.parse(inv.due_date!)) / 86_400_000);
    const reminders = reminderCount.get(inv.id) ?? 0;
    const brokenPromise = !!promise && promise < today;
    needsAttention.push({
      id: inv.id,
      number: inv.number,
      clientName: inv.client_name,
      balancePence: bal,
      dueDate: inv.due_date,
      daysOverdue,
      reminders,
      lastReminder: lastReminder.get(inv.id) ?? null,
      promiseDate: promise,
      promiseOpen,
      autoChase: inv.auto_chase,
      risk: riskLevel(daysOverdue, reminders, brokenPromise),
    });
  }

  needsAttention.sort((a, b) => (b as { daysOverdue: number }).daysOverdue - (a as { daysOverdue: number }).daysOverdue);

  return NextResponse.json({
    outstandingPence,
    overduePence,
    overdueCount,
    promisesOpen,
    autoChaseEnabled: settings?.auto_chase_enabled ?? false,
    needsAttention,
  });
}
