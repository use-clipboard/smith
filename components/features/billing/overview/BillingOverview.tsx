'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp, FileClock, AlertTriangle, Banknote, CalendarClock, FileEdit,
  Sparkles, RefreshCw, FileSignature, ArrowRight, Plus,
} from 'lucide-react';
import AnimatedDonut, { type DonutSlice } from '@/components/ui/AnimatedDonut';
import { GlassCard, SectionHeader, KpiCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence, fmtPenceCompact } from '@/lib/billing/totals';
import type { BillingOverview as OverviewData, InvoiceStatus } from '@/lib/billing/types';
import { STATUS_META } from '../shared/status';

const AGE_COLORS = { current: '#10B981', d31_60: '#6366F1', d61_90: '#F59E0B', d90plus: '#F43F5E' };

interface Props {
  onNewInvoice: () => void;
  onGoToTab: (tab: string) => void;
}

export default function BillingOverview({ onNewInvoice, onGoToTab }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/billing/overview')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-[20px] bg-white/50" />)}
      </div>
    );
  }

  if (!data || !data.hasData) return <EmptyState onNewInvoice={onNewInvoice} />;

  const draftCount = data.statusCounts.find(s => s.status === 'draft')?.count ?? 0;
  const agedSlices: DonutSlice[] = [
    { id: 'current', label: '0–30 days',  value: data.aged.current, color: AGE_COLORS.current },
    { id: 'd31_60',  label: '31–60 days', value: data.aged.d31_60,  color: AGE_COLORS.d31_60 },
    { id: 'd61_90',  label: '61–90 days', value: data.aged.d61_90,  color: AGE_COLORS.d61_90 },
    { id: 'd90plus', label: '90+ days',   value: data.aged.d90plus, color: AGE_COLORS.d90plus },
  ];
  const daysDelta = data.averageDaysDelta;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Sales this month" value={fmtPence(data.salesThisMonthPence)} icon={TrendingUp} tint="#7C3AED" deltaRatio={data.salesDeltaRatio} sub="vs last month" />
        <KpiCard label="Outstanding" value={fmtPence(data.outstandingPence)} icon={FileClock} tint="#F59E0B" sub={`${data.outstandingCount} invoice${data.outstandingCount !== 1 ? 's' : ''}`} />
        <KpiCard label="Overdue" value={fmtPence(data.overduePence)} icon={AlertTriangle} tint="#F43F5E" sub={`${data.overdueCount} invoice${data.overdueCount !== 1 ? 's' : ''}`} />
        <KpiCard label="Cash received" value={fmtPence(data.cashThisMonthPence)} icon={Banknote} tint="#10B981" sub="this month" />
        <KpiCard label="Avg days to pay" value={`${data.averageDaysToPay}`} icon={CalendarClock} tint="#6366F1" sub={data.averageDaysToPay ? `${daysDelta <= 0 ? '↓' : '↑'}${Math.abs(daysDelta)} vs prior` : 'no history yet'} />
        <KpiCard label="Drafts to send" value={`${draftCount}`} icon={FileEdit} tint="#8B5CF6" sub={draftCount ? 'awaiting send' : 'all sent'} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard>
          <SectionHeader title="Outstanding by age" subtitle="Where the debt sits" />
          <div className="flex items-center gap-5">
            <AnimatedDonut
              slices={agedSlices}
              size={168}
              thickness={24}
              centerValue={fmtPenceCompact(data.outstandingPence)}
              centerTitle="Outstanding"
              formatValue={fmtPence}
            />
            <div className="flex-1 space-y-2">
              {agedSlices.map(s => (
                <div key={s.id} className="flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <SectionHeader title="Cash flow" subtitle="Invoiced vs received · last 6 months" />
          <CashFlowChart data={data.cashFlow} />
        </GlassCard>

        <GlassCard>
          <SectionHeader title="Invoice status" />
          <div className="space-y-1.5">
            {data.statusCounts.length === 0 && <p className="text-sm text-[var(--text-muted)]">No invoices yet.</p>}
            {data.statusCounts
              .slice()
              .sort((a, b) => b.count - a.count)
              .map(s => {
                const m = STATUS_META[s.status as InvoiceStatus];
                return (
                  <div key={s.status} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-black/[0.03]">
                    <span className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                      <span className="h-2 w-2 rounded-full" style={{ background: m.dot }} />
                      {m.label}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-[12px] tabular-nums text-[var(--text-muted)]">{fmtPence(s.totalPence)}</span>
                      <span className="min-w-6 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-center text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">{s.count}</span>
                    </span>
                  </div>
                );
              })}
          </div>
        </GlassCard>
      </div>

      {/* Recent + debtors + AI hero */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-1">
          <SectionHeader
            title="Recent invoices"
            right={<button onClick={() => onGoToTab('invoices')} className="text-[12px] font-semibold text-[var(--accent)] hover:underline">View all</button>}
          />
          <div className="space-y-1">
            {data.recent.map(inv => {
              const m = STATUS_META[inv.status];
              return (
                <div key={inv.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-black/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{inv.number ?? 'Draft'}</p>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">{inv.clientName ?? 'No client'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(inv.totalPence)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.chip}`}>{m.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="lg:col-span-1">
          <SectionHeader title="Top debtors" subtitle="Largest outstanding balances" />
          <div className="space-y-2.5">
            {data.topDebtors.length === 0 && <p className="text-sm text-[var(--text-muted)]">Nothing outstanding — nicely done.</p>}
            {data.topDebtors.map((d, i) => {
              const max = data.topDebtors[0]?.balancePence || 1;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="truncate text-[var(--text-secondary)]">{d.clientName}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(d.balancePence)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(d.balancePence / max) * 100}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[11px] text-[var(--text-muted)]">{d.oldestDays}d old</span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Purple AI credit-control hero */}
        <div className="relative overflow-hidden rounded-[20px] p-5 text-white shadow-[0_8px_32px_rgba(124,58,237,0.35)]"
             style={{ background: 'linear-gradient(135deg,#7C3AED,#6366F1)' }}>
          <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
          <div className="relative">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20"><Sparkles size={16} /></div>
              <h3 className="text-[15px] font-bold">Credit control assistant</h3>
            </div>
            <p className="text-[13px] leading-relaxed text-white/85">
              {data.overdueCount > 0
                ? `${data.overdueCount} invoice${data.overdueCount !== 1 ? 's are' : ' is'} overdue (${fmtPence(data.overduePence)}). SMITH can chase these automatically.`
                : 'No overdue invoices right now — SMITH will flag late payers here as they arise.'}
            </p>
            <button
              onClick={() => onGoToTab('credit_control')}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white/95 px-3.5 py-2 text-[13px] font-semibold text-[var(--accent)] transition hover:bg-white"
            >
              Review credit control <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Automate your billing */}
      <GlassCard>
        <SectionHeader title="Automate your billing" subtitle="Set it once — SMITH does the rest" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <AutomateCard icon={FileSignature} title="Proposal accepted" blurb="Auto-create the client, send the mandate and set up recurring billing." cta="Connect proposals" onClick={() => onGoToTab('recurring')} />
          <AutomateCard icon={RefreshCw} title="Recurring invoices" blurb="Bill fixed fees monthly, quarterly or annually — automatically." cta="Create recurring" onClick={() => onGoToTab('recurring')} />
          <AutomateCard icon={Plus} title="New invoice" blurb="Raise a one-off invoice with live totals and VAT." cta="Create invoice" onClick={onNewInvoice} />
        </div>
      </GlassCard>
    </div>
  );
}

function AutomateCard({ icon: Icon, title, blurb, cta, onClick }: { icon: typeof Plus; title: string; blurb: string; cta: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group rounded-2xl border border-black/5 bg-white/60 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Icon size={17} /></div>
      <p className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">{blurb}</p>
      <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)]">{cta} <ArrowRight size={12} className="transition group-hover:translate-x-0.5" /></span>
    </button>
  );
}

function CashFlowChart({ data }: { data: OverviewData['cashFlow'] }) {
  const max = Math.max(1, ...data.map(d => Math.max(d.invoicedPence, d.paidPence)));
  return (
    <div>
      <div className="flex items-end justify-between gap-2" style={{ height: 150 }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-end justify-center gap-1" style={{ height: 128 }}>
              <div className="w-1/2 max-w-3.5 rounded-t-md bg-[#6366F1] transition-all" style={{ height: `${(d.invoicedPence / max) * 100}%`, minHeight: d.invoicedPence > 0 ? 3 : 0 }} title={`Invoiced ${fmtPenceCompact(d.invoicedPence)}`} />
              <div className="w-1/2 max-w-3.5 rounded-t-md bg-[#10B981] transition-all" style={{ height: `${(d.paidPence / max) * 100}%`, minHeight: d.paidPence > 0 ? 3 : 0 }} title={`Paid ${fmtPenceCompact(d.paidPence)}`} />
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#6366F1]" /> Invoiced</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#10B981]" /> Paid</span>
      </div>
    </div>
  );
}

function EmptyState({ onNewInvoice }: { onNewInvoice: () => void }) {
  return (
    <GlassCard className="mx-auto max-w-lg text-center">
      <div className="flex flex-col items-center gap-3 py-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]"><Banknote size={26} /></div>
        <h3 className="text-lg font-bold text-[var(--text-primary)]">No invoices yet</h3>
        <p className="max-w-sm text-sm text-[var(--text-muted)]">Raise your first invoice and the command centre — revenue, outstanding debt, aged debtors and cash flow — fills in automatically.</p>
        <button onClick={onNewInvoice} className="btn-primary mt-1"><Plus size={15} /> New invoice</button>
      </div>
    </GlassCard>
  );
}
