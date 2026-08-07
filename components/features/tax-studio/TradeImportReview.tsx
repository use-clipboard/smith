'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Check, Sparkles } from 'lucide-react';
import { fmtMoney } from './data';
import { SA103_BOX_CATALOG, fetchTradeBoxMapping, type PlLine, type BoxAllocation } from './integrations';

// Review modal for the itemised trade import: the AI maps each source P&L line
// to an SA103F box, and the user can re-point any line before it lands.
export default function TradeImportReview({ lines, sourceLabel, expectedNet, onConfirm, onClose }: {
  lines: PlLine[];
  sourceLabel: string;
  expectedNet?: number;
  onConfirm: (allocations: BoxAllocation[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [allocs, setAllocs] = useState<BoxAllocation[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTradeBoxMapping(lines).then(a => { if (!cancelled) { setAllocs(a); setLoading(false); } });
    return () => { cancelled = true; };
  }, [lines]);

  const boxOf = (box: string) => SA103_BOX_CATALOG.find(b => b.box === box);
  const isIncome = (box: string) => boxOf(box)?.section === 'income';
  const incomeTotal = useMemo(() => allocs.filter(a => isIncome(a.box)).reduce((s, a) => s + a.amount, 0), [allocs]);
  const expenseTotal = useMemo(() => allocs.filter(a => !isIncome(a.box)).reduce((s, a) => s + a.amount, 0), [allocs]);
  const disallowableTotal = useMemo(() => allocs.reduce((s, a) => s + (isIncome(a.box) ? 0 : a.disallowable || 0), 0), [allocs]);
  const net = incomeTotal - expenseTotal;
  const adjustedProfit = net + disallowableTotal;
  const netMismatch = expectedNet != null && Math.abs(net - expectedNet) > 1;

  const setBox = (idx: number, box: string) => setAllocs(a => a.map((x, j) => j === idx ? { ...x, box, disallowable: isIncome(box) ? 0 : x.disallowable } : x));
  const setDis = (idx: number, v: number) => setAllocs(a => a.map((x, j) => j === idx ? { ...x, disallowable: Math.max(0, Math.min(x.amount, v || 0)) } : x));

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]"><Sparkles size={15} className="text-[var(--accent)]" /> Review itemised import</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">{sourceLabel} — each P&L line mapped to its SA103F box. Adjust any box, then import.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Mapping lines to SA103F boxes…</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-black/5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">P&L line</th>
                  <th className="pb-2 pr-2 text-right">Amount</th>
                  <th className="pb-2 pr-2">SA103F box</th>
                  <th className="pb-2 text-right">Disallowable</th>
                </tr>
              </thead>
              <tbody>
                {allocs.map((a, idx) => (
                  <tr key={idx} className="border-b border-black/5">
                    <td className="py-1.5 pr-2 text-[12.5px] text-[var(--text-primary)]">{a.label}</td>
                    <td className="py-1.5 pr-2 text-right text-[12.5px] font-semibold text-[var(--text-primary)]">{fmtMoney(a.amount)}</td>
                    <td className="py-1.5 pr-2">
                      <select value={a.box} onChange={e => setBox(idx, e.target.value)} className="input-base py-1 text-[12px]">
                        <optgroup label="Income">
                          {SA103_BOX_CATALOG.filter(b => b.section === 'income').map(b => <option key={b.box} value={b.box}>{b.box} — {b.label}</option>)}
                        </optgroup>
                        <optgroup label="Expenses">
                          {SA103_BOX_CATALOG.filter(b => b.section === 'expense').map(b => <option key={b.box} value={b.box}>{b.box} — {b.label}</option>)}
                        </optgroup>
                      </select>
                    </td>
                    <td className="py-1.5 text-right">
                      {isIncome(a.box) ? (
                        <span className="text-[12px] text-[var(--text-muted)]">—</span>
                      ) : (
                        <input type="number" value={a.disallowable === 0 ? '' : a.disallowable} placeholder="0"
                          onChange={e => setDis(idx, Number(e.target.value))}
                          className={`input-base w-24 py-1 text-right text-[12px] ${a.disallowable > 0 ? 'font-semibold text-amber-700' : ''}`} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-black/5 px-5 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span className="text-[var(--text-muted)]">Turnover / income <span className="font-bold text-[var(--text-primary)]">{fmtMoney(incomeTotal)}</span></span>
            <span className="text-[var(--text-muted)]">Expenses <span className="font-bold text-[var(--text-primary)]">{fmtMoney(expenseTotal)}</span></span>
            <span className="text-[var(--text-muted)]">Net profit <span className="font-bold text-[var(--text-primary)]">{fmtMoney(net)}</span></span>
            {disallowableTotal > 0 && <span className="text-[var(--text-muted)]">+ Disallowed <span className="font-bold text-amber-700">{fmtMoney(disallowableTotal)}</span></span>}
            <span className="text-[var(--text-muted)]">Tax-adjusted profit <span className="font-bold text-[var(--text-primary)]">{fmtMoney(adjustedProfit)}</span></span>
            {netMismatch && <span className="text-[11px] font-semibold text-amber-700">Net differs from the source ({fmtMoney(expectedNet!)}) — check the mapping.</span>}
          </div>
          <p className="mb-2 text-[10.5px] text-[var(--text-muted)]">Disallowables (depreciation, entertaining) are added back automatically — adjust any figure above. Capital allowances are a separate claim; add them in the trade's Capital allowance tab.</p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={() => onConfirm(allocs)} disabled={loading} className="btn-primary disabled:opacity-40"><Check size={14} /> Import itemised</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
