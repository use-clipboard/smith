'use client';

/**
 * BookProfitAllocationModal — split the "Profit to be allocated" balance across
 * partners by their profit-share % into each partner's capital account
 * (partnership / LLP). Phase 2 of docs/people-and-entities.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Scale, AlertTriangle, Check } from 'lucide-react';

interface Line { participantId: string; name: string; pct: number; accountId: string; account_name: string; share: number }
interface Preview {
  retained_account: { id: string; name: string };
  profit_to_allocate: number;
  total_pct: number;
  ok: boolean;
  warnings: string[];
  residual_assigned_to: string | null;
  default_date: string;
  lines: Line[];
}

const fmt = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDateUk = (iso: string) => { const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };

export default function BookProfitAllocationModal({
  bookId, open, onClose, onPosted,
}: { bookId: string; open: boolean; onClose: () => void; onPosted?: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setDone(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/allocate-profit`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not load.');
      setPreview(d);
      setDate(d.default_date ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    } finally { setLoading(false); }
  }, [bookId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  async function post() {
    setPosting(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/allocate-profit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: date || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not post.');
      setDone(d.ref_no ?? 'posted');
      onPosted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.');
    } finally { setPosting(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Scale size={15} /></span>
          <h2 className="text-sm font-semibold text-slate-900 flex-1">Allocate profit</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : done ? (
            <div className="py-6 text-center">
              <div className="inline-flex w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 items-center justify-center mb-2"><Check size={18} /></div>
              <p className="text-sm font-medium text-slate-900">Profit allocated</p>
              <p className="text-xs text-slate-500 mt-0.5">Posted as {done}. Each partner&rsquo;s share is now on their capital account.</p>
              <button onClick={onClose} className="btn-primary text-sm mt-4">Done</button>
            </div>
          ) : preview ? (
            <>
              {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500">{preview.retained_account.name}</span>
                <span className="text-lg font-semibold text-slate-900 tabular-nums">£{fmt(preview.profit_to_allocate)}</span>
              </div>

              {preview.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Split */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr><th className="text-left px-3 py-1.5">Partner</th><th className="text-right px-3 py-1.5">Share %</th><th className="text-right px-3 py-1.5">Amount</th></tr>
                  </thead>
                  <tbody>
                    {preview.lines.map(l => (
                      <tr key={l.participantId} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">
                          <div className="text-slate-800">{l.name}</div>
                          <div className="text-[11px] text-slate-400">→ {l.account_name}</div>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{l.pct}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">£{fmt(l.share)}</td>
                      </tr>
                    ))}
                    {preview.lines.length === 0 && (
                      <tr><td colSpan={3} className="px-3 py-3 text-center text-xs text-slate-400">No partners with a mapped capital account.</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/60">
                      <td className="px-3 py-1.5 text-xs font-medium text-slate-600">Total</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs font-medium text-slate-600">{preview.total_pct}%</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-sm font-semibold text-slate-900">£{fmt(preview.lines.reduce((s, l) => s + l.share, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {preview.residual_assigned_to && (
                <p className="text-[11px] text-slate-400">Penny rounding absorbed by {preview.residual_assigned_to}.</p>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span>Journal date</span>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="text-sm border border-slate-300 rounded-lg px-2 py-1.5" />
                {date && <span className="text-slate-400">({fmtDateUk(date)})</span>}
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                <button onClick={post} disabled={posting || !preview.ok}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                  {posting ? <Loader2 size={14} className="animate-spin" /> : <Scale size={14} />}
                  {posting ? 'Posting…' : 'Post allocation'}
                </button>
              </div>
            </>
          ) : (
            error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
