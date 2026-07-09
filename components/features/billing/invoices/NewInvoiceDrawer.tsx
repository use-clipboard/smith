'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Send, Save } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { computeInvoiceTotals, fmtPence } from '@/lib/billing/totals';

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;   // pounds, as typed
  vatRate: string;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function NewInvoiceDrawer({ onClose, onSaved }: Props) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [defaultVat, setDefaultVat] = useState(20);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(), 14));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ description: '', quantity: '1', unitPrice: '', vatRate: '20' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill VAT + payment terms from firm settings.
  useEffect(() => {
    fetch('/api/billing/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (!s) return;
        setDefaultVat(s.defaultVatRate ?? 20);
        setDueDate(addDaysIso(todayIso(), s.defaultPaymentTermsDays ?? 14));
        setLines(ls => ls.map(l => ({ ...l, vatRate: String(s.defaultVatRate ?? 20) })));
      })
      .catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines(ls => [...ls, { description: '', quantity: '1', unitPrice: '', vatRate: String(defaultVat) }]);
  }
  function removeLine(i: number) {
    setLines(ls => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));
  }

  const parsedLines = lines.map(l => ({
    description: l.description,
    quantity: parseFloat(l.quantity) || 0,
    unitPricePence: Math.round((parseFloat(l.unitPrice) || 0) * 100),
    vatRate: parseFloat(l.vatRate) || 0,
  }));
  const totals = computeInvoiceTotals(parsedLines);
  const canSave = parsedLines.some(l => l.quantity > 0 && l.unitPricePence !== 0);

  async function save(status: 'draft' | 'sent') {
    if (!canSave) { setError('Add at least one line with an amount.'); return; }
    setSaving(true); setError(null);
    const r = await fetch('/api/billing/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientId || null,
        clientName: clientName || null,
        issueDate,
        dueDate,
        notes: notes || null,
        status,
        lines: parsedLines,
      }),
    });
    setSaving(false);
    if (r.ok) { onSaved(); }
    else {
      const d = await r.json().catch(() => null);
      setError(d?.error ?? 'Could not save invoice.');
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[61] flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl animate-slide-in-right">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">New invoice</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
          {/* Client */}
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Client</label>
            <ClientSearchInput
              value={clientId}
              valueName={clientName}
              onChange={(id, name) => { setClientId(id); setClientName(name); }}
              placeholder="Search clients…"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]" /></Field>
            <Field label="Due date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]" /></Field>
          </div>

          {/* Lines */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[var(--text-secondary)]">Lines</label>
              <button onClick={addLine} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add line</button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-black/5 bg-white/60 p-2.5">
                  <input
                    value={l.description}
                    onChange={e => updateLine(i, { description: e.target.value })}
                    placeholder="Description"
                    className="mb-2 w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
                  />
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

          {/* Notes */}
          <Field label="Notes (optional)">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]" />
          </Field>

          {/* Totals */}
          <div className="rounded-xl bg-[var(--accent)]/[0.05] p-3 text-[13px]">
            <Row label="Subtotal" value={fmtPence(totals.subtotalPence)} />
            <Row label="VAT" value={fmtPence(totals.vatPence)} />
            <div className="mt-1 border-t border-black/5 pt-1"><Row label="Total" value={fmtPence(totals.totalPence)} bold /></div>
          </div>

          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={() => save('draft')} disabled={saving || !canSave} className="btn-secondary disabled:opacity-50"><Save size={14} /> Save draft</button>
          <button onClick={() => save('sent')} disabled={saving || !canSave} className="btn-primary ml-auto disabled:opacity-50"><Send size={14} /> Save &amp; mark sent</button>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">{label}</label>
      {children}
    </div>
  );
}

function LineNum({ label, value, onChange, width }: { label: string; value: string; onChange: (v: string) => void; width: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-[var(--text-muted)]">{label}</label>
      <input
        type="number" step="any" value={value} onChange={e => onChange(e.target.value)}
        className={`${width} rounded-lg border border-black/10 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]`}
      />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}
