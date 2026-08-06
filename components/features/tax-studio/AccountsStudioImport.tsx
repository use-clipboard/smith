'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, Loader2, Download, Check, RefreshCw, Info } from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import { fetchAccountsStudioSummary, mergeAccountsStudioIntoIncome, type AccountsStudioSummary } from './integrations';
import type { TaxReturn } from './types';

export default function AccountsStudioImport({ ret, patch }: { ret: TaxReturn; patch: (u: (r: TaxReturn) => TaxReturn) => void }) {
  const [summary, setSummary] = useState<AccountsStudioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);

  const load = useCallback(async () => {
    if (!ret.clientId) return;
    setLoading(true); setError('');
    try { setSummary(await fetchAccountsStudioSummary(ret.clientId, ret.taxYear)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read Accounts Studio.'); }
    finally { setLoading(false); }
  }, [ret.clientId, ret.taxYear]);

  useEffect(() => { void load(); }, [load]);

  function doImport() {
    if (!summary) return;
    patch(r => ({
      ...r,
      income: mergeAccountsStudioIntoIncome(r.income, summary),
      connected: r.connected.map(c => c.id === 'accounts-studio' ? { ...c, linked: true, value: `${fmtMoney(summary.netProfit)} profit` } : c),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported accounts profit from Accounts Studio` }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Landmark size={18} /></div>
          <div>
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Pull profit from Accounts Studio</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">The finalised accounts net profit → self-employment.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading || !ret.clientId} className="btn-secondary shrink-0">{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh</button>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-5 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Reading Accounts Studio…</div>
        ) : error ? (
          <p className="py-3 text-center text-[12.5px] text-rose-600">{error}</p>
        ) : !summary || !summary.found ? (
          <NoData text={`No finalised accounts for ${ret.taxYear} found for this client.`} />
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.04] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{summary.entityLabel} · period to {summary.periodEnd}</p>
                <p className="text-[11px] text-[var(--text-muted)]">Turnover {fmtMoney(summary.turnover)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Net profit</p>
                <p className="text-[14px] font-bold text-[var(--text-primary)]">{fmtMoney(summary.netProfit)}</p>
              </div>
            </div>
            {summary.note && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700"><Info size={12} className="mt-0.5 shrink-0" /> {summary.note}</p>}
            <div className="mt-3 flex justify-end">
              <button onClick={doImport} className="btn-primary">{imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import as self-employment'}</button>
            </div>
          </>
        )}
      </div>
    </StudioCard>
  );
}

function NoData({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-[12px] text-[var(--text-secondary)]">
      <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" /> {text}
    </div>
  );
}
