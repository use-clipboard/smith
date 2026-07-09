'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Zap, ArrowRight, CheckCircle2 } from 'lucide-react';
import { GlassCard, KpiCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence } from '@/lib/billing/totals';
import { fmtDate } from '../invoices/InvoicesTab';
import CreditActionPanel from './CreditActionPanel';

interface AttentionItem {
  id: string; number: string | null; clientName: string | null; balancePence: number;
  dueDate: string | null; daysOverdue: number; reminders: number;
  lastReminder: { stageName: string | null; at: string } | null;
  promiseDate: string | null; promiseOpen: boolean; autoChase: boolean;
  risk: 'low' | 'medium' | 'high';
}
interface Overview {
  outstandingPence: number; overduePence: number; overdueCount: number;
  promisesOpen: number; autoChaseEnabled: boolean; needsAttention: AttentionItem[];
}

const RISK_META = {
  low:    { label: 'Low',    cls: 'bg-emerald-50 text-emerald-600' },
  medium: { label: 'Medium', cls: 'bg-amber-50 text-amber-600' },
  high:   { label: 'High',   cls: 'bg-rose-50 text-rose-600' },
};

interface Props { onGoToSettings: () => void }

export default function CreditControlTab({ onGoToSettings }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AttentionItem | null>(null);

  const load = useCallback(() => {
    fetch('/api/billing/credit-control/overview')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  if (loading) {
    return <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-[20px] bg-white/50" />)}</div>;
  }
  if (!data) return null;

  const items = data.needsAttention;

  return (
    <div className="space-y-4">
      {/* Auto-chase status banner */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${data.autoChaseEnabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${data.autoChaseEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
            {data.autoChaseEnabled ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
          </div>
          <div>
            <p className="text-[14px] font-bold text-[var(--text-primary)]">{data.autoChaseEnabled ? 'Auto-chaser is on' : 'Auto-chaser is off'}</p>
            <p className="text-[12px] text-[var(--text-muted)]">{data.autoChaseEnabled ? 'SMITH sends overdue reminders automatically on your schedule.' : 'Turn it on to chase overdue invoices automatically.'}</p>
          </div>
        </div>
        <button onClick={onGoToSettings} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)] hover:underline">Configure chaser <ArrowRight size={14} /></button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Outstanding" value={fmtPence(data.outstandingPence)} icon={Zap} tint="#7C3AED" />
        <KpiCard label="Overdue" value={fmtPence(data.overduePence)} icon={ShieldAlert} tint="#F43F5E" sub={`${data.overdueCount} invoice${data.overdueCount !== 1 ? 's' : ''}`} />
        <KpiCard label="Needs attention" value={`${items.length}`} icon={ShieldCheck} tint="#F59E0B" sub="overdue to action" />
        <KpiCard label="Promises to pay" value={`${data.promisesOpen}`} icon={CheckCircle2} tint="#10B981" sub="open" />
      </div>

      {/* Needs attention */}
      <GlassCard padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
          <h3 className="text-[14px] font-bold text-[var(--text-primary)]">Needs attention</h3>
          <span className="text-[12px] text-[var(--text-muted)]">Most overdue first</span>
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <CheckCircle2 size={30} className="mx-auto mb-2 text-emerald-500 opacity-70" />
            <p className="text-sm text-[var(--text-muted)]">Nothing overdue — every invoice is on track.</p>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-420px)] overflow-y-auto scrollbar-thin">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
                <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2.5 font-semibold">Client / invoice</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                  <th className="px-4 py-2.5 font-semibold">Overdue</th>
                  <th className="px-4 py-2.5 font-semibold">Last reminder</th>
                  <th className="px-4 py-2.5 font-semibold">Risk</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} onClick={() => setSelected(it)} className="cursor-pointer border-b border-black/[0.03] transition hover:bg-[var(--accent)]/[0.04]">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-[var(--text-primary)]">{it.clientName ?? '—'}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {it.number ?? 'Draft'}
                        {!it.autoChase && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-500">chasing paused</span>}
                        {it.promiseOpen && <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">promised {it.promiseDate ? fmtDate(it.promiseDate) : ''}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(it.balancePence)}</td>
                    <td className="px-4 py-2.5"><span className={it.daysOverdue > 30 ? 'font-semibold text-rose-600' : 'text-[var(--text-secondary)]'}>{it.daysOverdue}d</span></td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)]">{it.lastReminder ? `${it.lastReminder.stageName ?? 'Reminder'} · ${new Date(it.lastReminder.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : <span className="italic">none yet</span>}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RISK_META[it.risk].cls}`}>{RISK_META[it.risk].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {selected && (
        <CreditActionPanel
          invoice={{ id: selected.id, number: selected.number, clientName: selected.clientName, balancePence: selected.balancePence, daysOverdue: selected.daysOverdue, autoChase: selected.autoChase }}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
