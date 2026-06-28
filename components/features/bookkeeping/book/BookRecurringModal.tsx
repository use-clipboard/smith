'use client';

/**
 * BookRecurringModal — manage recurring (memorised) transactions for a book.
 *
 * Lists existing schedules with their next-due date and a one-click "Post" when
 * due (manual, reviewed posting — never auto). New schedules are created from a
 * recent transaction: pick one, set the cadence, and its header + splits become
 * the template. Pause/resume and delete are inline.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, Repeat, Play, Pause, Trash2, CalendarClock, Plus } from 'lucide-react';
import DateInput, { fromIso, toIso } from '../input/DateInput';
import {
  RECURRING_FREQUENCY_OPTIONS, RECURRING_FREQUENCY_LABEL, TRANSACTION_TYPE_LABEL,
  type RecurringTransaction, type RecurringFrequency, type Transaction,
} from '@/types/bookkeeping';

const money = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateUk = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso;
};

export default function BookRecurringModal({
  bookId, open, onClose, onPosted,
}: { bookId: string; open: boolean; onClose: () => void; onPosted?: () => void }) {
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // New-schedule form.
  const [showNew, setShowNew] = useState(false);
  const [srcTxnId, setSrcTxnId] = useState('');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [interval, setInterval] = useState(1);
  const [nextDueUk, setNextDueUk] = useState(fromIso(new Date().toISOString().slice(0, 10)));

  const base = `/api/bookkeeping/books/${bookId}/recurring`;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rr, tr] = await Promise.all([
        fetch(base).then(r => r.json()),
        fetch(`/api/bookkeeping/books/${bookId}/transactions?limit=50`).then(r => r.json()),
      ]);
      setItems(rr.recurring ?? []);
      setRecent((tr.transactions ?? []) as Transaction[]);
    } catch { setError('Could not load recurring transactions.'); }
    finally { setLoading(false); }
  }, [base, bookId]);

  useEffect(() => { if (open) { setShowNew(false); void load(); } }, [open, load]);

  const srcTxn = useMemo(() => recent.find(t => t.id === srcTxnId) ?? null, [recent, srcTxnId]);
  useEffect(() => {
    if (srcTxn && !name) setName(srcTxn.details || srcTxn.payee_text || `${srcTxn.type} recurring`);
  }, [srcTxn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function postDue(id: string) {
    setBusyId(id); setError('');
    try {
      const r = await fetch(`${base}/${id}/run`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not post.');
      await load(); onPosted?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not post.'); }
    finally { setBusyId(null); }
  }

  async function togglePause(it: RecurringTransaction) {
    setBusyId(it.id);
    try {
      await fetch(`${base}/${it.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !it.active }) });
      await load();
    } finally { setBusyId(null); }
  }

  async function del(id: string) {
    if (!confirm('Delete this recurring transaction? Posted entries are not affected.')) return;
    setBusyId(id);
    try {
      await fetch(`${base}/${id}`, { method: 'DELETE' });
      await load();
    } finally { setBusyId(null); }
  }

  async function create() {
    if (!srcTxn) { setError('Pick a transaction to base it on.'); return; }
    const nextIso = toIso(nextDueUk);
    if (!nextIso) { setError('Enter a valid next-due date.'); return; }
    if (!name.trim()) { setError('Give it a name.'); return; }
    setCreating(true); setError('');
    try {
      const template = {
        payee_text: srcTxn.payee_text ?? null,
        details: srcTxn.details ?? null,
        total: Number(srcTxn.total) || 0,
        vat_total: Number(srcTxn.vat_total) || 0,
        vat_rate: srcTxn.vat_rate ?? null,
        vat_treatment: srcTxn.vat_treatment ?? null,
        primary_account_id: srcTxn.primary_account_id ?? null,
        splits: (srcTxn.splits ?? []).map(s => ({
          account_id: s.account_id, debit: Number(s.debit) || 0, credit: Number(s.credit) || 0,
          entry_details: s.entry_details ?? null, notes: s.notes ?? null, fund_id: s.fund_id ?? null,
        })),
      };
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type: srcTxn.type, frequency, interval_count: interval, next_due_date: nextIso, template }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not create.');
      setShowNew(false); setSrcTxnId(''); setName('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create.'); }
    finally { setCreating(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Repeat size={15} /></span>
          <h2 className="text-sm font-semibold text-slate-900 flex-1">Recurring transactions</h2>
          <button type="button" onClick={() => setShowNew(s => !s)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700">
            <Plus size={13} /> New
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {/* New schedule form */}
          {showNew && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">New recurring — from a recent transaction</div>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Base it on</span>
                <select value={srcTxnId} onChange={e => setSrcTxnId(e.target.value)} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                  <option value="">Select a recent transaction…</option>
                  {recent.map(t => (
                    <option key={t.id} value={t.id}>{t.ref_no} · {dateUk(t.date)} · {t.details || t.payee_text || t.type} · £{money(Number(t.total) || 0)}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block col-span-2">
                  <span className="text-[11px] font-medium text-slate-500">Name</span>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly office rent" className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Frequency</span>
                  <select value={frequency} onChange={e => setFrequency(e.target.value as RecurringFrequency)} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white">
                    {RECURRING_FREQUENCY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Every</span>
                  <input type="number" min={1} max={52} value={interval} onChange={e => setInterval(Math.max(1, Number(e.target.value) || 1))} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Next due</span>
                  <DateInput value={nextDueUk} onChange={setNextDueUk} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white" />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowNew(false)} className="text-xs px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
                <button type="button" onClick={create} disabled={creating} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create
                </button>
              </div>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500">No recurring transactions yet. Click <span className="font-medium">New</span> to memorise one from a recent transaction.</p>
          ) : (
            <ul className="space-y-2">
              {items.map(it => (
                <li key={it.id} className={`rounded-lg border px-3 py-2.5 ${it.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{it.type}</span>
                    <span className="text-sm font-medium text-slate-900 flex-1 truncate">{it.name}</span>
                    {it.is_due && it.active && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">DUE</span>}
                    {!it.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">paused</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <CalendarClock size={12} /> Every {it.interval_count > 1 ? `${it.interval_count} ` : ''}{RECURRING_FREQUENCY_LABEL[it.frequency].toLowerCase()}{it.interval_count > 1 ? 's' : ''} · next {dateUk(it.next_due_date)} · £{money(it.template?.total ?? 0)}
                    </span>
                    <div className="flex-1" />
                    {it.is_due && it.active && (
                      <button type="button" onClick={() => postDue(it.id)} disabled={busyId === it.id}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                        {busyId === it.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Post now
                      </button>
                    )}
                    <button type="button" onClick={() => togglePause(it)} disabled={busyId === it.id} aria-label={it.active ? 'Pause' : 'Resume'} className="text-slate-400 hover:text-slate-700 disabled:opacity-50">
                      {it.active ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button type="button" onClick={() => del(it.id)} disabled={busyId === it.id} aria-label="Delete" className="text-slate-400 hover:text-rose-600 disabled:opacity-50">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50/60 text-[11px] text-slate-400 shrink-0">
          Recurring entries are posted manually — review and click <span className="font-medium text-slate-500">Post now</span> when due. The entry is dated on its due date.
        </div>
      </div>
    </div>
  );
}
