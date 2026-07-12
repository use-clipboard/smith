'use client';

import { useState } from 'react';
import { X, Clock, Loader2, FileText } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { fmtPence } from '@/lib/billing/totals';
import { fmtDate } from './InvoicesTab';

interface Entry { id: string; date: string; activity: string; minutes: number; valuePence: number }
type Grouping = 'entry' | 'activity' | 'single';

export default function BillFromTimeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (msg: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [grouping, setGrouping] = useState<Grouping>('activity');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickClient(id: string, name: string) {
    setClientId(id); setClientName(name); setEntries(null); setExcluded(new Set()); setError(null);
    if (!id) return;
    setLoading(true);
    fetch(`/api/billing/bill-from-time?clientId=${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setEntries(d?.entries ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }
  function toggle(id: string) { setExcluded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  const selected = (entries ?? []).filter(e => !excluded.has(e.id));
  const selMinutes = selected.reduce((s, e) => s + e.minutes, 0);
  const selValue = selected.reduce((s, e) => s + e.valuePence, 0);

  async function create() {
    if (selected.length === 0) return;
    setCreating(true); setError(null);
    const r = await fetch('/api/billing/bill-from-time', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientName, entryIds: selected.map(e => e.id), grouping }),
    });
    setCreating(false);
    if (r.ok) { const d = await r.json(); onCreated(`Draft invoice created from ${d.billedEntries} time entr${d.billedEntries !== 1 ? 'ies' : 'y'}`); }
    else { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not create the invoice.'); }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[61] flex max-h-[88vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div className="flex items-center gap-2"><Clock size={18} className="text-[var(--accent)]" /><h3 className="text-[16px] font-bold text-[var(--text-primary)]">Bill from time</h3></div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Client</label>
            <ClientSearchInput value={clientId} valueName={clientName} onChange={pickClient} placeholder="Pick a client to bill their unbilled time…" />
          </div>

          {loading && <div className="flex items-center gap-2 py-8 text-[var(--text-muted)]"><Loader2 size={20} className="animate-spin text-[var(--accent)]" /> Finding unbilled time…</div>}

          {entries && !loading && (
            entries.length === 0 ? (
              <div className="rounded-xl bg-black/[0.02] py-8 text-center text-[13px] text-[var(--text-muted)]">No unbilled billable time for this client.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--accent)]/[0.05] px-4 py-3">
                  <span className="text-[13px] text-[var(--text-secondary)]"><b>{selected.length}</b> of {entries.length} entries · <b>{(selMinutes / 60).toFixed(2)}h</b> · <b>{fmtPence(selValue)}</b></span>
                  <div className="flex items-center gap-2">
                    <label className="text-[12px] text-[var(--text-muted)]">Group as</label>
                    <select value={grouping} onChange={e => setGrouping(e.target.value as Grouping)} className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[12.5px] outline-none focus:border-[var(--accent)]">
                      <option value="activity">One line per activity</option>
                      <option value="entry">One line per entry</option>
                      <option value="single">Single line</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-black/5">
                  <div className="max-h-[42vh] overflow-y-auto scrollbar-thin">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-white/95 backdrop-blur"><tr className="border-b border-black/5 text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        <th className="px-3 py-2" /><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Activity</th><th className="px-3 py-2 text-right font-semibold">Hours</th><th className="px-3 py-2 text-right font-semibold">Value</th>
                      </tr></thead>
                      <tbody>
                        {entries.map(e => (
                          <tr key={e.id} className={`border-b border-black/[0.03] ${excluded.has(e.id) ? 'opacity-40' : ''}`}>
                            <td className="px-3 py-1.5"><input type="checkbox" checked={!excluded.has(e.id)} onChange={() => toggle(e.id)} /></td>
                            <td className="px-3 py-1.5 text-[var(--text-muted)]">{fmtDate(e.date)}</td>
                            <td className="px-3 py-1.5 text-[var(--text-secondary)]">{e.activity}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{(e.minutes / 60).toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-[var(--text-primary)]">{fmtPence(e.valuePence)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          )}

          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={create} disabled={creating || selected.length === 0} className="btn-primary disabled:opacity-50"><FileText size={14} /> {creating ? 'Creating…' : `Create draft (${fmtPence(selValue)})`}</button>
        </div>
      </div>
    </>
  );
}
