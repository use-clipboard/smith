'use client';

/**
 * BookRecurringModal — manage recurring (memorised) transactions for a book.
 *
 * Lists existing schedules with their next-due date and a one-click "Post" when
 * due (manual, reviewed posting — never auto). New schedules are created from a
 * recent transaction: pick one, set the cadence, and its header + splits become
 * the template. Pause/resume and delete are inline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Repeat, Play, Pause, Trash2, CalendarClock, Plus, ChevronDown, Search } from 'lucide-react';
import DateInput, { fromIso, toIso } from '../input/DateInput';
import { TxnTAccountHover } from './BookNavigationContext';
import {
  RECURRING_FREQUENCY_OPTIONS, RECURRING_FREQUENCY_LABEL, TRANSACTION_TYPE_LABEL,
  type RecurringTransaction, type RecurringFrequency, type Transaction,
} from '@/types/bookkeeping';

type EndMode = 'never' | 'date' | 'count';

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
  // End condition — never / on a date / after a fixed number of occurrences.
  const [endMode, setEndMode] = useState<EndMode>('never');
  const [endDateUk, setEndDateUk] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState(12);

  // "Base it on" custom picker (native <select> can't show the T-account hover).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

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

  // Filter the recent list by ref / details / payee for the picker.
  const filteredRecent = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter(t =>
      `${t.ref_no} ${t.details ?? ''} ${t.payee_text ?? ''}`.toLowerCase().includes(q));
  }, [recent, pickerQuery]);

  // Close the picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

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

    // Resolve the end condition.
    let endDateIso: string | null = null;
    let maxOcc: number | null = null;
    if (endMode === 'date') {
      endDateIso = toIso(endDateUk);
      if (!endDateIso) { setError('Enter a valid end date, or choose “Never ends”.'); return; }
      if (endDateIso < nextIso) { setError('The end date is before the first due date.'); return; }
    } else if (endMode === 'count') {
      if (!maxOccurrences || maxOccurrences < 1) { setError('Enter how many times it should recur.'); return; }
      maxOcc = Math.floor(maxOccurrences);
    }

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
        body: JSON.stringify({
          name: name.trim(), type: srcTxn.type, frequency, interval_count: interval,
          next_due_date: nextIso, end_date: endDateIso, max_occurrences: maxOcc, template,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not create.');
      setShowNew(false); setSrcTxnId(''); setName('');
      setEndMode('never'); setEndDateUk(''); setMaxOccurrences(12); setPickerQuery('');
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
              <div ref={pickerRef} className="relative">
                <span className="text-[11px] font-medium text-slate-500">Base it on</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(o => !o)}
                  className="mt-0.5 w-full flex items-center gap-2 text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white text-left"
                >
                  <span className={`flex-1 truncate ${srcTxn ? 'text-slate-900' : 'text-slate-400'}`}>
                    {srcTxn
                      ? `${srcTxn.ref_no} · ${dateUk(srcTxn.date)} · ${srcTxn.details || srcTxn.payee_text || srcTxn.type} · £${money(Number(srcTxn.total) || 0)}`
                      : 'Select a recent transaction…'}
                  </span>
                  <ChevronDown size={14} className="text-slate-400 shrink-0" />
                </button>
                {pickerOpen && (
                  <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-50 border border-slate-200">
                        <Search size={13} className="text-slate-400" />
                        <input
                          autoFocus
                          value={pickerQuery}
                          onChange={e => setPickerQuery(e.target.value)}
                          placeholder="Search ref or description…"
                          className="w-full bg-transparent text-sm outline-none"
                        />
                      </div>
                    </div>
                    <ul className="max-h-64 overflow-y-auto py-1">
                      {filteredRecent.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-slate-400">No matching transactions.</li>
                      ) : filteredRecent.map(t => (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => { setSrcTxnId(t.id); setPickerOpen(false); setPickerQuery(''); }}
                            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm hover:bg-indigo-50 ${t.id === srcTxnId ? 'bg-indigo-50/60' : ''}`}
                          >
                            <TxnTAccountHover txn={t} initialSplits={t.splits} bookId={bookId}>
                              <span className="font-mono text-indigo-700">{t.ref_no}</span>
                            </TxnTAccountHover>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500 shrink-0">{dateUk(t.date)}</span>
                            <span className="text-slate-700 flex-1 truncate">{t.details || t.payee_text || t.type}</span>
                            <span className="text-slate-900 tabular-nums shrink-0">£{money(Number(t.total) || 0)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-1 text-[10px] text-slate-400">Hover a reference to preview its double-entry.</p>
              </div>
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
                <div className="col-span-2">
                  <span className="text-[11px] font-medium text-slate-500">Ends</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {([['never', 'Never'], ['date', 'On date'], ['count', 'After…']] as [EndMode, string][]).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEndMode(m)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                          endMode === m
                            ? 'border-indigo-300 bg-indigo-100 text-indigo-700 font-medium'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    {endMode === 'date' && (
                      <DateInput
                        value={endDateUk}
                        onChange={setEndDateUk}
                        className="w-40 text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
                      />
                    )}
                    {endMode === 'count' && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={maxOccurrences}
                          onChange={e => setMaxOccurrences(Math.max(1, Number(e.target.value) || 1))}
                          className="w-20 text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
                        />
                        occurrence{maxOccurrences === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {endMode === 'never' && (
                    <p className="mt-1 text-[10px] text-slate-400">Keeps recurring until you pause or delete it.</p>
                  )}
                </div>
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
                      {it.end_date
                        ? ` · ends ${dateUk(it.end_date)}`
                        : it.max_occurrences != null
                          ? ` · ${it.occurrences_posted ?? 0} of ${it.max_occurrences} posted`
                          : ''}
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
