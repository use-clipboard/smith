'use client';

import { useEffect, useState } from 'react';
import { Repeat, CalendarRange, Banknote, Clock, Gauge, TrendingUp, FileSignature, AlertTriangle } from 'lucide-react';
import AnimatedDonut, { type DonutSlice } from '@/components/ui/AnimatedDonut';
import { GlassCard, SectionHeader, KpiCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence, fmtPenceCompact } from '@/lib/billing/totals';

interface ReportData {
  mrrPence: number; arrPence: number; revenue12moPence: number; cash12moPence: number;
  outstandingPence: number; badDebtPence: number; debtorDays: number;
  byMonth: { label: string; invoicedPence: number; collectedPence: number }[];
  aged: { current: number; d31_60: number; d61_90: number; d90plus: number };
  topClients: { name: string; pence: number }[];
  byManager: { name: string; pence: number }[];
  byService: { name: string; pence: number }[];
  recovery: { clientId: string; clientName: string; chargeablePence: number; billedPence: number; recoveryRatio: number }[];
  firmRecoveryRatio: number; firmChargeablePence: number; hasTimeData: boolean;
  proposalConversion: { accepted: number; total: number; rate: number };
}

const AGE_COLORS = { current: '#10B981', d31_60: '#6366F1', d61_90: '#F59E0B', d90plus: '#F43F5E' };

function recoveryColor(r: number): string { return r >= 0.9 ? '#10B981' : r >= 0.7 ? '#F59E0B' : '#F43F5E'; }

function BarList({ rows, empty }: { rows: { name: string; pence: number }[]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-[var(--text-muted)]">{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r.pence));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between text-[13px]">
            <span className="truncate text-[var(--text-secondary)]">{r.name}</span>
            <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(r.pence)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(r.pence / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function ReportsTab() {
  const [d, setD] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/billing/reports').then(r => (r.ok ? r.json() : null)).then(data => { setD(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-[20px] bg-white/50" />)}</div>;
  if (!d) return null;

  const agedSlices: DonutSlice[] = [
    { id: 'current', label: '0–30 days', value: d.aged.current, color: AGE_COLORS.current },
    { id: 'd31_60', label: '31–60 days', value: d.aged.d31_60, color: AGE_COLORS.d31_60 },
    { id: 'd61_90', label: '61–90 days', value: d.aged.d61_90, color: AGE_COLORS.d61_90 },
    { id: 'd90plus', label: '90+ days', value: d.aged.d90plus, color: AGE_COLORS.d90plus },
  ];
  const maxMonth = Math.max(1, ...d.byMonth.map(m => Math.max(m.invoicedPence, m.collectedPence)));
  const maxClient = Math.max(1, ...d.topClients.map(c => c.pence));

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="MRR" value={fmtPence(d.mrrPence)} icon={Repeat} tint="#7C3AED" sub="recurring / month" />
        <KpiCard label="ARR" value={fmtPence(d.arrPence)} icon={CalendarRange} tint="#6366F1" sub="annualised" />
        <KpiCard label="Revenue (12m)" value={fmtPence(d.revenue12moPence)} icon={TrendingUp} tint="#8B5CF6" sub="invoiced" />
        <KpiCard label="Collected (12m)" value={fmtPence(d.cash12moPence)} icon={Banknote} tint="#10B981" sub="cash received" />
        <KpiCard label="Debtor days" value={`${d.debtorDays}`} icon={Clock} tint="#F59E0B" sub="avg to pay" />
        <KpiCard label="Recovery" value={d.hasTimeData ? `${Math.round(d.firmRecoveryRatio * 100)}%` : '—'} icon={Gauge} tint="#0EA5E9" sub={d.hasTimeData ? 'billed ÷ time' : 'needs Timesheets'} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <SectionHeader title="Invoiced vs collected" subtitle="Last 12 months" />
          <div className="flex items-end justify-between gap-1.5" style={{ height: 180 }}>
            {d.byMonth.map((m, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 156 }}>
                  <div className="w-1/2 max-w-3 rounded-t bg-[#6366F1]" style={{ height: `${(m.invoicedPence / maxMonth) * 100}%`, minHeight: m.invoicedPence > 0 ? 2 : 0 }} title={`Invoiced ${fmtPenceCompact(m.invoicedPence)}`} />
                  <div className="w-1/2 max-w-3 rounded-t bg-[#10B981]" style={{ height: `${(m.collectedPence / maxMonth) * 100}%`, minHeight: m.collectedPence > 0 ? 2 : 0 }} title={`Collected ${fmtPenceCompact(m.collectedPence)}`} />
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#6366F1]" /> Invoiced</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#10B981]" /> Collected</span>
          </div>
        </GlassCard>

        <GlassCard>
          <SectionHeader title="Aged debtors" />
          <div className="flex items-center gap-4">
            <AnimatedDonut slices={agedSlices} size={150} thickness={22} centerValue={fmtPenceCompact(d.outstandingPence)} centerTitle="Outstanding" formatValue={fmtPence} />
            <div className="flex-1 space-y-1.5">
              {agedSlices.map(s => (
                <div key={s.id} className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                  <span className="font-semibold tabular-nums">{fmtPence(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Top clients + small stats */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <SectionHeader title="Top clients by revenue" subtitle="Invoiced, last 12 months" />
          <div className="space-y-2.5">
            {d.topClients.length === 0 && <p className="text-sm text-[var(--text-muted)]">No revenue yet.</p>}
            {d.topClients.map((c, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="truncate text-[var(--text-secondary)]">{c.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(c.pence)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(c.pence / maxClient) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 gap-4">
          <KpiCard label="Bad debt" value={fmtPence(d.badDebtPence)} icon={AlertTriangle} tint="#F43F5E" sub="written off" />
          <KpiCard label="Proposal conversion" value={d.proposalConversion.total ? `${Math.round(d.proposalConversion.rate * 100)}%` : '—'} icon={FileSignature} tint="#7C3AED" sub={`${d.proposalConversion.accepted}/${d.proposalConversion.total} accepted`} />
        </div>
      </div>

      {/* Revenue by service + team member */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassCard>
          <SectionHeader title="Revenue by service" subtitle="Invoiced (net), last 12 months" />
          <BarList rows={d.byService} empty="No invoice lines yet." />
        </GlassCard>
        <GlassCard>
          <SectionHeader title="Revenue by team member" subtitle="Who raised the invoices, last 12 months" />
          <BarList rows={d.byManager} empty="No invoices raised yet." />
        </GlassCard>
      </div>

      {/* Recovery by client (from Timesheets) */}
      <GlassCard>
        <SectionHeader title="Recovery by client" subtitle="Billed vs chargeable time value · last 12 months · from Timesheets" />
        {!d.hasTimeData ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">No billable time recorded yet. Log time in Timesheets to see real recovery rates here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="py-2 pr-4 font-semibold">Client</th>
                  <th className="py-2 px-4 text-right font-semibold">Chargeable</th>
                  <th className="py-2 px-4 text-right font-semibold">Billed</th>
                  <th className="py-2 pl-4 font-semibold">Recovery</th>
                </tr>
              </thead>
              <tbody>
                {d.recovery.map(r => (
                  <tr key={r.clientId} className="border-b border-black/[0.03]">
                    <td className="py-2 pr-4 font-medium text-[var(--text-primary)]">{r.clientName}</td>
                    <td className="py-2 px-4 text-right tabular-nums text-[var(--text-muted)]">{fmtPence(r.chargeablePence)}</td>
                    <td className="py-2 px-4 text-right tabular-nums text-[var(--text-secondary)]">{fmtPence(r.billedPence)}</td>
                    <td className="py-2 pl-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full" style={{ width: `${Math.min(100, r.recoveryRatio * 100)}%`, background: recoveryColor(r.recoveryRatio) }} /></div>
                        <span className="text-[12px] font-semibold tabular-nums" style={{ color: recoveryColor(r.recoveryRatio) }}>{Math.round(r.recoveryRatio * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
