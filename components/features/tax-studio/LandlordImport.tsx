'use client';

import { useCallback, useEffect, useState } from 'react';
import { House, Loader2, Download, Check, RefreshCw, Info } from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import { fetchLandlordSummary, mergeLandlordIntoIncome, type LandlordSummary } from './integrations';
import type { TaxReturn } from './types';

export default function LandlordImport({ ret, patch }: { ret: TaxReturn; patch: (u: (r: TaxReturn) => TaxReturn) => void }) {
  const [summary, setSummary] = useState<LandlordSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);

  const load = useCallback(async () => {
    if (!ret.clientId) return;
    setLoading(true); setError('');
    try { setSummary(await fetchLandlordSummary(ret.clientId, ret.taxYear)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read Landlord Analysis.'); }
    finally { setLoading(false); }
  }, [ret.clientId, ret.taxYear]);

  useEffect(() => { void load(); }, [load]);

  function doImport() {
    if (!summary) return;
    patch(r => ({
      ...r,
      income: mergeLandlordIntoIncome(r.income, summary),
      connected: r.connected.map(c => c.id === 'landlord' ? { ...c, linked: true, value: `${fmtMoney(summary.taxableProfit)} profit` } : c),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported rental figures from Landlord Analysis` }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><House size={18} /></div>
          <div>
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Pull rental from Landlord Analysis</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">The saved property computation → UK property income.</p>
          </div>
        </div>
        <button onClick={load} disabled={loading || !ret.clientId} className="btn-secondary shrink-0">{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh</button>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-5 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Reading Landlord Analysis…</div>
        ) : error ? (
          <p className="py-3 text-center text-[12.5px] text-rose-600">{error}</p>
        ) : !summary || !summary.found ? (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-[12px] text-[var(--text-secondary)]">
            <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" /> No saved Landlord Analysis run found for this client.
          </div>
        ) : (
          <>
            {summary.note && <p className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-700"><Info size={12} className="mt-0.5 shrink-0" /> {summary.note}</p>}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Income" value={fmtMoney(summary.totalIncome)} />
              <Stat label="Expenses" value={fmtMoney(summary.totalExpenses)} />
              <Stat label="Taxable profit" value={fmtMoney(summary.taxableProfit)} strong />
            </div>
            {summary.financeReducer > 0 && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">Plus a residential finance-cost tax reducer of ~{fmtMoney(summary.financeReducer)} (applied as a 20% credit, not in the profit).</p>
            )}
            <div className="mt-3 flex justify-end">
              <button onClick={doImport} className="btn-primary">{imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import as property'}</button>
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
