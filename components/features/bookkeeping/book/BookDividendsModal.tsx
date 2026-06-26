'use client';

/**
 * BookDividendsModal — declare dividends for a Ltd book and generate dividend
 * vouchers + board meeting minutes. Phase 3 of docs/people-and-entities.md.
 * The split across shareholders comes from the shareholder participants
 * (People & roles) by their shareholding %.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Banknote, FileText, ScrollText, Trash2, Plus } from 'lucide-react';
import type { Book, BookParticipant } from '@/types/bookkeeping';
import { printReport } from '../reports/printReport';
import { vouchersHtml, minutesHtml, type DividendCompany } from '@/lib/bookkeeping/dividendDocs';

interface Recipient { id: string; name: string; shareholding_pct: number | null; amount: number }
interface Dividend {
  id: string; dividend_type: 'interim' | 'final'; declaration_date: string;
  payment_date: string | null; tax_year: string | null; total_amount: number; notes: string | null;
  recipients: Recipient[];
}

const money = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateUk = (iso: string | null) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };
const todayIso = () => new Date().toISOString().slice(0, 10);
function ukTaxYear(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const start = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

function printDoc(html: string, title: string) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.style.position = 'fixed'; div.style.left = '-99999px'; div.style.top = '0';
  document.body.appendChild(div);
  printReport(div, title);
  setTimeout(() => div.remove(), 2000);
}

export default function BookDividendsModal({ book, open, onClose }: { book: Book; open: boolean; onClose: () => void }) {
  const bookId = book.id;
  const company: DividendCompany = { name: book.client?.name ?? book.name, ref: book.client?.client_ref ?? null };

  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [directors, setDirectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Declare form
  const [showForm, setShowForm] = useState(false);
  const [dtype, setDtype] = useState<'interim' | 'final'>('interim');
  const [declDate, setDeclDate] = useState(todayIso());
  const [payDate, setPayDate] = useState('');
  const [taxYear, setTaxYear] = useState(ukTaxYear(todayIso()));
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, pRes] = await Promise.all([
        fetch(`/api/bookkeeping/books/${bookId}/dividends`),
        fetch(`/api/bookkeeping/books/${bookId}/participants`),
      ]);
      const d = await dRes.json().catch(() => ({}));
      const p = await pRes.json().catch(() => ({}));
      setDividends(d.dividends ?? []);
      setDirectors(((p.participants ?? []) as BookParticipant[]).filter(x => x.role === 'director').map(x => x.name));
    } finally { setLoading(false); }
  }, [bookId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  async function declare() {
    if (!amount.trim() || Number(amount) <= 0) { setError('Enter a dividend amount.'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/dividends`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dividend_type: dtype, declaration_date: declDate,
          payment_date: payDate || null, tax_year: taxYear || null, total_amount: Number(amount),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not declare dividend.');
      setDividends(prev => [d.dividend, ...prev]);
      setShowForm(false); setAmount(''); setPayDate('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not declare dividend.');
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this dividend declaration?')) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/dividends/${id}`, { method: 'DELETE' });
    if (r.ok) setDividends(prev => prev.filter(d => d.id !== id));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Banknote size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Dividends</h2>
            <p className="text-[11px] text-slate-500">Declare dividends &amp; generate vouchers and minutes for {company.name}</p>
          </div>
          <button type="button" onClick={() => setShowForm(v => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            <Plus size={13} /> Declare
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {showForm && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-[11px] font-medium text-slate-500">Type</span>
                  <select value={dtype} onChange={e => setDtype(e.target.value as 'interim' | 'final')} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                    <option value="interim">Interim</option><option value="final">Final</option>
                  </select>
                </label>
                <label className="block"><span className="text-[11px] font-medium text-slate-500">Total amount (£)</span>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 10000" className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                </label>
                <label className="block"><span className="text-[11px] font-medium text-slate-500">Declaration date</span>
                  <input type="date" value={declDate} onChange={e => { setDeclDate(e.target.value); setTaxYear(ukTaxYear(e.target.value)); }} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                </label>
                <label className="block"><span className="text-[11px] font-medium text-slate-500">Payment date (optional)</span>
                  <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                </label>
                <label className="block"><span className="text-[11px] font-medium text-slate-500">Tax year</span>
                  <input type="text" value={taxYear} onChange={e => setTaxYear(e.target.value)} placeholder="2025/26" className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                </label>
              </div>
              <p className="text-[11px] text-slate-400">Split across shareholders from People &amp; roles by their shareholding %.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={declare} disabled={saving || !amount.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{saving ? 'Declaring…' : 'Declare dividend'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : dividends.length === 0 ? (
            <p className="text-sm text-slate-500">No dividends declared yet. Use <strong>Declare</strong> above.</p>
          ) : (
            <div className="space-y-2">
              {dividends.map(d => (
                <div key={d.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">£{money(d.total_amount)}</span>
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{d.dividend_type}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Declared {dateUk(d.declaration_date)}{d.payment_date ? ` · paid ${dateUk(d.payment_date)}` : ''}{d.tax_year ? ` · ${d.tax_year}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => printDoc(vouchersHtml(company, d, d.recipients), `Dividend vouchers — ${company.name}`)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><FileText size={12} /> Vouchers</button>
                      <button onClick={() => printDoc(minutesHtml(company, d, d.recipients, directors), `Dividend minutes — ${company.name}`)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><ScrollText size={12} /> Minutes</button>
                      <button onClick={() => remove(d.id)} aria-label="Delete" className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {d.recipients.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {d.recipients.map(r => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 truncate">{r.name}{r.shareholding_pct != null ? ` · ${r.shareholding_pct}%` : ''}</span>
                          <span className="tabular-nums text-slate-800">£{money(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
