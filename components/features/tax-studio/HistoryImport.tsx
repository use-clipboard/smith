'use client';

import { useState } from 'react';
import {
  Loader2, Download, Check, Info, House, Calculator, BookOpen, Landmark,
} from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { StudioCard, SectionTitle } from './primitives';
import { fmtMoney, taxYearOptions } from './data';
import {
  fetchMtdItSummary, fetchAccountsStudioSummary, fetchLandlordSummary, fetchBookkeepingSummary,
  mergeCrossMtd, mergeCrossAccounts, mergeCrossLandlord, mergeCrossBookkeeping,
  summaryHasData,
  type MtdItAnnualSummary, type AccountsStudioSummary, type LandlordSummary, type BookkeepingSummary,
  type SourceRef,
} from './integrations';
import type { TaxReturn } from './types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

interface Results {
  mtd: MtdItAnnualSummary | null;
  accounts: AccountsStudioSummary | null;
  landlord: LandlordSummary | null;
  bookkeeping: BookkeepingSummary | null;
}

export default function HistoryImport({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const [srcId, setSrcId] = useState('');
  const [srcName, setSrcName] = useState('');
  const [srcRef, setSrcRef] = useState('');
  const [taxYear, setTaxYear] = useState(ret.taxYear);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const years = taxYearOptions();
  const label = `${srcName}${srcRef ? ` (${srcRef})` : ''}`;
  const source: SourceRef = { clientId: srcId, label };

  async function runSearch(clientId: string, year: string) {
    if (!clientId) { setResults(null); return; }
    setLoading(true); setError(''); setResults(null);
    try {
      const [mtd, accounts, landlord, bookkeeping] = await Promise.all([
        fetchMtdItSummary(clientId, year).catch(() => null),
        fetchAccountsStudioSummary(clientId, year).catch(() => null),
        fetchLandlordSummary(clientId, year).catch(() => null),
        fetchBookkeepingSummary(clientId, year).catch(() => null),
      ]);
      setResults({ mtd, accounts, landlord, bookkeeping });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not search this client’s history.');
    } finally {
      setLoading(false);
    }
  }

  function onPickClient(id: string, name: string, ref: string) {
    setSrcId(id); setSrcName(name); setSrcRef(ref); setImported(null);
    void runSearch(id, taxYear);
  }

  function onChangeYear(year: string) {
    setTaxYear(year); setImported(null);
    void runSearch(srcId, year);
  }

  function apply(key: string, merge: (income: TaxReturn['income']) => TaxReturn['income'], note: string) {
    patch(r => ({
      ...r,
      income: merge(r.income),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: note }],
    }));
    setImported(key); setTimeout(() => setImported(cur => (cur === key ? null : cur)), 2500);
  }

  // Which tools actually have importable figures for the chosen client + year.
  const mtdHas = results?.mtd ? summaryHasData(results.mtd) : false;
  const accHas = !!(results?.accounts?.found && results.accounts.netProfit);
  const llHas = !!(results?.landlord?.found && results.landlord.taxableProfit);
  const bkHas = !!(results?.bookkeeping?.found && results.bookkeeping.netProfit);
  const anyFound = mtdHas || accHas || llHas || bkHas;

  return (
    <StudioCard className="p-5">
      <SectionTitle
        title="Search all analysis history"
        sub="Pull a saved analysis from any client in the firm — useful when a rental portfolio or trade sits under a different client code that doesn't match this return."
      />

      <div className="flex flex-wrap items-center gap-2">
        <ClientSearchInput
          value={srcId}
          valueName={srcName}
          onChange={onPickClient}
          placeholder="Search any client…"
          className="min-w-[220px] flex-1"
        />
        <select
          value={taxYear}
          onChange={e => onChangeYear(e.target.value)}
          className="input-base w-auto py-1.5 text-sm"
          aria-label="Tax year to search"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {!srcId ? (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-[var(--text-muted)]">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          Pick a source client to see the analyses SMITH has saved for them. Imported figures are stamped with the source client so they stay traceable — you can edit or remove them in Review &amp; Adjust.
        </p>
      ) : loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 py-6 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Searching {label}…</div>
      ) : error ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
      ) : !anyFound ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-[12px] text-[var(--text-secondary)]">
          <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          No saved analyses found for {label} in {taxYear}. Try a different tax year, or check the figures live under another client.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {llHas && results?.landlord && (
            <SourceRow
              icon={House} tool="Landlord Analysis" target="→ UK property"
              headline={`${fmtMoney(results.landlord.taxableProfit)} taxable profit`}
              imported={imported === 'landlord'}
              onImport={() => apply('landlord', i => mergeCrossLandlord(i, results.landlord!, source), `Imported rental from ${label} (Landlord Analysis)`)}
            />
          )}
          {mtdHas && results?.mtd && (
            <SourceRow
              icon={Landmark} tool="MTD IT" target="→ trade / property"
              headline={mtdHeadline(results.mtd)}
              imported={imported === 'mtd'}
              onImport={() => apply('mtd', i => mergeCrossMtd(i, results.mtd!, {
                soleTrader: results.mtd!.selfEmployment.length > 0,
                ukProperty: !!results.mtd!.ukProperty,
                foreignProperty: !!results.mtd!.foreignProperty,
              }, source), `Imported MTD IT figures from ${label}`)}
            />
          )}
          {accHas && results?.accounts && (
            <SourceRow
              icon={Calculator} tool="Accounts Studio" target="→ self-employment"
              headline={`${fmtMoney(results.accounts.netProfit)} net profit`}
              imported={imported === 'accounts'}
              onImport={() => apply('accounts', i => mergeCrossAccounts(i, results.accounts!, source), `Imported trade profit from ${label} (Accounts Studio)`)}
            />
          )}
          {bkHas && results?.bookkeeping && (
            <SourceRow
              icon={BookOpen} tool="Bookkeeping" target="→ self-employment"
              headline={`${fmtMoney(results.bookkeeping.netProfit)} net profit`}
              imported={imported === 'bookkeeping'}
              onImport={() => apply('bookkeeping', i => mergeCrossBookkeeping(i, results.bookkeeping!, source), `Imported trade profit from ${label} (Bookkeeping)`)}
            />
          )}
        </div>
      )}
    </StudioCard>
  );
}

function mtdHeadline(s: MtdItAnnualSummary): string {
  const parts: string[] = [];
  if (s.selfEmployment.length) parts.push(`${fmtMoney(s.selfEmployment.reduce((a, t) => a + t.profit, 0))} trade`);
  if (s.ukProperty) parts.push(`${fmtMoney(s.ukProperty.profit)} UK property`);
  if (s.foreignProperty) parts.push(`${fmtMoney(s.foreignProperty.profit)} foreign property`);
  return parts.join(' · ') || 'Figures available';
}

function SourceRow({
  icon: Icon, tool, target, headline, imported, onImport,
}: {
  icon: typeof House; tool: string; target: string; headline: string; imported: boolean; onImport: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/60 px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Icon size={17} /></div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold text-[var(--text-primary)]">{tool} <span className="font-medium text-[var(--text-muted)]">{target}</span></p>
          <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{headline}</p>
        </div>
      </div>
      <button onClick={onImport} className="btn-primary shrink-0">
        {imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import'}
      </button>
    </div>
  );
}
