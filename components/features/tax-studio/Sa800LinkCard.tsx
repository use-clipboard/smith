'use client';

// SA800 linked data — pulls the partnership's trading result from Accounts Studio
// (partnership accounts) or the Bookkeeping tool, and the partner list + profit
// shares from the bookkeeping participants, so the Trading and Partners tabs can
// be auto-filled instead of keyed in by hand.

import { useEffect, useState } from 'react';
import { Link2, Download, CheckCircle2, Loader2, Users, ListTree } from 'lucide-react';
import { fetchJson } from '@/lib/fetchJson';
import { fetchTradeBoxMapping } from './integrations';
import { fmtMoney } from './data';
import type { Sa800Trading, Sa800Partner } from './types';

interface PlLine { label: string; amount: number; section: 'income' | 'expense' }
interface TradingSummary { found: boolean; source: 'as' | 'bk'; label: string; periodStart?: string; periodEnd?: string; turnover: number; expenses: number; netProfit: number; lines?: PlLine[] }
interface PartnerRow { name: string; sharePct: number; clientId: string | null; utr: string | null }

// SA103F box (from the shared box mapper) → the matching SA800 full-P&L field.
const SA103_TO_SA800: Record<string, keyof Sa800Trading> = {
  '15': 'sales', '16': 'otherIncome',
  '17': 'costOfSales', '18': 'subcontractorCosts',
  '19': 'employeeCosts', '20': 'motorExpenses', '21': 'premisesCosts',
  '22': 'repairs', '23': 'adminCosts', '24': 'advertising',
  '25': 'interest', '26': 'otherFinance', '27': 'badDebts',
  '28': 'legalProfessional', '29': 'depreciation', '30': 'otherExpenses',
};

const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

export default function Sa800LinkCard({ clientId, taxYear, existingPartners, onImportTrading, onImportPartners, onPeriod }: {
  clientId: string | null;
  taxYear: string;
  existingPartners: Sa800Partner[];
  onImportTrading: (t: Partial<Sa800Trading>) => void;
  onImportPartners: (partners: Sa800Partner[]) => void;
  onPeriod: (start: string, end: string) => void;
}): JSX.Element | null {
  const [trading, setTrading] = useState<TradingSummary | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importedT, setImportedT] = useState(false);
  const [importedP, setImportedP] = useState(false);
  const [importedFull, setImportedFull] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let live = true;
    (async () => {
      // Prefer Accounts Studio (finalised partnership accounts); fall back to Bookkeeping.
      let t: TradingSummary | null = null;
      try {
        const as = await fetchJson<{ found: boolean; entityLabel?: string; periodStart?: string; periodEnd?: string; turnover?: number; netProfit?: number }>(`/api/tax-studio/integrations/accounts-studio?clientId=${clientId}&taxYear=${encodeURIComponent(taxYear)}`, { cache: 'no-store' });
        if (as.found && (as.netProfit || as.turnover)) {
          t = { found: true, source: 'as', label: as.entityLabel || 'Partnership accounts', periodStart: as.periodStart, periodEnd: as.periodEnd, turnover: as.turnover ?? 0, expenses: Math.max(0, (as.turnover ?? 0) - (as.netProfit ?? 0)), netProfit: as.netProfit ?? 0 };
        }
      } catch { /* try bookkeeping */ }
      if (!t) {
        try {
          const bk = await fetchJson<{ found: boolean; bookName?: string; from?: string; to?: string; turnover?: number; totalExpenses?: number; netProfit?: number; lines?: PlLine[] }>(`/api/tax-studio/integrations/bookkeeping?clientId=${clientId}&taxYear=${encodeURIComponent(taxYear)}`, { cache: 'no-store' });
          if (bk.found) t = { found: true, source: 'bk', label: bk.bookName || 'Bookkeeping', periodStart: bk.from, periodEnd: bk.to, turnover: bk.turnover ?? 0, expenses: bk.totalExpenses ?? 0, netProfit: bk.netProfit ?? 0, lines: bk.lines };
        } catch { /* none */ }
      }
      let ps: PartnerRow[] = [];
      try {
        const r = await fetchJson<{ found: boolean; partners: PartnerRow[] }>(`/api/tax-studio/integrations/partnership-partners?clientId=${clientId}`, { cache: 'no-store' });
        ps = r.partners ?? [];
      } catch { /* none */ }
      if (live) { setTrading(t); setPartners(ps); setLoading(false); }
    })();
    return () => { live = false; };
  }, [clientId, taxYear]);

  if (!clientId) return null;
  if (loading) return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
      <Loader2 size={13} className="animate-spin" /> Checking Accounts Studio &amp; Bookkeeping for linked partnership data…
    </div>
  );
  if (!trading && !partners.length) return null;

  function importTrading() {
    if (!trading) return;
    onImportTrading({ accountsMode: '3line', turnover3line: Math.round(trading.turnover), expenses3line: Math.round(trading.expenses) });
    if (trading.periodStart && trading.periodEnd) onPeriod(trading.periodStart, trading.periodEnd);
    setImportedT(true);
  }
  // Map the P&L account lines to the SA800 full-P&L boxes via the shared SA103
  // box mapper, then translate SA103 → SA800 fields.
  async function importFullPnl() {
    if (!trading?.lines?.length) return;
    setFullLoading(true);
    try {
      const allocations = await fetchTradeBoxMapping(trading.lines);
      const out: Partial<Sa800Trading> = { accountsMode: 'full' };
      const nums = out as Record<string, number>;
      let disallowable = 0;
      for (const a of allocations) {
        const field = SA103_TO_SA800[a.box];
        if (field) nums[field] = (nums[field] ?? 0) + a.amount;
        disallowable += a.disallowable || 0;
      }
      out.disallowableTotal = Math.round(disallowable);
      if (trading.periodStart && trading.periodEnd) onPeriod(trading.periodStart, trading.periodEnd);
      onImportTrading(out);
      setImportedFull(true);
    } finally {
      setFullLoading(false);
    }
  }
  function importPartners() {
    // Merge by name — keep existing partners, add any not already present.
    const have = new Set(existingPartners.map(p => (p.name ?? '').trim().toLowerCase()));
    const additions: Sa800Partner[] = partners
      .filter(p => p.name && !have.has(p.name.trim().toLowerCase()))
      .map(p => ({ id: rid('ptr'), name: p.name, sharePct: p.sharePct, clientId: p.clientId, utr: p.utr ?? undefined }));
    onImportPartners([...existingPartners, ...additions]);
    setImportedP(true);
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><Link2 size={13} /> Linked partnership data</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {trading && (
          <div className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-white/70 px-3 py-2">
            <ListTree size={16} className="shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{trading.label} <span className="font-normal text-[var(--text-muted)]">· {trading.source === 'as' ? 'Accounts Studio' : 'Bookkeeping'}</span></p>
              <p className="text-[11px] text-[var(--text-muted)]">Turnover {fmtMoney(trading.turnover)} · net {fmtMoney(trading.netProfit)}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button onClick={importTrading} disabled={importedT} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                {importedT ? <><CheckCircle2 size={12} /> Filled</> : <><Download size={12} /> Fill 3-line</>}
              </button>
              {trading.lines && trading.lines.length > 0 && (
                <button onClick={importFullPnl} disabled={importedFull || fullLoading} className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--accent)]/40 px-2 py-1 text-[11px] font-semibold text-[var(--accent)] disabled:opacity-40">
                  {fullLoading ? <><Loader2 size={12} className="animate-spin" /> Mapping…</> : importedFull ? <><CheckCircle2 size={12} /> Full P&amp;L</> : <><ListTree size={12} /> Full P&amp;L</>}
                </button>
              )}
            </div>
          </div>
        )}
        {partners.length > 0 && (
          <div className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-white/70 px-3 py-2">
            <Users size={16} className="shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{partners.length} partner{partners.length === 1 ? '' : 's'} <span className="font-normal text-[var(--text-muted)]">· Bookkeeping</span></p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">{partners.map(p => `${p.name} ${p.sharePct}%`).join(' · ')}</p>
            </div>
            <button onClick={importPartners} disabled={importedP} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
              {importedP ? <><CheckCircle2 size={12} /> Added</> : <><Download size={12} /> Add partners</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
