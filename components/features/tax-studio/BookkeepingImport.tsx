'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookCopy, Loader2, Download, Check, RefreshCw, Info } from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import { fetchBookkeepingSummary, mergeBookkeepingIntoIncome, type BookkeepingSummary } from './integrations';
import type { TaxReturn } from './types';

export default function BookkeepingImport({ ret, patch }: { ret: TaxReturn; patch: (u: (r: TaxReturn) => TaxReturn) => void }) {
  const [summary, setSummary] = useState<BookkeepingSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);

  const load = useCallback(async () => {
    if (!ret.clientId) return;
    setLoading(true); setError('');
    try { setSummary(await fetchBookkeepingSummary(ret.clientId, ret.taxYear)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read Bookkeeping.'); }
    finally { setLoading(false); }
  }, [ret.clientId, ret.taxYear]);

  useEffect(() => { void load(); }, [load]);

  function doImport() {
    if (!summary) return;
    patch(r => ({
      ...r,
      income: mergeBookkeepingIntoIncome(r.income, summary),
      connected: r.connected.map(c => c.id === 'bookkeeping' ? { ...c, linked: true, value: `${fmtMoney(summary.netProfit)} profit` } : c),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported ledger profit from Bookkeeping` }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><BookCopy size={18} /></div>
          <div>
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Pull profit from Bookkeeping</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">The ledger P&amp;L for the tax year → self-employment.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading || !ret.clientId} className="btn-secondary shrink-0">{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh</button>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-5 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Reading the ledger…</div>
        ) : error ? (
          <p className="py-3 text-center text-[12.5px] text-rose-600">{error}</p>
        ) : !summary || !summary.found ? (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-[12px] text-[var(--text-secondary)]">
            <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" /> No bookkeeping entries for {ret.taxYear} found for this client.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Turnover" value={fmtMoney(summary.turnover)} />
              <Stat label="Expenses" value={fmtMoney(summary.totalExpenses)} />
              <Stat label="Net profit" value={fmtMoney(summary.netProfit)} strong />
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">{summary.bookName} · {summary.from} to {summary.to}</p>
            {summary.note && <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-700"><Info size={12} className="mt-0.5 shrink-0" /> {summary.note}</p>}
            <div className="mt-3 flex justify-end">
              <button onClick={doImport} className="btn-primary">{imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import as self-employment'}</button>
            </div>
          </>
        )}
      </div>
    </StudioCard>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${strong ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.04]' : 'border-[var(--border)] bg-white/60'}`}>
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`text-[13px] ${strong ? 'font-bold text-[var(--text-primary)]' : 'font-semibold text-[var(--text-secondary)]'}`}>{value}</p>
    </div>
  );
}
