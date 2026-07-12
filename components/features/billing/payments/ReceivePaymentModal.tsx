'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Banknote, Loader2, Wand2 } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { fmtPence } from '@/lib/billing/totals';
import type { Invoice } from '@/lib/billing/types';
import { fmtDate } from '../invoices/InvoicesTab';

const OUTSTANDING = ['sent', 'viewed', 'part_paid', 'overdue'];
function toPence(s: string): number { const n = parseFloat(s); return Number.isFinite(n) ? Math.round(n * 100) : 0; }

export default function ReceivePaymentModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [total, setTotal] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preference, setPreference] = useState<'oldest' | 'newest'>('oldest');

  useEffect(() => {
    fetch('/api/billing/settings').then(r => (r.ok ? r.json() : null)).then(s => { if (s?.allocationPreference) setPreference(s.allocationPreference); }).catch(() => {});
  }, []);

  function pick(id: string, name: string) {
    setClientId(id); setClientName(name); setInvoices(null); setAlloc({}); setError(null);
    if (!id) return;
    setLoading(true);
    fetch(`/api/billing/client-summary?clientId=${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const outstanding = ((d?.invoices ?? []) as Invoice[])
          .filter(i => OUTSTANDING.includes(i.status) && i.balancePence > 0)
          .sort((a, b) => preference === 'oldest' ? (a.issueDate ?? '').localeCompare(b.issueDate ?? '') : (b.issueDate ?? '').localeCompare(a.issueDate ?? ''));
        setInvoices(outstanding); setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  const outstanding = invoices ?? [];
  const allocatedPence = useMemo(() => Object.values(alloc).reduce((s, v) => s + toPence(v), 0), [alloc]);
  const totalPence = toPence(total);
  const amountPence = Math.max(totalPence, allocatedPence);
  const unallocated = amountPence - allocatedPence;

  function autoAllocate() {
    let remaining = totalPence > 0 ? totalPence : outstanding.reduce((s, i) => s + i.balancePence, 0);
    const next: Record<string, string> = {};
    let allocated = 0;
    for (const inv of outstanding) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, inv.balancePence);
      next[inv.id] = (take / 100).toFixed(2);
      remaining -= take; allocated += take;
    }
    setAlloc(next);
    if (totalPence <= 0) setTotal((allocated / 100).toFixed(2));
  }

  async function record() {
    const allocations = outstanding
      .map(i => ({ invoiceId: i.id, amountPence: toPence(alloc[i.id] ?? '') }))
      .filter(a => a.amountPence > 0);
    if (allocations.length === 0) { setError('Allocate the payment to at least one invoice.'); return; }
    if (allocatedPence > amountPence) { setError('Allocated more than received.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/billing/payments/allocate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountPence, receivedDate: date, method: 'manual', reference: reference || null, allocations }),
    });
    setBusy(false);
    if (r.ok) { const d = await r.json(); onDone(`Payment recorded across ${d.applied} invoice${d.applied !== 1 ? 's' : ''}`); }
    else { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not record payment.'); }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[61] flex max-h-[88vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div className="flex items-center gap-2"><Banknote size={18} className="text-[var(--accent)]" /><h3 className="text-[16px] font-bold text-[var(--text-primary)]">Receive payment</h3></div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Client</label>
            <ClientSearchInput value={clientId} valueName={clientName} onChange={pick} placeholder="Pick a client…" />
          </div>

          {clientId && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Amount received (£)</label>
                <input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} className="w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Date received</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Reference</label>
                <input value={reference} onChange={e => setReference(e.target.value)} placeholder="optional" className="w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
              </div>
            </div>
          )}

          {loading && <div className="flex items-center gap-2 py-6 text-[var(--text-muted)]"><Loader2 size={20} className="animate-spin text-[var(--accent)]" /> Loading outstanding invoices…</div>}

          {invoices && !loading && (
            outstanding.length === 0 ? (
              <div className="rounded-xl bg-black/[0.02] py-8 text-center text-[13px] text-[var(--text-muted)]">Nothing outstanding for this client.</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Allocate to invoices</span>
                  <button onClick={autoAllocate} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Wand2 size={13} /> Auto-allocate ({preference} first)</button>
                </div>
                <div className="overflow-hidden rounded-xl border border-black/5">
                  <table className="w-full text-[13px]">
                    <thead><tr className="border-b border-black/5 text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                      <th className="px-3 py-2 font-semibold">Invoice</th><th className="px-3 py-2 font-semibold">Due</th><th className="px-3 py-2 text-right font-semibold">Balance</th><th className="px-3 py-2 text-right font-semibold">Allocate £</th>
                    </tr></thead>
                    <tbody>
                      {outstanding.map(inv => (
                        <tr key={inv.id} className="border-b border-black/[0.03]">
                          <td className="px-3 py-1.5 font-semibold text-[var(--text-primary)]">{inv.number ?? 'Draft'}</td>
                          <td className="px-3 py-1.5 text-[var(--text-muted)]">{fmtDate(inv.dueDate)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtPence(inv.balancePence)}</td>
                          <td className="px-3 py-1.5 text-right">
                            <input type="number" step="0.01" value={alloc[inv.id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [inv.id]: e.target.value }))} placeholder="0.00" className="w-24 rounded-lg border border-black/10 px-2 py-1 text-right text-[13px] outline-none focus:border-[var(--accent)]" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-end gap-4 text-[13px]">
                  <span className="text-[var(--text-muted)]">Allocated <b className="tabular-nums text-[var(--text-primary)]">{fmtPence(allocatedPence)}</b></span>
                  {unallocated > 0 && <span className="text-amber-600">On account <b className="tabular-nums">{fmtPence(unallocated)}</b></span>}
                </div>
              </>
            )
          )}

          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={record} disabled={busy || allocatedPence === 0} className="btn-primary disabled:opacity-50">{busy ? 'Recording…' : `Record ${fmtPence(amountPence)}`}</button>
        </div>
      </div>
    </>
  );
}
