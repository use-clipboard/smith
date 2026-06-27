'use client';

/**
 * MtdItBookkeepingImportModal — pull a sole-trader book's P&L for the quarter
 * into MTD IT self-employment entries. People & entities Phase 4 (sole trader →
 * MTD IT). Categories are suggested per account and editable before import.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, BookCopy, ArrowRight } from 'lucide-react';
import { SOLE_TRADER_INCOME, SOLE_TRADER_EXPENSES } from '@/lib/mtdIt/categories';

interface BookOpt { id: string; name: string; template_type: string }
interface TradeOpt { id: string; name: string }
interface Line { account_id: string; description: string; ledger: string | null; entry_type: 'income' | 'expense'; amount: number; category: string; include: boolean }

const money = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateUk = (iso: string) => { const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };

export default function MtdItBookkeepingImportModal({
  quarterId, open, onClose, onImported,
}: { quarterId: string; open: boolean; onClose: () => void; onImported: () => void }) {
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<BookOpt[]>([]);
  const [trades, setTrades] = useState<TradeOpt[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [bookId, setBookId] = useState('');
  const [tradeId, setTradeId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const base = `/api/mtd-it/quarters/${quarterId}/import-bookkeeping`;

  const loadMeta = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(base);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not load.');
      setBooks(d.books ?? []); setTrades(d.trades ?? []); setRange({ from: d.from, to: d.to });
      if ((d.books ?? []).length === 1) setBookId(d.books[0].id);
      if ((d.trades ?? []).length >= 1) setTradeId(d.trades[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.'); }
    finally { setLoading(false); }
  }, [base]);

  useEffect(() => { if (open) { setBookId(''); setLines([]); void loadMeta(); } }, [open, loadMeta]);

  useEffect(() => {
    if (!open || !bookId) { setLines([]); return; }
    (async () => {
      setLoadingLines(true); setError('');
      try {
        const r = await fetch(`${base}?book_id=${bookId}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Could not load figures.');
        setLines(((d.lines ?? []) as Omit<Line, 'include'>[]).map(l => ({ ...l, include: true })));
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not load figures.'); }
      finally { setLoadingLines(false); }
    })();
  }, [open, bookId, base]);

  async function doImport() {
    const chosen = lines.filter(l => l.include);
    if (chosen.length === 0) { setError('Nothing selected to import.'); return; }
    setImporting(true); setError('');
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: bookId, trade_id: tradeId || null,
          lines: chosen.map(l => ({ description: l.description, entry_type: l.entry_type, amount: l.amount, category: l.category })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Import failed.');
      onImported();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setImporting(false); }
  }

  if (!open) return null;

  const incomeTotal = lines.filter(l => l.include && l.entry_type === 'income').reduce((s, l) => s + l.amount, 0);
  const expenseTotal = lines.filter(l => l.include && l.entry_type === 'expense').reduce((s, l) => s + l.amount, 0);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><BookCopy size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Import from Bookkeeping</h2>
            {range && <p className="text-[11px] text-slate-500">Quarter {dateUk(range.from)} – {dateUk(range.to)}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : books.length === 0 ? (
            <p className="text-sm text-slate-500">No sole-trader bookkeeping found for this client. Create a Sole Trader (or Self-Employed) set of books for them first.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Bookkeeping</span>
                  <select value={bookId} onChange={e => setBookId(e.target.value)} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                    <option value="">Select a book…</option>
                    {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Trade {trades.length === 0 && <span className="text-slate-400">(none — add one first for per-trade filing)</span>}</span>
                  <select value={tradeId} onChange={e => setTradeId(e.target.value)} disabled={trades.length === 0} className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white disabled:opacity-50">
                    <option value="">No trade</option>
                    {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>

              {loadingLines ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading figures…</div>
              ) : bookId && lines.length === 0 ? (
                <p className="text-sm text-slate-500">No income or expenses found in this book for the quarter.</p>
              ) : lines.length > 0 ? (
                <>
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="w-8 px-2 py-1.5"></th>
                          <th className="text-left px-2 py-1.5">Account</th>
                          <th className="text-left px-2 py-1.5">MTD category</th>
                          <th className="text-right px-2 py-1.5">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={l.account_id} className={`border-t border-slate-100 ${l.include ? '' : 'opacity-40'}`}>
                            <td className="px-2 py-1.5 text-center">
                              <input type="checkbox" checked={l.include} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="text-slate-800">{l.description}</div>
                              <div className="text-[10px] text-slate-400">{l.entry_type === 'income' ? 'Income' : 'Expense'}{l.ledger ? ` · ${l.ledger}` : ''}</div>
                            </td>
                            <td className="px-2 py-1.5">
                              <select value={l.category} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
                                className="w-full text-xs border border-slate-300 rounded px-1.5 py-1 bg-white">
                                {(l.entry_type === 'income' ? SOLE_TRADER_INCOME : SOLE_TRADER_EXPENSES).map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">£{money(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50/60 text-xs">
                        <tr className="border-t border-slate-200">
                          <td></td>
                          <td className="px-2 py-1.5 font-medium text-slate-600" colSpan={2}>Income £{money(incomeTotal)} · Expenses £{money(expenseTotal)}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-900">Net £{money(incomeTotal - expenseTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-400">Disallowable ledgers are excluded. Imported figures are added as manual entries on this quarter — review them like any other.</p>
                </>
              ) : null}
            </>
          )}
        </div>

        {books.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button onClick={doImport} disabled={importing || lines.filter(l => l.include).length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {importing ? 'Importing…' : `Import ${lines.filter(l => l.include).length} ${lines.filter(l => l.include).length === 1 ? 'entry' : 'entries'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
