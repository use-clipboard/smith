'use client';

import { useEffect, useState } from 'react';
import { X, Mail, Phone, CalendarClock, StickyNote, AlertTriangle, Pause, Play, Send, Check } from 'lucide-react';
import { fmtPence } from '@/lib/billing/totals';
import type { CreditControlEvent, CreditControlEventType } from '@/lib/billing/types';
import { fmtDate } from '../invoices/InvoicesTab';

interface InvoiceMeta { id: string; number: string | null; clientName: string | null; balancePence: number; daysOverdue: number; autoChase: boolean }
interface Props { invoice: InvoiceMeta; onClose: () => void; onChanged: () => void }

type Mode = 'call' | 'promise' | 'note';

const EVENT_META: Record<CreditControlEventType, { icon: typeof Mail; label: string; tint: string }> = {
  reminder_sent:  { icon: Mail,          label: 'Reminder sent',   tint: '#6366F1' },
  call_logged:    { icon: Phone,         label: 'Call logged',     tint: '#0EA5E9' },
  promise_to_pay: { icon: CalendarClock, label: 'Promise to pay',  tint: '#F59E0B' },
  escalated:      { icon: AlertTriangle, label: 'Escalated',       tint: '#F43F5E' },
  note:           { icon: StickyNote,    label: 'Note',            tint: '#8B5CF6' },
  paused:         { icon: Pause,         label: 'Chasing paused',  tint: '#94A3B8' },
  resumed:        { icon: Play,          label: 'Chasing resumed', tint: '#10B981' },
};

export default function CreditActionPanel({ invoice, onClose, onChanged }: Props) {
  const [events, setEvents] = useState<CreditControlEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('call');
  const [note, setNote] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseAmount, setPromiseAmount] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [autoChase, setAutoChase] = useState(invoice.autoChase);

  function loadEvents() {
    fetch(`/api/billing/credit-control/events?invoiceId=${invoice.id}`)
      .then(r => (r.ok ? r.json() : { events: [] }))
      .then(d => setEvents(d.events ?? []))
      .catch(() => {});
  }
  useEffect(loadEvents, [invoice.id]);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2200); }

  async function sendReminder() {
    setBusy(true);
    const r = await fetch('/api/billing/credit-control/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.id }),
    });
    setBusy(false);
    const d = await r.json().catch(() => null);
    if (r.ok) { flash(`Reminder sent${d?.stageName ? ` — ${d.stageName}` : ''}`); loadEvents(); onChanged(); }
    else flash(d?.error ?? 'Could not send');
  }

  async function logEvent(type: CreditControlEventType, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const r = await fetch('/api/billing/credit-control/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: invoice.id, type, ...extra }),
    });
    setBusy(false);
    if (r.ok) { setNote(''); setPromiseDate(''); setPromiseAmount(''); loadEvents(); onChanged(); }
  }

  async function submitActivity() {
    if (mode === 'call') { if (!note.trim()) return; await logEvent('call_logged', { note }); flash('Call logged'); }
    else if (mode === 'note') { if (!note.trim()) return; await logEvent('note', { note }); flash('Note added'); }
    else if (mode === 'promise') {
      if (!promiseDate) return;
      await logEvent('promise_to_pay', { promisedDate: promiseDate, promisedAmountPence: promiseAmount ? Math.round(parseFloat(promiseAmount) * 100) : null, note: note || null });
      flash('Promise recorded — chasing paused until then');
    }
  }

  async function togglePause() {
    const next = !autoChase;
    setAutoChase(next);
    await logEvent(next ? 'resumed' : 'paused');
    flash(next ? 'Chasing resumed' : 'Chasing paused');
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[61] flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl animate-slide-in-right">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold text-[var(--text-primary)]">{invoice.number ?? 'Invoice'} · Credit control</h3>
            <p className="text-[12px] text-[var(--text-muted)]">{invoice.clientName ?? '—'} · {fmtPence(invoice.balancePence)} · {invoice.daysOverdue}d overdue</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        {toast && <div className="mx-5 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">{toast}</div>}

        {/* Actions */}
        <div className="border-b border-black/5 px-5 py-4">
          <div className="flex gap-2">
            <button onClick={sendReminder} disabled={busy} className="btn-primary flex-1 justify-center disabled:opacity-50"><Send size={14} /> Send reminder</button>
            <button onClick={togglePause} disabled={busy} className="btn-secondary">{autoChase ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}</button>
          </div>

          <div className="mt-3 rounded-xl border border-black/5 bg-white/60 p-3">
            <div className="mb-2 inline-flex gap-1 rounded-lg bg-black/[0.04] p-0.5">
              {(['call', 'promise', 'note'] as Mode[]).map(m => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold capitalize transition ${mode === m ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                  {m === 'promise' ? 'Promise to pay' : m === 'call' ? 'Log call' : 'Note'}
                </button>
              ))}
            </div>
            {mode === 'promise' && (
              <div className="mb-2 flex gap-2">
                <input type="date" value={promiseDate} onChange={e => setPromiseDate(e.target.value)} className="h-9 flex-1 rounded-lg border border-black/10 px-2.5 text-[13px] outline-none focus:border-[var(--accent)]" />
                <input type="number" step="0.01" placeholder="£ amount" value={promiseAmount} onChange={e => setPromiseAmount(e.target.value)} className="h-9 w-28 rounded-lg border border-black/10 px-2.5 text-[13px] outline-none focus:border-[var(--accent)]" />
              </div>
            )}
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={mode === 'call' ? 'What was discussed?' : mode === 'promise' ? 'Optional note…' : 'Add a note…'} className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]" />
            <div className="mt-2 flex justify-end">
              <button onClick={submitActivity} disabled={busy} className="btn-secondary disabled:opacity-50"><Check size={14} /> Save</button>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Activity</p>
          {events.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map(e => {
                const m = EVENT_META[e.type];
                const Icon = m.icon;
                return (
                  <div key={e.id} className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: `${m.tint}1f`, color: m.tint }}><Icon size={14} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--text-primary)]">
                        {m.label}{e.stageName ? ` — ${e.stageName}` : ''}
                        {e.type === 'promise_to_pay' && e.promisedDate ? ` — ${e.promisedAmountPence ? fmtPence(e.promisedAmountPence) + ' ' : ''}by ${fmtDate(e.promisedDate)}` : ''}
                      </p>
                      {e.subject && <p className="truncate text-[12px] text-[var(--text-muted)]">{e.subject}</p>}
                      {e.note && <p className="text-[12px] text-[var(--text-secondary)]">{e.note}</p>}
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{new Date(e.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{e.createdBy === null ? ' · automatic' : ''}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
