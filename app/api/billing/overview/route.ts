import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';
import { mapInvoiceRow, type InvoiceRow } from '@/lib/billing/map';
import type { BillingOverview, InvoiceStatus } from '@/lib/billing/types';

const OUTSTANDING: InvoiceStatus[] = ['sent', 'viewed', 'part_paid', 'overdue'];
const NON_SALES: InvoiceStatus[] = ['draft', 'cancelled'];

const DAY_MS = 86_400_000;
function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(a) - Date.parse(b)) / DAY_MS);
}
/** yyyy-mm from a date-ish string. */
function monthKey(d: string): string { return d.slice(0, 7); }

// GET /api/billing/overview → the command-centre KPIs + chart data.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const [{ data: invData }, { data: payData }] = await Promise.all([
    supabase.from('invoices').select('*').eq('firm_id', ctx.firmId).limit(5000),
    supabase.from('payments').select('amount_pence, received_date').eq('firm_id', ctx.firmId).limit(5000),
  ]);

  const invoices = (invData ?? []) as InvoiceRow[];
  const payments = (payData ?? []) as { amount_pence: number; received_date: string }[];

  const todayIso = new Date().toISOString().slice(0, 10);
  const thisMonth = todayIso.slice(0, 7);
  // Last month key (calendar).
  const [ty, tm] = thisMonth.split('-').map(Number);
  const lastMonthDate = new Date(Date.UTC(ty, tm - 2, 1));
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  // Six-month window (oldest → newest) for the cash-flow chart.
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(Date.UTC(ty, tm - 1 - i, 1)).toISOString().slice(0, 7));
  }

  const invMonth = (r: InvoiceRow) => monthKey(r.issue_date ?? r.created_at);
  const isSale = (r: InvoiceRow) => !NON_SALES.includes(r.status as InvoiceStatus);

  let salesThisMonthPence = 0;
  let salesLastMonthPence = 0;
  let outstandingPence = 0;
  let outstandingCount = 0;
  let overduePence = 0;
  let overdueCount = 0;
  const aged = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const cashByMonth: Record<string, { invoiced: number; paid: number }> = {};
  months.forEach(m => { cashByMonth[m] = { invoiced: 0, paid: 0 }; });
  const statusMap = new Map<InvoiceStatus, { count: number; totalPence: number }>();
  const debtorMap = new Map<string, { clientId: string | null; clientName: string; balancePence: number; oldestDays: number }>();

  for (const r of invoices) {
    const status = r.status as InvoiceStatus;
    const bal = balancePence(r.total_pence, r.amount_paid_pence, (r as InvoiceRow & { credit_pence?: number }).credit_pence ?? 0);
    const m = invMonth(r);

    // Status summary (all invoices).
    const sc = statusMap.get(status) ?? { count: 0, totalPence: 0 };
    sc.count += 1; sc.totalPence += r.total_pence;
    statusMap.set(status, sc);

    // Sales (invoiced) totals.
    if (isSale(r)) {
      if (m === thisMonth) salesThisMonthPence += r.total_pence;
      if (m === lastMonth) salesLastMonthPence += r.total_pence;
      if (cashByMonth[m]) cashByMonth[m].invoiced += r.total_pence;
    }

    // Outstanding + aged + overdue + debtors.
    if (OUTSTANDING.includes(status) && bal > 0) {
      outstandingPence += bal; outstandingCount += 1;
      const ref = r.due_date ?? r.issue_date ?? r.created_at.slice(0, 10);
      const age = Math.max(0, daysBetween(todayIso, ref));
      if (age <= 30) aged.current += bal;
      else if (age <= 60) aged.d31_60 += bal;
      else if (age <= 90) aged.d61_90 += bal;
      else aged.d90plus += bal;

      if (r.due_date && r.due_date < todayIso) { overduePence += bal; overdueCount += 1; }

      const key = r.client_id ?? `name:${r.client_name ?? 'unknown'}`;
      const d = debtorMap.get(key) ?? { clientId: r.client_id, clientName: r.client_name ?? 'Unknown client', balancePence: 0, oldestDays: 0 };
      d.balancePence += bal; d.oldestDays = Math.max(d.oldestDays, age);
      debtorMap.set(key, d);
    }
  }

  // Cash received.
  let cashThisMonthPence = 0;
  for (const p of payments) {
    const m = monthKey(p.received_date);
    if (m === thisMonth) cashThisMonthPence += p.amount_pence;
    if (cashByMonth[m]) cashByMonth[m].paid += p.amount_pence;
  }

  // Average days to pay — true settle time (issue_date → paid_at) for invoices
  // settled in a window, so the delta compares the last 90 days vs the 90 before.
  function avgDaysToPay(fromDaysAgo: number, toDaysAgo: number): number {
    const spans: number[] = [];
    for (const r of invoices) {
      const paidAt = (r as InvoiceRow & { paid_at?: string | null }).paid_at;
      if (r.status !== 'paid' || !r.issue_date || !paidAt) continue;
      const settledIso = paidAt.slice(0, 10);
      const ageFromToday = daysBetween(todayIso, settledIso);
      if (ageFromToday >= toDaysAgo && ageFromToday < fromDaysAgo) {
        spans.push(Math.max(0, daysBetween(settledIso, r.issue_date)));
      }
    }
    if (!spans.length) return 0;
    return Math.round(spans.reduce((s, x) => s + x, 0) / spans.length);
  }
  const averageDaysToPay = avgDaysToPay(90, 0);
  const averageDaysDelta = averageDaysToPay - avgDaysToPay(180, 90);

  const salesDeltaRatio = salesLastMonthPence > 0
    ? (salesThisMonthPence - salesLastMonthPence) / salesLastMonthPence
    : 0;

  const recent = invoices
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map(r => mapInvoiceRow(r));

  const statusCounts = Array.from(statusMap.entries())
    .map(([status, v]) => ({ status, count: v.count, totalPence: v.totalPence }));

  const topDebtors = Array.from(debtorMap.values())
    .sort((a, b) => b.balancePence - a.balancePence)
    .slice(0, 5);

  const overview: BillingOverview = {
    salesThisMonthPence,
    salesDeltaRatio,
    outstandingPence,
    outstandingCount,
    overduePence,
    overdueCount,
    cashThisMonthPence,
    averageDaysToPay,
    averageDaysDelta,
    aged,
    cashFlow: months.map(m => ({
      label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short' }),
      invoicedPence: cashByMonth[m].invoiced,
      paidPence: cashByMonth[m].paid,
    })),
    statusCounts,
    recent,
    topDebtors,
    hasData: invoices.length > 0,
  };

  return NextResponse.json(overview);
}
