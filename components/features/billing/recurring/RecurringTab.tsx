'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, TrendingUp, RefreshCw, Play, Pause, SkipForward, Pencil, Trash2, Zap, MoreHorizontal } from 'lucide-react';
import { GlassCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence } from '@/lib/billing/totals';
import type { RecurringInvoice } from '@/lib/billing/types';
import { FREQ_LABEL } from '../shared/status';
import { fmtDate } from '../invoices/InvoicesTab';
import NewRecurringDrawer from './NewRecurringDrawer';
import PriceIncreaseModal from './PriceIncreaseModal';

export default function RecurringTab() {
  const [rows, setRows] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringInvoice | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/billing/recurring')
      .then(r => (r.ok ? r.json() : { recurring: [] }))
      .then(d => { setRows(d.recurring ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function action(id: string, action: 'pause' | 'resume' | 'skip') {
    setMenuId(null);
    const r = await fetch(`/api/billing/recurring/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    });
    if (r.ok) { load(); flash(action === 'skip' ? 'Skipped to next date' : action === 'pause' ? 'Paused' : 'Resumed'); }
  }
  async function generateNow(id: string) {
    setMenuId(null);
    const r = await fetch(`/api/billing/recurring/${id}/generate-now`, { method: 'POST' });
    if (r.ok) { const d = await r.json(); load(); flash(d.minted ? 'Invoice generated' : 'Already generated for this date'); }
  }
  async function remove(id: string) {
    setMenuId(null);
    if (!confirm('Delete this recurring schedule? Invoices already generated are kept.')) return;
    const r = await fetch(`/api/billing/recurring/${id}`, { method: 'DELETE' });
    if (r.ok) { load(); flash('Schedule deleted'); }
  }

  const active = rows.filter(r => r.status === 'active');
  const mrrPence = rows.filter(r => r.status === 'active').reduce((s, r) => s + monthlyEquivalent(r), 0);

  return (
    <div className="space-y-3">
      {/* Header actions + MRR */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Recurring revenue (MRR)</p>
            <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{fmtPence(mrrPence)}<span className="text-[13px] font-normal text-[var(--text-muted)]">/mo</span></p>
          </div>
          <div className="h-8 w-px bg-black/10" />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Active schedules</p>
            <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{active.length}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPriceOpen(true)} className="btn-secondary"><TrendingUp size={15} /> Price increase</button>
          <button onClick={() => { setEditing(null); setDrawerOpen(true); }} className="btn-primary"><Plus size={15} /> New recurring</button>
        </div>
      </div>

      {toast && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">{toast}</div>}

      <GlassCard padded={false} className="overflow-hidden">
        <div className="max-h-[calc(100vh-340px)] overflow-y-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Frequency</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 font-semibold">Next invoice</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={i} className="border-b border-black/[0.03]"><td colSpan={6} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-black/[0.05]" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center">
                  <RefreshCw size={30} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
                  <p className="text-sm text-[var(--text-muted)]">No recurring schedules yet.</p>
                  <p className="mx-auto mt-1 max-w-sm text-[12px] text-[var(--text-muted)]">Create one, or turn on billing automation in Proposals so accepted proposals set these up for you.</p>
                  <button onClick={() => { setEditing(null); setDrawerOpen(true); }} className="btn-primary mt-3 mx-auto"><Plus size={15} /> New recurring</button>
                </td></tr>
              ) : (
                rows.map(rec => (
                  <tr key={rec.id} className="border-b border-black/[0.03] hover:bg-[var(--accent)]/[0.03]">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-[var(--text-primary)]">{rec.clientName ?? '—'}</div>
                      {rec.sourceNote && <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--accent)]"><Zap size={10} /> {rec.sourceNote}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{FREQ_LABEL[rec.frequency] ?? rec.frequency}{rec.frequency === 'custom' && rec.intervalDays ? ` (${rec.intervalDays}d)` : ''}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(rec.totalPence)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)]">{fmtDate(rec.nextRunDate)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${rec.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${rec.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {rec.status === 'active' ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="relative inline-block">
                        <button onClick={() => setMenuId(menuId === rec.id ? null : rec.id)} aria-label="Actions" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><MoreHorizontal size={16} /></button>
                        {menuId === rec.id && (
                          <>
                            <div className="fixed inset-0 z-20" onClick={() => setMenuId(null)} />
                            <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-black/5 bg-white py-1 shadow-xl">
                              <MenuItem icon={Zap} label="Generate now" onClick={() => generateNow(rec.id)} />
                              {rec.status === 'active'
                                ? <MenuItem icon={Pause} label="Pause" onClick={() => action(rec.id, 'pause')} />
                                : <MenuItem icon={Play} label="Resume" onClick={() => action(rec.id, 'resume')} />}
                              <MenuItem icon={SkipForward} label="Skip next" onClick={() => action(rec.id, 'skip')} />
                              <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuId(null); setEditing(rec); setDrawerOpen(true); }} />
                              <MenuItem icon={Trash2} label="Delete" danger onClick={() => remove(rec.id)} />
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {drawerOpen && (
        <NewRecurringDrawer existing={editing} onClose={() => setDrawerOpen(false)} onSaved={() => { setDrawerOpen(false); load(); }} />
      )}
      {priceOpen && <PriceIncreaseModal onClose={() => setPriceOpen(false)} onApplied={load} />}
    </div>
  );
}

/** Monthly-equivalent of a schedule's total, for MRR. */
function monthlyEquivalent(rec: RecurringInvoice): number {
  switch (rec.frequency) {
    case 'monthly': return rec.totalPence;
    case 'quarterly': return Math.round(rec.totalPence / 3);
    case 'annual': return Math.round(rec.totalPence / 12);
    case 'custom': return rec.intervalDays ? Math.round((rec.totalPence * 30) / rec.intervalDays) : rec.totalPence;
    default: return rec.totalPence;
  }
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Zap; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/[0.04] ${danger ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}
