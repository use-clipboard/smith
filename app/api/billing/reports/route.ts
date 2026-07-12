import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';

const NON_SALES = ['draft', 'cancelled'];
const OUTSTANDING = ['sent', 'viewed', 'part_paid', 'overdue'];
const DAY = 86_400_000;

function monthKey(d: string): string { return d.slice(0, 7); }
function daysBetween(a: string, b: string): number { return Math.floor((Date.parse(a) - Date.parse(b)) / DAY); }

interface RecurringLite { frequency: string; interval_days: number | null; total_pence: number }
function monthlyEquivalent(r: RecurringLite): number {
  switch (r.frequency) {
    case 'monthly': return r.total_pence;
    case 'quarterly': return Math.round(r.total_pence / 3);
    case 'annual': return Math.round(r.total_pence / 12);
    case 'custom': return r.interval_days ? Math.round((r.total_pence * 30) / r.interval_days) : r.total_pence;
    default: return r.total_pence;
  }
}

// GET /api/billing/reports → practice-revenue analytics.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [ty, tm] = today.slice(0, 7).split('-').map(Number);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(ty, tm - 1 - i, 1)).toISOString().slice(0, 10).slice(0, 7));
  const yearAgo = new Date(Date.UTC(ty, tm - 12, 1)).toISOString().slice(0, 10);

  const [{ data: invData }, { data: payData }, { data: recData }, { data: timeData }, { data: propData }] = await Promise.all([
    supabase.from('invoices').select('id, client_id, client_name, status, issue_date, due_date, total_pence, amount_paid_pence, credit_pence, paid_at, created_at, created_by').eq('firm_id', ctx.firmId).limit(5000),
    supabase.from('payments').select('amount_pence, received_date').eq('firm_id', ctx.firmId).limit(5000),
    supabase.from('recurring_invoices').select('frequency, interval_days, total_pence').eq('firm_id', ctx.firmId).eq('status', 'active').limit(2000),
    supabase.from('time_entries').select('client_id, minutes, rate_pence, entry_date').eq('firm_id', ctx.firmId).eq('entry_type', 'billable').gte('entry_date', yearAgo).limit(20000),
    supabase.from('proposals').select('status').eq('firm_id', ctx.firmId).limit(5000),
  ]);

  const invoices = (invData ?? []) as { id: string; client_id: string | null; client_name: string | null; status: string; issue_date: string | null; due_date: string | null; total_pence: number; amount_paid_pence: number; credit_pence: number | null; paid_at: string | null; created_at: string; created_by: string | null }[];
  const payments = (payData ?? []) as { amount_pence: number; received_date: string }[];
  const recurring = (recData ?? []) as RecurringLite[];
  const time = (timeData ?? []) as { client_id: string | null; minutes: number; rate_pence: number; entry_date: string }[];
  const proposals = (propData ?? []) as { status: string }[];

  // MRR / ARR.
  const mrrPence = recurring.reduce((s, r) => s + monthlyEquivalent(r), 0);

  // Monthly invoiced vs collected.
  const invByMonth: Record<string, number> = {}; const cashByMonth: Record<string, number> = {};
  months.forEach(m => { invByMonth[m] = 0; cashByMonth[m] = 0; });
  const isSale = (s: string) => !NON_SALES.includes(s);

  const billedByClient = new Map<string, { name: string; pence: number }>();
  const byManager = new Map<string, number>();     // created_by → total (12mo)
  const saleIds12mo: string[] = [];                 // for revenue-by-service (lines)
  const aged = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const settleSpans: number[] = [];
  let outstandingPence = 0; let badDebtPence = 0;

  for (const inv of invoices) {
    const m = monthKey(inv.issue_date ?? inv.created_at);
    const in12mo = (inv.issue_date ?? inv.created_at) >= yearAgo;
    if (isSale(inv.status)) {
      if (invByMonth[m] != null) invByMonth[m] += inv.total_pence;
      const key = inv.client_id ?? `name:${inv.client_name ?? 'unknown'}`;
      const rec = billedByClient.get(key) ?? { name: inv.client_name ?? 'Unknown', pence: 0 };
      // Bill within the last 12 months (recovery comparability).
      if (in12mo) {
        rec.pence += inv.total_pence; billedByClient.set(key, rec);
        if (inv.created_by) byManager.set(inv.created_by, (byManager.get(inv.created_by) ?? 0) + inv.total_pence);
        saleIds12mo.push(inv.id);
      }
    }
    if (inv.status === 'bad_debt') badDebtPence += inv.total_pence;

    const bal = balancePence(inv.total_pence, inv.amount_paid_pence, inv.credit_pence ?? 0);
    if (OUTSTANDING.includes(inv.status) && bal > 0) {
      outstandingPence += bal;
      const ref = inv.due_date ?? inv.issue_date ?? inv.created_at.slice(0, 10);
      const age = Math.max(0, daysBetween(today, ref));
      if (age <= 30) aged.current += bal; else if (age <= 60) aged.d31_60 += bal; else if (age <= 90) aged.d61_90 += bal; else aged.d90plus += bal;
    }
    if (inv.status === 'paid' && inv.paid_at && inv.issue_date) settleSpans.push(Math.max(0, daysBetween(inv.paid_at.slice(0, 10), inv.issue_date)));
  }

  for (const p of payments) { const m = monthKey(p.received_date); if (cashByMonth[m] != null) cashByMonth[m] += p.amount_pence; }

  const debtorDays = settleSpans.length ? Math.round(settleSpans.reduce((s, x) => s + x, 0) / settleSpans.length) : 0;

  // Recovery by client: billed (12mo) vs chargeable time value (12mo).
  const chargeableByClient = new Map<string, number>();
  let firmChargeable = 0;
  for (const t of time) {
    if (!t.client_id) continue;
    const value = Math.round((t.minutes / 60) * t.rate_pence);
    chargeableByClient.set(t.client_id, (chargeableByClient.get(t.client_id) ?? 0) + value);
    firmChargeable += value;
  }
  const recovery = Array.from(chargeableByClient.entries())
    .map(([clientId, chargeablePence]) => {
      const billed = billedByClient.get(clientId)?.pence ?? 0;
      const name = billedByClient.get(clientId)?.name ?? 'Client';
      return { clientId, clientName: name, chargeablePence, billedPence: billed, recoveryRatio: chargeablePence > 0 ? billed / chargeablePence : 0 };
    })
    .sort((a, b) => b.chargeablePence - a.chargeablePence)
    .slice(0, 10);
  const firmBilled12mo = Array.from(billedByClient.values()).reduce((s, c) => s + c.pence, 0);
  const firmRecoveryRatio = firmChargeable > 0 ? firmBilled12mo / firmChargeable : 0;

  const topClients = Array.from(billedByClient.values()).sort((a, b) => b.pence - a.pence).slice(0, 8);

  // Revenue by team member (invoice creator) — 12 months.
  const managerIds = [...byManager.keys()];
  const nameById = new Map<string, string>();
  if (managerIds.length) {
    const { data: users } = await supabase.from('users').select('id, full_name, email').in('id', managerIds);
    for (const u of (users ?? []) as { id: string; full_name: string | null; email: string | null }[]) nameById.set(u.id, u.full_name || u.email || 'Team member');
  }
  const byManagerArr = Array.from(byManager.entries())
    .map(([id, pence]) => ({ name: nameById.get(id) ?? 'Team member', pence }))
    .sort((a, b) => b.pence - a.pence).slice(0, 8);

  // Revenue by service — grouped by invoice-line description across 12mo sales.
  const byService = new Map<string, number>();
  if (saleIds12mo.length) {
    const { data: lines } = await supabase.from('invoice_lines').select('description, net_pence, invoice_id').in('invoice_id', saleIds12mo.slice(0, 3000));
    for (const l of (lines ?? []) as { description: string | null; net_pence: number }[]) {
      const key = (l.description || 'Other').trim() || 'Other';
      byService.set(key, (byService.get(key) ?? 0) + l.net_pence);
    }
  }
  const byServiceArr = Array.from(byService.entries())
    .map(([name, pence]) => ({ name, pence }))
    .sort((a, b) => b.pence - a.pence).slice(0, 8);

  // Proposal conversion.
  const propTotal = proposals.length;
  const propAccepted = proposals.filter(p => p.status === 'accepted').length;

  return NextResponse.json({
    mrrPence, arrPence: mrrPence * 12,
    revenue12moPence: months.reduce((s, m) => s + invByMonth[m], 0),
    cash12moPence: months.reduce((s, m) => s + cashByMonth[m], 0),
    outstandingPence, badDebtPence, debtorDays,
    byMonth: months.map(m => ({ label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short' }), invoicedPence: invByMonth[m], collectedPence: cashByMonth[m] })),
    aged,
    topClients,
    byManager: byManagerArr,
    byService: byServiceArr,
    recovery,
    firmRecoveryRatio,
    firmChargeablePence: firmChargeable,
    hasTimeData: time.length > 0,
    proposalConversion: { accepted: propAccepted, total: propTotal, rate: propTotal > 0 ? propAccepted / propTotal : 0 },
  });
}
