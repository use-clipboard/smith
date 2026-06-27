'use client';

/**
 * BookFundsModal — manage a charity book's funds (unrestricted / restricted /
 * endowment). Add, rename, re-type (while empty), archive and delete (only when
 * a fund has no entries). Backed by /api/bookkeeping/books/[id]/funds.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { FUND_TYPE_OPTIONS, FUND_TYPE_LABEL, type BookFund, type FundType } from '@/types/bookkeeping';
import { invalidateFundsCache } from '../input/FundPicker';

const TYPE_TONE: Record<FundType, string> = {
  unrestricted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  restricted: 'bg-amber-50 text-amber-700 border-amber-200',
  endowment: 'bg-violet-50 text-violet-700 border-violet-200',
};

export default function BookFundsModal({
  bookId, open, onClose, onChanged,
}: { bookId: string; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const [funds, setFunds] = useState<BookFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<FundType>('restricted');

  const base = `/api/bookkeeping/books/${bookId}/funds`;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(base);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not load funds.');
      setFunds(d.funds ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load funds.'); }
    finally { setLoading(false); }
  }, [base]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  function refreshed() { invalidateFundsCache(bookId); onChanged?.(); }

  async function addFund() {
    if (!newName.trim()) { setError('Give the fund a name.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), fund_type: newType }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not add fund.');
      setNewName('');
      await load(); refreshed();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add fund.'); }
    finally { setBusy(false); }
  }

  async function patchFund(id: string, patch: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const r = await fetch(`${base}/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not update fund.');
      await load(); refreshed();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update fund.'); }
    finally { setBusy(false); }
  }

  async function deleteFund(id: string) {
    if (!confirm('Delete this fund? Only funds with no entries can be deleted.')) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`${base}/${id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not delete fund.');
      await load(); refreshed();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete fund.'); }
    finally { setBusy(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <h2 className="text-sm font-semibold text-slate-900 flex-1">Funds</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Add fund */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/40">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Add a fund</div>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Fund name (e.g. Building Fund)"
                className="flex-1 text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
              />
              <select value={newType} onChange={e => setNewType(e.target.value as FundType)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white">
                {FUND_TYPE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <button type="button" onClick={addFund} disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                <Plus size={14} /> Add
              </button>
            </div>
            <p className="text-[11px] text-slate-400">{FUND_TYPE_OPTIONS.find(o => o.id === newType)?.hint}</p>
          </div>

          {/* List */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : funds.length === 0 ? (
            <p className="text-sm text-slate-500">No funds yet — add one above.</p>
          ) : (
            <ul className="space-y-2">
              {funds.map(f => (
                <li key={f.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${f.archived ? 'opacity-60 border-slate-200' : 'border-slate-200'}`}>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${TYPE_TONE[f.fund_type]}`}>{FUND_TYPE_LABEL[f.fund_type]}</span>
                  <span className="text-sm text-slate-800 flex-1 truncate">{f.name}{f.archived && <span className="text-slate-400"> · archived</span>}</span>
                  {f.in_use && <span className="text-[10px] text-slate-400">in use</span>}
                  <button type="button" onClick={() => patchFund(f.id, { archived: !f.archived })} disabled={busy}
                    aria-label={f.archived ? 'Restore' : 'Archive'}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-50">
                    {f.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </button>
                  {!f.in_use && (
                    <button type="button" onClick={() => deleteFund(f.id)} disabled={busy}
                      aria-label="Delete" className="text-slate-400 hover:text-rose-600 disabled:opacity-50">
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
