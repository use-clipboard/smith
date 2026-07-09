'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { computeInvoiceTotals, fmtPence } from '@/lib/billing/totals';
import type { RecurringInvoice, RecurrenceFrequency } from '@/lib/billing/types';

interface LineDraft { description: string; quantity: string; unitPrice: string; vatRate: string }

interface Props {
  existing?: RecurringInvoice | null;
  onClose: () => void;
  onSaved: () => void;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

const FREQS: { id: RecurrenceFrequency; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual', label: 'Annual' },
  { id: 'custom', label: 'Custom' },
];

export default function NewRecurringDrawer({ existing, onClose, onSaved }: Props) {
  const editing = !!existing;
  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  const [clientName, setClientName] = useState(existing?.clientName ?? '');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(existing?.frequency ?? 'monthly');
  const [intervalDays, setIntervalDays] = useState(String(existing?.intervalDays ?? 30));
  const [dayOfMonth, setDayOfMonth] = useState(existing?.dayOfMonth ? String(existing.dayOfMonth) : '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayIso());
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [autoSend, setAutoSend] = useState(existing?.autoSend ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    existing?.template?.length
      ? existing.template.map(l => ({ description: l.description, quantity: String(l.quantity), unitPrice: (l.unitPricePence / 100).toString(), vatRate: String(l.vatRate) }))
      : [{ description: '', quantity: '1', unitPrice: '', vatRate: '20' }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<LineDraft>) { setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  function addLine() { setLines(ls => [...ls, { description: '', quantity: '1', unitPrice: '', vatRate: '20' }]); }
  function removeLine(i: number) { setLines(ls => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i))); }

  const parsedLines = lines.map(l => ({
    description: l.description,
    quantity: parseFloat(l.quantity) || 0,
    unitPricePence: Math.round((parseFloat(l.unitPrice) || 0) * 100),
    vatRate: parseFloat(l.vatRate) || 0,
  }));
  const totals = computeInvoiceTotals(parsedLines);
  const canSave = parsedLines.some(l => l.quantity > 0 && l.unitPricePence !== 0);

  async function save() {
    if (!canSave) { setError('Add at least one line with an amount.'); return; }
    setSaving(true); setError(null);

    const dom = dayOfMonth.trim() ? Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 1)) : null;
    let r: Response;
    if (editing && existing) {
      r = await fetch(`/api/billing/recurring/${existing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: clientName || null, dayOfMonth: dom, endDate: endDate || null, autoSend, notes: notes || null, lines: parsedLines }),
      });
    } else {
      r = await fetch('/api/billing/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId || null, clientName: clientName || null, frequency,
          intervalDays: frequency === 'custom' ? (parseInt(intervalDays, 10) || 30) : null,
          dayOfMonth: dom, startDate, endDate: endDate || null, autoSend, notes: notes || null, lines: parsedLines,
        }),
      });
    }
    setSaving(false);
    if (r.ok) onSaved();
    else { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not save schedule.'); }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[61] flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl animate-slide-in-right">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{editing ? 'Edit recurring invoice' : 'New recurring invoice'}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Client</label>
            <ClientSearchInput value={clientId} valueName={clientName} onChange={(id, name) => { setClientId(id); setClientName(name); }} placeholder="Search clients…" disabled={editing} />
            {editing && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Client and frequency are fixed once a schedule exists — delete and recreate to change them.</p>}
          </div>

          {/* Frequency */}
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Frequency</label>
            <div className="flex flex-wrap gap-1.5">
              {FREQS.map(f => (
                <button key={f.id} onClick={() => !editing && setFrequency(f.id)} disabled={editing}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${frequency === f.id ? 'bg-[var(--accent)] text-white' : 'bg-black/[0.04] text-[var(--text-muted)] hover:bg-black/[0.07]'} ${editing ? 'opacity-70' : ''}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {frequency === 'custom' && !editing && (
              <div className="mt-2 flex items-center gap-2 text-[13px]">
                <span className="text-[var(--text-muted)]">Every</span>
                <input type="number" min={1} value={intervalDays} onChange={e => setIntervalDays(e.target.value)} className="w-20 rounded-lg border border-black/10 px-2 py-1.5 outline-none focus:border-[var(--accent)]" />
                <span className="text-[var(--text-muted)]">days</span>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <Field label={editing ? 'Next invoice' : 'First invoice'}>
              <input type="date" value={editing ? (existing?.nextRunDate ?? startDate) : startDate} onChange={e => setStartDate(e.target.value)} disabled={editing} className={inputCls(editing)} />
            </Field>
            <Field label="End date (optional)"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls(false)} /></Field>
            <Field label="Day of month"><input type="number" min={1} max={28} placeholder="—" value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)} className={inputCls(false)} /></Field>
          </div>

          {/* Auto-send */}
          <button onClick={() => setAutoSend(v => !v)} className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white/60 p-3 text-left">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">Auto-send generated invoices</p>
              <p className="text-[11px] text-[var(--text-muted)]">On: each invoice is issued (numbered) automatically. Off: created as a draft for you to review.</p>
            </div>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${autoSend ? 'bg-[var(--accent)]' : 'bg-black/15'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoSend ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>

          {/* Lines */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[var(--text-secondary)]">Lines</label>
              <button onClick={addLine} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add line</button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-black/5 bg-white/60 p-2.5">
                  <input value={l.description} onChange={e => updateLine(i, { description: e.target.value })} placeholder="Description" className="mb-2 w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]" />
                  <div className="flex items-center gap-2">
                    <LineNum label="Qty" value={l.quantity} onChange={v => updateLine(i, { quantity: v })} width="w-14" />
                    <LineNum label="Unit £" value={l.unitPrice} onChange={v => updateLine(i, { unitPrice: v })} width="w-24" />
                    <LineNum label="VAT %" value={l.vatRate} onChange={v => updateLine(i, { vatRate: v })} width="w-16" />
                    <div className="ml-auto text-right">
                      <p className="text-[10px] uppercase text-[var(--text-muted)]">Line total</p>
                      <p className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(totals.lines[i]?.grossPence ?? 0)}</p>
                    </div>
                    <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5 disabled:opacity-30"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Field label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]" /></Field>

          <div className="rounded-xl bg-[var(--accent)]/[0.05] p-3 text-[13px]">
            <Row label="Subtotal" value={fmtPence(totals.subtotalPence)} />
            <Row label="VAT" value={fmtPence(totals.vatPence)} />
            <div className="mt-1 border-t border-black/5 pt-1"><Row label={`Total per ${frequency === 'custom' ? 'cycle' : frequency.replace('ly', '')}`} value={fmtPence(totals.totalPence)} bold /></div>
          </div>

          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={save} disabled={saving || !canSave} className="btn-primary ml-auto disabled:opacity-50">
            {editing ? <Save size={14} /> : <RefreshCw size={14} />} {saving ? 'Saving…' : editing ? 'Save changes' : 'Create schedule'}
          </button>
        </div>
      </aside>
    </>
  );
}

function inputCls(disabled: boolean) {
  return `w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)] ${disabled ? 'opacity-60' : ''}`;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">{label}</label>{children}</div>;
}
function LineNum({ label, value, onChange, width }: { label: string; value: string; onChange: (v: string) => void; width: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-[var(--text-muted)]">{label}</label>
      <input type="number" step="any" value={value} onChange={e => onChange(e.target.value)} className={`${width} rounded-lg border border-black/10 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]`} />
    </div>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-bold capitalize text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}
