'use client';

/**
 * MtdItLandlordImportModal — pull a saved Landlord Analysis into this quarter's
 * UK-property entries (Feed A). Lists the client's analyses that have
 * transactions in the quarter window; imports the chosen one (capital excluded,
 * finance included). Append or replace prior landlord-imported entries.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, House, ArrowRight, AlertTriangle } from 'lucide-react';

interface AnalysisOpt {
  output_id: string;
  created_at: string;
  period_from: string;
  period_to: string;
  filenames: string[];
  income_count: number;
  expense_count: number;
  income_total: number;
  expense_total: number;
}
interface Line { entry_type: 'income' | 'expense'; entry_date: string; description: string; supplier: string; category: string; property: string; amount: number }

const money = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateUk = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };
const LOCKED = new Set(['sent', 'approved', 'submitted']);

export default function MtdItLandlordImportModal({
  quarterId, open, onClose, onImported,
}: { quarterId: string; open: boolean; onClose: () => void; onImported: () => void }) {
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [status, setStatus] = useState('');
  const [existing, setExisting] = useState(0);
  const [analyses, setAnalyses] = useState<AnalysisOpt[]>([]);
  const [selected, setSelected] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const base = `/api/mtd-it/quarters/${quarterId}/import-landlord`;

  const loadMeta = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(base);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not load.');
      setRange({ from: d.from, to: d.to });
      setStatus(d.status ?? '');
      setExisting(d.existing_landlord_count ?? 0);
      setAnalyses(d.analyses ?? []);
      if ((d.analyses ?? []).length === 1) setSelected(d.analyses[0].output_id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
    finally { setLoading(false); }
  }, [base]);

  useEffect(() => { if (open) { setSelected(''); setLines([]); setMode('append'); void loadMeta(); } }, [open, loadMeta]);

  useEffect(() => {
    if (!open || !selected) { setLines([]); return; }
    (async () => {
      setLoadingLines(true); setError('');
      try {
        const r = await fetch(`${base}?output_id=${selected}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Could not load transactions.');
        setLines((d.lines ?? []) as Line[]);
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not load transactions.'); }
      finally { setLoadingLines(false); }
    })();
  }, [open, selected, base]);

  async function doImport() {
    if (!selected) return;
    setImporting(true); setError('');
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: selected, mode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Import failed.');
      onImported();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setImporting(false); }
  }

  if (!open) return null;

  const locked = LOCKED.has(status);
  const incomeTotal = lines.filter(l => l.entry_type === 'income').reduce((s, l) => s + l.amount, 0);
  const expenseTotal = lines.filter(l => l.entry_type === 'expense').reduce((s, l) => s + l.amount, 0);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><House size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Import from Landlord</h2>
            {range && <p className="text-[11px] text-slate-500">Quarter {dateUk(range.from)} – {dateUk(range.to)}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
          {locked && <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> This quarter is {status} — reopen it before importing.</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : analyses.length === 0 ? (
            <p className="text-sm text-slate-500">No saved Landlord Analysis for this client has transactions in this quarter. Run &amp; save a Landlord Analysis covering these dates first.</p>
          ) : (
            <>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Landlord Analysis</span>
                <select value={selected} onChange={e => setSelected(e.target.value)} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                  <option value="">Select an analysis…</option>
                  {analyses.map(a => (
                    <option key={a.output_id} value={a.output_id}>
                      {dateUk(a.created_at.slice(0, 10))} · {a.period_from && a.period_to ? `${dateUk(a.period_from)}–${dateUk(a.period_to)}` : 'all dates'} · {a.income_count + a.expense_count} in quarter
                    </option>
                  ))}
                </select>
              </label>

              {loadingLines ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading transactions…</div>
              ) : selected && lines.length === 0 ? (
                <p className="text-sm text-slate-500">No transactions fall within this quarter.</p>
              ) : lines.length > 0 ? (
                <>
                  <div className="rounded-lg border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5">Date</th>
                          <th className="text-left px-2 py-1.5">Description</th>
                          <th className="text-left px-2 py-1.5">Property</th>
                          <th className="text-right px-2 py-1.5">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{dateUk(l.entry_date)}</td>
                            <td className="px-2 py-1.5">
                              <div className="text-slate-800">{l.description || (l.entry_type === 'income' ? 'Rental income' : l.supplier)}</div>
                              <div className="text-[10px] text-slate-400">{l.entry_type === 'income' ? 'Income' : `Expense · ${l.category}`}</div>
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 max-w-[140px] truncate">{l.property || 'Non allocated'}</td>
                            <td className={`px-2 py-1.5 text-right tabular-nums ${l.entry_type === 'income' ? 'text-emerald-700' : 'text-slate-800'}`}>£{money(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50/60 text-xs sticky bottom-0">
                        <tr className="border-t border-slate-200">
                          <td className="px-2 py-1.5 font-medium text-slate-600" colSpan={3}>Income £{money(incomeTotal)} · Expenses £{money(expenseTotal)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-900">Net £{money(incomeTotal - expenseTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {existing > 0 && (
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-slate-500">This quarter already has {existing} landlord-imported {existing === 1 ? 'entry' : 'entries'}:</span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add to them</label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace them</label>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400">Capital items are excluded; residential finance costs are included (the tax restriction is applied at year-end, not quarterly). Full amounts are stored with the property&apos;s ownership share recorded — confirm the client&apos;s declared share before filing.</p>
                </>
              ) : null}
            </>
          )}
        </div>

        {analyses.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button onClick={doImport} disabled={importing || locked || !selected || lines.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {importing ? 'Importing…' : `Import ${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}${mode === 'replace' ? ' (replace)' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
