'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarCheck, Loader2, Download, Check, Briefcase, Home, Globe2, RefreshCw, Info,
} from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import {
  fetchMtdItSummary, mergeMtdIntoIncome, summaryHasData,
  type MtdItAnnualSummary, type MtdImportSelection,
} from './integrations';
import type { TaxReturn } from './types';

export default function MtdItImport({
  ret, patch,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
}) {
  const [summary, setSummary] = useState<MtdItAnnualSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);
  const [sel, setSel] = useState<MtdImportSelection>({ soleTrader: true, ukProperty: true, foreignProperty: true });

  const load = useCallback(async () => {
    if (!ret.clientId) { setError('This return isn’t linked to a client record.'); return; }
    setLoading(true); setError('');
    try {
      const s = await fetchMtdItSummary(ret.clientId, ret.taxYear);
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read MTD IT figures.');
    } finally {
      setLoading(false);
    }
  }, [ret.clientId, ret.taxYear]);

  useEffect(() => { void load(); }, [load]);

  function doImport() {
    if (!summary) return;
    const income = mergeMtdIntoIncome(ret.income, summary, sel);
    const parts: string[] = [];
    if (sel.soleTrader && summary.selfEmployment.length) parts.push('sole trader');
    if (sel.ukProperty && summary.ukProperty) parts.push('UK rental');
    if (sel.foreignProperty && summary.foreignProperty) parts.push('foreign rental');
    const totalProfit = (sel.soleTrader ? summary.selfEmployment.reduce((a, t) => a + t.profit, 0) : 0)
      + (sel.ukProperty && summary.ukProperty ? summary.ukProperty.profit : 0)
      + (sel.foreignProperty && summary.foreignProperty ? summary.foreignProperty.profit : 0);
    patch(r => ({
      ...r,
      income,
      connected: r.connected.map(c => c.id === 'mtd-it'
        ? { ...c, linked: true, value: `${fmtMoney(Math.round(totalProfit))} · ${summary.quartersFound}q` }
        : c),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported MTD IT figures (${parts.join(', ') || 'none'})` }],
    }));
    setImported(true);
    setTimeout(() => setImported(false), 2500);
  }

  const has = summary ? summaryHasData(summary) : false;

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><CalendarCheck size={18} /></div>
          <div>
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Pull figures from MTD IT</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Sole trader, UK rental and foreign rental — totalled across the year’s quarters.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary shrink-0">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Reading MTD IT…</div>
        ) : error ? (
          <p className="py-4 text-center text-[12.5px] text-rose-600">{error}</p>
        ) : !summary || !has ? (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">
            <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <div>
              <p className="font-semibold text-[var(--text-primary)]">No MTD IT figures for {ret.taxYear}</p>
              <p className="mt-0.5 text-[var(--text-muted)]">There’s no completed MTD IT quarterly data for this client and year yet. Once quarters are analysed in MTD IT they’ll appear here to import.</p>
            </div>
          </div>
        ) : (
          <>
            {summary.note && <p className="mb-2 text-[11.5px] text-amber-700">{summary.note}</p>}
            <div className="space-y-2">
              {summary.selfEmployment.length > 0 && (
                <SourceRow
                  icon={Briefcase} label={summary.selfEmployment.length === 1 ? summary.selfEmployment[0].label || 'Self-employment' : `Sole trader (${summary.selfEmployment.length} trades)`}
                  income={summary.selfEmployment.reduce((a, t) => a + t.income, 0)}
                  expenses={summary.selfEmployment.reduce((a, t) => a + t.expenses, 0)}
                  profit={summary.selfEmployment.reduce((a, t) => a + t.profit, 0)}
                  checked={sel.soleTrader} onToggle={() => setSel(s => ({ ...s, soleTrader: !s.soleTrader }))}
                />
              )}
              {summary.ukProperty && (
                <SourceRow icon={Home} label={summary.ukProperty.label || 'UK property'}
                  income={summary.ukProperty.income} expenses={summary.ukProperty.expenses} profit={summary.ukProperty.profit}
                  checked={sel.ukProperty} onToggle={() => setSel(s => ({ ...s, ukProperty: !s.ukProperty }))} />
              )}
              {summary.foreignProperty && (
                <SourceRow icon={Globe2} label={summary.foreignProperty.label || 'Foreign property'}
                  income={summary.foreignProperty.income} expenses={summary.foreignProperty.expenses} profit={summary.foreignProperty.profit}
                  checked={sel.foreignProperty} onToggle={() => setSel(s => ({ ...s, foreignProperty: !s.foreignProperty }))} />
              )}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-[11px] text-[var(--text-muted)]">From {summary.quartersFound} quarter{summary.quartersFound === 1 ? '' : 's'} · re-importing updates the MTD-sourced rows.</p>
              <button onClick={doImport} disabled={!sel.soleTrader && !sel.ukProperty && !sel.foreignProperty} className="btn-primary disabled:opacity-40">
                {imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import figures'}
              </button>
            </div>
          </>
        )}
      </div>
    </StudioCard>
  );
}

function SourceRow({
  icon: Icon, label, income, expenses, profit, checked, onToggle,
}: {
  icon: typeof Briefcase; label: string; income: number; expenses: number; profit: number;
  checked: boolean; onToggle: () => void;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${checked ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.04]' : 'border-[var(--border)] bg-white/60'}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 rounded border-slate-300 text-[var(--accent)]" />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--accent)] shadow-sm"><Icon size={15} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">Income {fmtMoney(income)} · Expenses {fmtMoney(expenses)}</p>
      </div>
      <div className="text-right">
        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Profit</p>
        <p className="text-[13px] font-bold text-[var(--text-primary)]">{fmtMoney(profit)}</p>
      </div>
    </label>
  );
}
