'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Link2, CalendarCheck, Calculator, BookOpen, House, Receipt, Users,
  Loader2, Download, Check, Info, RefreshCw, Search,
} from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import {
  fetchMtdItSummary, fetchAccountsStudioSummary, fetchLandlordSummary, fetchBookkeepingSummary,
  mergeCrossMtd, mergeCrossAccounts, mergeCrossLandlord, mergeCrossBookkeeping,
  summaryHasData,
  type MtdItAnnualSummary, type AccountsStudioSummary, type LandlordSummary, type BookkeepingSummary,
  type SourceRef,
} from './integrations';
import type { TaxReturn, Sa100Income } from './types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

// A tool that can be read for the return's client — or any other client — and
// imported into the SA100. Each adapter binds a source reader + merge so the
// panel below stays generic.
interface ToolAdapter<S> {
  name: string;
  target: string;
  icon: LucideIcon;
  fetch: (clientId: string, taxYear: string) => Promise<S>;
  hasData: (s: S) => boolean;
  headline: (s: S) => string;
  note?: (s: S) => string | undefined;
  merge: (income: Sa100Income, s: S, src: SourceRef) => Sa100Income;
  timelineLabel: (sourceLabel: string) => string;
}

function mtdHeadline(s: MtdItAnnualSummary): string {
  const parts: string[] = [];
  if (s.selfEmployment.length) parts.push(`${fmtMoney(s.selfEmployment.reduce((a, t) => a + t.profit, 0))} trade`);
  if (s.ukProperty) parts.push(`${fmtMoney(s.ukProperty.profit)} UK property`);
  if (s.foreignProperty) parts.push(`${fmtMoney(s.foreignProperty.profit)} foreign`);
  return parts.join(' · ') || 'Figures available';
}

const MTD: ToolAdapter<MtdItAnnualSummary> = {
  name: 'MTD IT', target: 'Sole trader & property', icon: CalendarCheck,
  fetch: fetchMtdItSummary, hasData: summaryHasData, headline: mtdHeadline, note: s => s.note,
  merge: (i, s, src) => mergeCrossMtd(i, s, { soleTrader: s.selfEmployment.length > 0, ukProperty: !!s.ukProperty, foreignProperty: !!s.foreignProperty }, src),
  timelineLabel: l => `Imported MTD IT figures from ${l}`,
};

const ACCOUNTS: ToolAdapter<AccountsStudioSummary> = {
  name: 'Accounts Studio', target: 'Trade profit', icon: Calculator,
  fetch: fetchAccountsStudioSummary, hasData: s => s.found && !!s.netProfit, headline: s => `${fmtMoney(s.netProfit)} net profit`, note: s => s.note,
  merge: mergeCrossAccounts, timelineLabel: l => `Imported trade profit from ${l} (Accounts Studio)`,
};

const BOOKKEEPING: ToolAdapter<BookkeepingSummary> = {
  name: 'Bookkeeping', target: 'Trade profit', icon: BookOpen,
  fetch: fetchBookkeepingSummary, hasData: s => s.found && !!s.netProfit, headline: s => `${fmtMoney(s.netProfit)} net profit`, note: s => s.note,
  merge: mergeCrossBookkeeping, timelineLabel: l => `Imported trade profit from ${l} (Bookkeeping)`,
};

const LANDLORD: ToolAdapter<LandlordSummary> = {
  name: 'Landlord Analysis', target: 'UK property', icon: House,
  fetch: fetchLandlordSummary, hasData: s => s.found && !!s.taxableProfit, headline: s => `${fmtMoney(s.taxableProfit)} taxable profit`, note: s => s.note,
  merge: mergeCrossLandlord, timelineLabel: l => `Imported rental from ${l} (Landlord Analysis)`,
};

export default function ConnectedImports({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]">
          <Link2 size={15} className="text-[var(--accent)]" /> Pull figures from connected tools
        </p>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
          Reads this client by default — hit <span className="font-semibold">Change</span> on any tool to pull from another client (e.g. a rental portfolio held under a separate code).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ToolImportPanel adapter={MTD} ret={ret} patch={patch} />
        <ToolImportPanel adapter={ACCOUNTS} ret={ret} patch={patch} />
        <ToolImportPanel adapter={BOOKKEEPING} ret={ret} patch={patch} />
        <ToolImportPanel adapter={LANDLORD} ret={ret} patch={patch} />
        <ComingSoonPanel icon={Receipt} name="Payroll" target="Employment income"
          note="Per-employee pay isn’t stored yet — P32 only records employer-level PAYE/NIC. Enter employment income in Review & Adjust for now." />
        <ComingSoonPanel icon={Users} name="Partnership tax return" target="Partnership share"
          note="Once the partnership (SA800) return is built, each partner’s profit share will import here. Add partnership income manually in Review & Adjust for now." />
      </div>
    </div>
  );
}

function ToolImportPanel<S>({ adapter, ret, patch }: { adapter: ToolAdapter<S>; ret: TaxReturn; patch: Patch }) {
  const [src, setSrc] = useState<{ clientId: string; name: string; ref: string; own: boolean }>({
    clientId: ret.clientId ?? '', name: ret.clientName ?? 'This client', ref: ret.clientRef ?? '', own: true,
  });
  const [summary, setSummary] = useState<S | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (clientId: string) => {
    if (!clientId) { setError('No client linked to this return.'); setSummary(null); return; }
    setLoading(true); setError('');
    try { setSummary(await adapter.fetch(clientId, ret.taxYear)); }
    catch (e) { setError(e instanceof Error ? e.message : `Could not read ${adapter.name}.`); }
    finally { setLoading(false); }
  }, [adapter, ret.taxYear]);

  useEffect(() => { void load(src.clientId); }, [load, src.clientId]);

  function pick(clientId: string, name: string, ref: string) {
    setSrc({ clientId, name, ref, own: clientId === ret.clientId });
    setSearching(false); setImported(false);
  }

  function doImport() {
    if (!summary || !adapter.hasData(summary)) return;
    const label = `${src.name}${src.ref ? ` (${src.ref})` : ''}`;
    patch(r => ({
      ...r,
      income: adapter.merge(r.income, summary, { clientId: src.clientId, label }),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: adapter.timelineLabel(label) }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  const has = summary ? adapter.hasData(summary) : false;
  const note = summary && adapter.note ? adapter.note(summary) : undefined;
  const Icon = adapter.icon;

  return (
    <StudioCard className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Icon size={18} /></div>
          <div>
            <p className="text-[13px] font-bold text-[var(--text-primary)]">{adapter.name}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{adapter.target}</p>
          </div>
        </div>
        <button onClick={() => load(src.clientId)} disabled={loading} className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-black/[0.03] hover:text-[var(--text-secondary)] disabled:opacity-40" aria-label={`Refresh ${adapter.name}`}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* Source client + change */}
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-black/[0.02] px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[11.5px] font-semibold text-[var(--text-primary)]">
            {src.name || '—'}{src.ref ? <span className="font-mono font-normal text-[var(--text-muted)]"> · {src.ref}</span> : null}
          </p>
          <p className="text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">{src.own ? 'This return’s client' : 'Another client'}</p>
        </div>
        <button onClick={() => setSearching(s => !s)} className="shrink-0 text-[11.5px] font-semibold text-[var(--accent)] hover:underline">
          {searching ? 'Close' : 'Change'}
        </button>
      </div>

      {searching && <InlineClientSearch onPick={pick} />}

      {/* Body */}
      <div className="mt-3 min-h-[48px] flex-1">
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-[12px] text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Reading…</div>
        ) : error ? (
          <p className="py-2 text-[12px] text-rose-600">{error}</p>
        ) : has && summary ? (
          <div>
            <p className="text-[15px] font-extrabold text-[var(--text-primary)]">{adapter.headline(summary)}</p>
            {note && <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700"><Info size={11} className="mt-0.5 shrink-0" /> {note}</p>}
          </div>
        ) : (
          <p className="flex items-start gap-1.5 py-2 text-[11.5px] text-[var(--text-muted)]">
            <Info size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" /> No saved {adapter.name} run for {src.own ? 'this client' : 'that client'} in {ret.taxYear}.
          </p>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button onClick={doImport} disabled={!has} className="btn-primary disabled:opacity-40">
          {imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import'}
        </button>
      </div>
    </StudioCard>
  );
}

// In-flow client search (results render in normal document flow, so nothing gets
// clipped by the panel's rounded/blurred surface).
function InlineClientSearch({ onPick }: { onPick: (id: string, name: string, ref: string) => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<{ id: string; name: string; client_ref: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}`);
        if (r.ok) { const d = await r.json(); if (!cancelled) setOpts((d.clients ?? []) as { id: string; name: string; client_ref: string }[]); }
      } finally { if (!cancelled) setLoading(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-white/70 p-1.5">
      <div className="flex items-center gap-1.5 rounded-md bg-black/[0.02] px-2 py-1">
        <Search size={13} className="shrink-0 text-[var(--text-muted)]" />
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search any client…" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-muted)]" />
        {loading && <Loader2 size={12} className="shrink-0 animate-spin text-[var(--text-muted)]" />}
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto">
        {opts.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-[var(--text-muted)]">{q ? 'No clients found' : 'Type to search…'}</p>
        ) : opts.map(c => (
          <button key={c.id} onClick={() => onPick(c.id, c.name, c.client_ref)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--accent)]/[0.06]">
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">{c.name}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">{c.client_ref}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ComingSoonPanel({ icon: Icon, name, target, note }: { icon: LucideIcon; name: string; target: string; note: string }) {
  return (
    <StudioCard className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Icon size={18} /></div>
          <div>
            <p className="text-[13px] font-bold text-[var(--text-primary)]">{name}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{target}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">Soon</span>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-[var(--text-muted)]"><Info size={13} className="mt-0.5 shrink-0" /> {note}</p>
    </StudioCard>
  );
}
