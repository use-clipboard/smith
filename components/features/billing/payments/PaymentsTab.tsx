'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Banknote, CreditCard, Landmark, FileSpreadsheet, Check, X, ArrowLeft, Plus } from 'lucide-react';
import ReceivePaymentModal from './ReceivePaymentModal';
import { GlassCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence } from '@/lib/billing/totals';
import type { ReconMatch } from '@/lib/billing/reconcile';
import { fmtDate } from '../invoices/InvoicesTab';

interface PaymentRow {
  id: string; method: string; amountPence: number; receivedDate: string;
  reference: string | null; providerRef: string | null; matched: boolean; invoiceNumbers: string[];
}

const METHOD_META: Record<string, { label: string; icon: typeof Banknote; tint: string }> = {
  manual:         { label: 'Manual',        icon: Banknote,   tint: '#6366F1' },
  csv_import:     { label: 'Bank import',   icon: FileSpreadsheet, tint: '#0EA5E9' },
  stripe_card:    { label: 'Card',          icon: CreditCard, tint: '#7C3AED' },
  stripe_bacs_dd: { label: 'Direct Debit',  icon: Landmark,   tint: '#10B981' },
};

// ── CSV helpers ──────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function normDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
function parseAmount(s: string): number {
  const n = parseFloat(s.replace(/[£$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
interface Credit { date: string; description: string; amountPence: number }
function extractCredits(text: string): Credit[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase().trim());
  const findCol = (...keys: string[]) => header.findIndex(h => keys.some(k => h.includes(k)));
  const dateCol = findCol('date');
  const descCol = findCol('description', 'details', 'narrative', 'memo', 'reference', 'payee');
  const inCol = findCol('money in', 'paid in', 'credit', 'received');
  const amtCol = findCol('amount', 'value');
  const credits: Credit[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = normDate(r[dateCol] ?? '') ?? null;
    if (!date) continue;
    const description = (descCol >= 0 ? r[descCol] : '').trim();
    let amountPence = 0;
    if (inCol >= 0 && r[inCol]?.trim()) amountPence = parseAmount(r[inCol]);
    else if (amtCol >= 0) { const a = parseAmount(r[amtCol]); if (a > 0) amountPence = a; } // positive = credit
    if (amountPence > 0) credits.push({ date, description, amountPence });
  }
  return credits;
}

export default function PaymentsTab() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<ReconMatch[] | null>(null);
  const [picks, setPicks] = useState<Record<number, string>>({}); // index → invoiceId ('' = skip)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/billing/payments')
      .then(r => (r.ok ? r.json() : { payments: [] }))
      .then(d => { setPayments(d.payments ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2600); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const credits = extractCredits(text);
    if (credits.length === 0) { flash('No money-in rows found in that CSV.'); return; }
    setBusy(true);
    const r = await fetch('/api/billing/reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'match', credits }),
    });
    setBusy(false);
    if (r.ok) {
      const d = await r.json();
      const ms: ReconMatch[] = d.matches ?? [];
      setMatches(ms);
      const initial: Record<number, string> = {};
      ms.forEach(m => { initial[m.index] = m.suggestedInvoiceId ?? ''; });
      setPicks(initial);
    } else flash('Could not match transactions.');
  }

  async function confirmMatches() {
    if (!matches) return;
    const confirmations = matches
      .filter(m => picks[m.index])
      .map(m => ({ invoiceId: picks[m.index], amountPence: m.credit.amountPence, receivedDate: m.credit.date, reference: m.credit.description.slice(0, 180) }));
    if (confirmations.length === 0) { flash('Select at least one match to record.'); return; }
    setBusy(true);
    const r = await fetch('/api/billing/reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', confirmations }),
    });
    setBusy(false);
    if (r.ok) { const d = await r.json(); setMatches(null); setPicks({}); load(); flash(`${d.recorded} payment${d.recorded !== 1 ? 's' : ''} recorded`); }
    else flash('Could not record payments.');
  }

  // ── Reconciliation review ──────────────────────────────────────────────────
  if (matches) {
    const selectedCount = matches.filter(m => picks[m.index]).length;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => { setMatches(null); setPicks({}); }} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={15} /> Back to payments</button>
          <button onClick={confirmMatches} disabled={busy || selectedCount === 0} className="btn-primary disabled:opacity-50"><Check size={15} /> Record {selectedCount} match{selectedCount !== 1 ? 'es' : ''}</button>
        </div>
        <p className="text-[13px] text-[var(--text-muted)]">{matches.length} money-in line{matches.length !== 1 ? 's' : ''} found. Confirm or adjust the suggested invoice for each, then record.</p>
        <GlassCard padded={false} className="overflow-hidden">
          <div className="max-h-[calc(100vh-360px)] overflow-y-auto scrollbar-thin">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
                <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Bank narrative</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Match to invoice</th>
                  <th className="px-4 py-2.5 font-semibold">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {matches.map(m => (
                  <tr key={m.index} className="border-b border-black/[0.03]">
                    <td className="px-4 py-2.5 text-[var(--text-muted)]">{fmtDate(m.credit.date)}</td>
                    <td className="px-4 py-2.5 max-w-[280px] truncate text-[var(--text-secondary)]">{m.credit.description || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--text-primary)]">{fmtPence(m.credit.amountPence)}</td>
                    <td className="px-4 py-2.5">
                      <select value={picks[m.index] ?? ''} onChange={e => setPicks(p => ({ ...p, [m.index]: e.target.value }))} className="w-full max-w-[240px] rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--accent)]">
                        <option value="">— skip —</option>
                        {m.candidates.map(c => <option key={c.id} value={c.id}>{c.number ?? 'Draft'} · {c.clientName ?? '—'} · {fmtPence(c.balancePence)}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5"><ConfidenceBadge c={m.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── Payments list ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--text-muted)]">Every payment received — manual, card, Direct Debit or imported from your bank.</p>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          <button onClick={() => setReceiveOpen(true)} className="btn-secondary"><Plus size={15} /> Receive payment</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary disabled:opacity-50"><Upload size={15} /> Import bank CSV</button>
        </div>
      </div>

      {toast && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">{toast}</div>}

      <GlassCard padded={false} className="overflow-hidden">
        <div className="max-h-[calc(100vh-320px)] overflow-y-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Method</th>
                <th className="px-4 py-2.5 font-semibold">Invoice</th>
                <th className="px-4 py-2.5 font-semibold">Reference</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }, (_, i) => <tr key={i} className="border-b border-black/[0.03]"><td colSpan={5} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-black/[0.05]" /></td></tr>)
              ) : payments.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16 text-center">
                  <Banknote size={30} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
                  <p className="text-sm text-[var(--text-muted)]">No payments yet.</p>
                  <p className="mx-auto mt-1 max-w-sm text-[12px] text-[var(--text-muted)]">Record a payment from an invoice, or import your bank CSV and let SMITH match the money in.</p>
                </td></tr>
              ) : (
                payments.map(p => {
                  const m = METHOD_META[p.method] ?? METHOD_META.manual;
                  const Icon = m.icon;
                  return (
                    <tr key={p.id} className="border-b border-black/[0.03] hover:bg-[var(--accent)]/[0.03]">
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{fmtDate(p.receivedDate)}</td>
                      <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]"><Icon size={14} style={{ color: m.tint }} /> {m.label}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.invoiceNumbers.length ? p.invoiceNumbers.join(', ') : <span className="text-[var(--text-muted)] italic">unallocated</span>}</td>
                      <td className="px-4 py-2.5 max-w-[240px] truncate text-[var(--text-muted)]">{p.reference ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{fmtPence(p.amountPence)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {receiveOpen && (
        <ReceivePaymentModal
          onClose={() => setReceiveOpen(false)}
          onDone={msg => { setReceiveOpen(false); load(); flash(msg); }}
        />
      )}
    </div>
  );
}

function ConfidenceBadge({ c }: { c: ReconMatch['confidence'] }) {
  const map = {
    high:   { label: 'High',   cls: 'bg-emerald-50 text-emerald-600' },
    medium: { label: 'Review', cls: 'bg-amber-50 text-amber-600' },
    none:   { label: 'No match', cls: 'bg-slate-100 text-slate-500' },
  };
  const m = map[c];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{c === 'none' ? <X size={10} /> : <Check size={10} />}{m.label}</span>;
}
