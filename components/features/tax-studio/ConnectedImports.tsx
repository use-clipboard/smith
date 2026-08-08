'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Link2, CalendarCheck, Calculator, BookOpen, House, Receipt, Users,
  Loader2, Download, Check, Info, RefreshCw, Search, Sparkles, FileUp,
} from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import {
  fetchMtdItSummary, fetchAccountsStudioSummary, fetchLandlordSummary, fetchBookkeepingSummary,
  mergeCrossMtd, mergeCrossAccounts, mergeCrossLandlord, mergeCrossBookkeeping,
  buildItemisedTrade, mergeItemisedTrade, fetchTradePlFromFiles, dmyToIso,
  summaryHasData, netFromPlLines, buildPartnershipFromNet, mergeImportedPartnership, appendUploadedPartnership,
  type MtdItAnnualSummary, type AccountsStudioSummary, type LandlordSummary, type BookkeepingSummary,
  type SourceRef, type PlLine, type BoxAllocation, type TradePeriod,
} from './integrations';
import { encodeFile } from './extract';
import TradeImportReview from './TradeImportReview';
import type { TaxReturn, Sa100Income } from './types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

// A selectable sub-part of a source (e.g. MTD IT's sole-trader / UK / foreign).
interface ToolPart { key: string; label: string; profit: number; }

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
  /** Optional selectable sub-parts — when present the panel shows a checkbox per
   *  part and passes the chosen keys to `merge`. */
  parts?: (s: S) => ToolPart[];
  merge: (income: Sa100Income, s: S, src: SourceRef, selected?: Set<string>) => Sa100Income;
  /** When present and lines exist, Import opens the AI itemise-and-review flow
   *  (P&L lines → SA103F boxes) instead of the single net-profit merge. */
  getLines?: (s: S) => PlLine[] | undefined;
  itemiseKind?: 'as' | 'bk';
  expectedNet?: (s: S) => number;
  /** Accounting period this source covers — pulled into boxes 8/9 (or 7). */
  datesFor?: (s: S) => TradePeriod;
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
  parts: s => {
    const out: ToolPart[] = [];
    if (s.selfEmployment.length) out.push({ key: 'se', label: s.selfEmployment.length === 1 ? (s.selfEmployment[0].label || 'Sole trader') : `Sole trader (${s.selfEmployment.length} trades)`, profit: s.selfEmployment.reduce((a, t) => a + t.profit, 0) });
    if (s.ukProperty) out.push({ key: 'uk', label: s.ukProperty.label || 'UK property', profit: s.ukProperty.profit });
    if (s.foreignProperty) out.push({ key: 'foreign', label: s.foreignProperty.label || 'Foreign property', profit: s.foreignProperty.profit });
    return out;
  },
  merge: (i, s, src, selected) => mergeCrossMtd(i, s, {
    soleTrader: selected ? selected.has('se') : s.selfEmployment.length > 0,
    ukProperty: selected ? selected.has('uk') : !!s.ukProperty,
    foreignProperty: selected ? selected.has('foreign') : !!s.foreignProperty,
  }, src),
  timelineLabel: l => `Imported MTD IT figures from ${l}`,
};

const ACCOUNTS: ToolAdapter<AccountsStudioSummary> = {
  name: 'Accounts Studio', target: 'Trade profit', icon: Calculator,
  fetch: fetchAccountsStudioSummary, hasData: s => s.found && !!s.netProfit, headline: s => `${fmtMoney(s.netProfit)} net profit`, note: s => s.note,
  merge: mergeCrossAccounts,
  getLines: s => s.lines, itemiseKind: 'as', expectedNet: s => s.netProfit,
  datesFor: s => ({ start: dmyToIso(s.periodStart), end: dmyToIso(s.periodEnd) }),
  timelineLabel: l => `Imported itemised trade from ${l} (Accounts Studio)`,
};

const BOOKKEEPING: ToolAdapter<BookkeepingSummary> = {
  name: 'Bookkeeping', target: 'Trade profit', icon: BookOpen,
  fetch: fetchBookkeepingSummary, hasData: s => s.found && !!s.netProfit, headline: s => `${fmtMoney(s.netProfit)} net profit`, note: s => s.note,
  merge: mergeCrossBookkeeping,
  getLines: s => s.lines, itemiseKind: 'bk', expectedNet: s => s.netProfit,
  datesFor: s => ({ start: s.from || undefined, end: s.to || undefined }),
  timelineLabel: l => `Imported itemised trade from ${l} (Bookkeeping)`,
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
          Reads this client by default — hit <span className="font-semibold">Change</span> on any tool to pull from another client. A client can have several trades or partnerships: link each business’s own client code, or upload each set of accounts — every import adds a separate entry.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ToolImportPanel adapter={MTD} ret={ret} patch={patch} />
        <ToolImportPanel adapter={ACCOUNTS} ret={ret} patch={patch} />
        <ToolImportPanel adapter={BOOKKEEPING} ret={ret} patch={patch} />
        <UploadAccountsCard ret={ret} patch={patch} />
        <ToolImportPanel adapter={LANDLORD} ret={ret} patch={patch} />
        <PartnershipAccountsCard ret={ret} patch={patch} />
        <UploadPartnershipCard ret={ret} patch={patch} />
        <ComingSoonPanel icon={Receipt} name="Payroll" target="Employment income"
          note="Per-employee pay isn’t stored yet — P32 only records employer-level PAYE/NIC. Enter employment income in Review & Adjust for now." />
        <ComingSoonPanel icon={Users} name="Partnership tax return (SA800)" target="Direct partner-share link"
          note="Accounts Studio and uploads already feed each partner’s share below. A direct SA800 link (auto profit-share allocation) will follow once the partnership return is built." />
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<PlLine[] | null>(null);

  const load = useCallback(async (clientId: string) => {
    if (!clientId) { setError('No client linked to this return.'); setSummary(null); return; }
    setLoading(true); setError('');
    try { setSummary(await adapter.fetch(clientId, ret.taxYear)); }
    catch (e) { setError(e instanceof Error ? e.message : `Could not read ${adapter.name}.`); }
    finally { setLoading(false); }
  }, [adapter, ret.taxYear]);

  useEffect(() => { void load(src.clientId); }, [load, src.clientId]);

  // When a source's parts change, default to selecting them all.
  useEffect(() => {
    if (summary && adapter.parts) setSelected(new Set(adapter.parts(summary).map(p => p.key)));
  }, [summary, adapter]);

  function pick(clientId: string, name: string, ref: string) {
    setSrc({ clientId, name, ref, own: clientId === ret.clientId });
    setSearching(false); setImported(false);
  }

  const has = summary ? adapter.hasData(summary) : false;
  const note = summary && adapter.note ? adapter.note(summary) : undefined;
  const parts = summary && has && adapter.parts ? adapter.parts(summary) : null;
  const nothingChosen = !!parts && selected.size === 0;
  const Icon = adapter.icon;

  const importLabel = () => `${src.name}${src.ref ? ` (${src.ref})` : ''}`;
  const itemisable = summary && adapter.getLines ? (adapter.getLines(summary) ?? []) : [];
  const canItemise = !!adapter.itemiseKind && itemisable.length > 0;

  function doImport() {
    if (!summary || !adapter.hasData(summary) || nothingChosen) return;
    if (canItemise) { setReviewing(itemisable); return; }
    const label = importLabel();
    patch(r => ({
      ...r,
      income: adapter.merge(r.income, summary, { clientId: src.clientId, label }, parts ? selected : undefined),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: adapter.timelineLabel(label) }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  function confirmItemised(allocations: BoxAllocation[]) {
    if (!adapter.itemiseKind) return;
    const label = importLabel();
    const trade = buildItemisedTrade('tmp', `Trade — ${label}`, allocations, summary ? adapter.datesFor?.(summary) : undefined);
    patch(r => ({
      ...r,
      income: mergeItemisedTrade(r.income, trade, { clientId: src.clientId, label }, adapter.itemiseKind!),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: adapter.timelineLabel(label) }],
    }));
    setReviewing(null); setImported(true); setTimeout(() => setImported(false), 2500);
  }

  function toggle(key: string) {
    setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

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
        ) : has && summary && parts ? (
          <div className="space-y-1.5">
            {parts.map(p => {
              const on = selected.has(p.key);
              return (
                <label key={p.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${on ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.04]' : 'border-[var(--border)] bg-white/60'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.key)} className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">{p.label}</span>
                  <span className="shrink-0 text-[12px] font-bold text-[var(--text-primary)]">{fmtMoney(p.profit)}</span>
                </label>
              );
            })}
            {note && <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700"><Info size={11} className="mt-0.5 shrink-0" /> {note}</p>}
          </div>
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
        <button onClick={doImport} disabled={!has || nothingChosen} className="btn-primary disabled:opacity-40">
          {imported ? <Check size={15} /> : canItemise ? <Sparkles size={15} /> : <Download size={15} />} {imported ? 'Imported' : canItemise ? 'Itemise & import' : 'Import'}
        </button>
      </div>

      {reviewing && summary && (
        <TradeImportReview
          lines={reviewing}
          sourceLabel={importLabel()}
          expectedNet={adapter.expectedNet?.(summary)}
          onConfirm={confirmItemised}
          onClose={() => setReviewing(null)}
        />
      )}
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

// Upload a set of accounts / trial balance for a sole trader, extract its P&L
// lines and run them through the same AI itemise-and-review flow as the
// connected tools — so it fills SA103F boxes 15–30 + disallowables with no
// manual entry, for clients whose books aren't in Bookkeeping/Accounts Studio.
function UploadAccountsCard({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<PlLine[] | null>(null);
  const [srcLabel, setSrcLabel] = useState('');
  const [period, setPeriod] = useState<TradePeriod | undefined>();
  const [imported, setImported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setBusy(true); setError('');
    try {
      const files = await Promise.all([...list].map(encodeFile));
      const { lines, period } = await fetchTradePlFromFiles(files);
      if (!lines.length) { setError('No profit & loss lines found in that file.'); return; }
      setSrcLabel(list.length === 1 ? list[0].name : `${list.length} files`);
      setPeriod(period);
      setReviewing(lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the accounts.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function confirmItemised(allocations: BoxAllocation[]) {
    const trade = buildItemisedTrade(`upl-${ret.income.selfEmployment.length}-${srcLabel}`, `Trade — ${srcLabel}`, allocations, period);
    patch(r => ({
      ...r,
      income: { ...r.income, selfEmployment: [...r.income.selfEmployment, trade] },
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported itemised trade from uploaded accounts (${srcLabel})` }],
    }));
    setReviewing(null);
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  return (
    <StudioCard className="flex flex-col p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><FileUp size={18} /></div>
        <div>
          <p className="text-[13px] font-bold text-[var(--text-primary)]">Upload accounts / TB</p>
          <p className="text-[11px] text-[var(--text-muted)]">Trade profit</p>
        </div>
      </div>

      <div className="mt-3 min-h-[48px] flex-1">
        {busy ? (
          <div className="flex items-center gap-2 py-3 text-[12px] text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Reading the accounts…</div>
        ) : error ? (
          <p className="py-2 text-[12px] text-rose-600">{error}</p>
        ) : (
          <p className="flex items-start gap-1.5 py-2 text-[11.5px] text-[var(--text-muted)]">
            <Info size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" /> For clients not in Bookkeeping or Accounts Studio — upload a set of accounts or a trial balance and SMITH itemises it into the SA103F boxes.
          </p>
        )}
      </div>

      <input ref={inputRef} type="file" accept=".pdf,.csv,.txt,image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
      <div className="mt-2 flex justify-end">
        <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-primary disabled:opacity-40">
          {imported ? <Check size={15} /> : <FileUp size={15} />} {imported ? 'Imported' : 'Upload & itemise'}
        </button>
      </div>

      {reviewing && (
        <TradeImportReview lines={reviewing} sourceLabel={srcLabel} onConfirm={confirmItemised} onClose={() => setReviewing(null)} />
      )}
    </StudioCard>
  );
}

// A partner's profit-share input + the resulting share figure — SA104 records
// the partner's SHARE of the partnership's net profit.
function ShareInput({ share, setShare, netProfit }: { share: number; setShare: (n: number) => void; netProfit: number }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-1.5">
      <span className="text-[11px] font-medium text-[var(--text-muted)]">Your profit share</span>
      <input type="number" min={0} max={100} value={share || ''} onChange={e => setShare(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="input-base w-16 py-0.5 text-right text-[12px]" />
      <span className="text-[11px] text-[var(--text-muted)]">%</span>
      <span className="ml-auto text-[11px] text-[var(--text-muted)]">share <span className="font-bold text-[var(--text-primary)]">{fmtMoney(Math.round(netProfit * (share || 0) / 100))}</span></span>
    </div>
  );
}

// Pull a partnership's accounts (Accounts Studio) for this client — or a
// partnership held under its own client code — and add the partner's SHARE as an
// SA104 entry. Idempotent per source client, so linking a second partnership
// client adds a second partnership.
function PartnershipAccountsCard({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const [src, setSrc] = useState<{ clientId: string; name: string; ref: string; own: boolean }>({
    clientId: ret.clientId ?? '', name: ret.clientName ?? 'This client', ref: ret.clientRef ?? '', own: true,
  });
  const [summary, setSummary] = useState<AccountsStudioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [share, setShare] = useState(100);
  const [imported, setImported] = useState(false);

  const load = useCallback(async (clientId: string) => {
    if (!clientId) { setError('No client linked to this return.'); setSummary(null); return; }
    setLoading(true); setError('');
    try { setSummary(await fetchAccountsStudioSummary(clientId, ret.taxYear)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read Accounts Studio.'); }
    finally { setLoading(false); }
  }, [ret.taxYear]);
  useEffect(() => { void load(src.clientId); }, [load, src.clientId]);

  function pick(clientId: string, name: string, ref: string) {
    setSrc({ clientId, name, ref, own: clientId === ret.clientId }); setSearching(false); setImported(false);
  }

  const has = !!summary && summary.found && !!summary.netProfit;
  const label = () => `${src.name}${src.ref ? ` (${src.ref})` : ''}`;

  function doImport() {
    if (!has || !summary) return;
    const lbl = label();
    const partnership = buildPartnershipFromNet('tmp', `Partnership — ${lbl}`, summary.netProfit, share, { start: dmyToIso(summary.periodStart), end: dmyToIso(summary.periodEnd) });
    patch(r => ({
      ...r,
      income: mergeImportedPartnership(r.income, partnership, { clientId: src.clientId, label: lbl }, 'as'),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported partnership share from ${lbl} (Accounts Studio)` }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  return (
    <StudioCard className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Users size={18} /></div>
          <div>
            <p className="text-[13px] font-bold text-[var(--text-primary)]">Partnership from Accounts Studio</p>
            <p className="text-[11px] text-[var(--text-muted)]">Partnership share (SA104)</p>
          </div>
        </div>
        <button onClick={() => load(src.clientId)} disabled={loading} className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-black/[0.03] hover:text-[var(--text-secondary)] disabled:opacity-40" aria-label="Refresh Accounts Studio">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-black/[0.02] px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[11.5px] font-semibold text-[var(--text-primary)]">{src.name || '—'}{src.ref ? <span className="font-mono font-normal text-[var(--text-muted)]"> · {src.ref}</span> : null}</p>
          <p className="text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">{src.own ? 'This return’s client' : 'Another client'}</p>
        </div>
        <button onClick={() => setSearching(s => !s)} className="shrink-0 text-[11.5px] font-semibold text-[var(--accent)] hover:underline">{searching ? 'Close' : 'Change'}</button>
      </div>
      {searching && <InlineClientSearch onPick={pick} />}

      <div className="mt-3 min-h-[48px] flex-1">
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-[12px] text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Reading…</div>
        ) : error ? (
          <p className="py-2 text-[12px] text-rose-600">{error}</p>
        ) : has && summary ? (
          <div>
            <p className="text-[15px] font-extrabold text-[var(--text-primary)]">{fmtMoney(summary.netProfit)} net profit</p>
            {!summary.isPartnership && <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700"><Info size={11} className="mt-0.5 shrink-0" /> These accounts aren’t flagged as a partnership — double-check the source before adding as a partnership share.</p>}
            <ShareInput share={share} setShare={setShare} netProfit={summary.netProfit} />
          </div>
        ) : (
          <p className="flex items-start gap-1.5 py-2 text-[11.5px] text-[var(--text-muted)]"><Info size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" /> No saved Accounts Studio run for {src.own ? 'this client' : 'that client'} in {ret.taxYear}.</p>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button onClick={doImport} disabled={!has} className="btn-primary disabled:opacity-40">{imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Added' : 'Add partnership'}</button>
      </div>
    </StudioCard>
  );
}

// Upload a partnership's accounts / trial balance, read its net profit and add
// the partner's share as a new SA104 partnership. Each upload appends a new one.
function UploadPartnershipCard({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [share, setShare] = useState(100);
  const [net, setNet] = useState<number | null>(null);
  const [period, setPeriod] = useState<TradePeriod | undefined>();
  const [srcLabel, setSrcLabel] = useState('');
  const [imported, setImported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setBusy(true); setError(''); setNet(null);
    try {
      const files = await Promise.all([...list].map(encodeFile));
      const { lines, period } = await fetchTradePlFromFiles(files);
      if (!lines.length) { setError('No profit & loss lines found in that file.'); return; }
      setNet(Math.round(netFromPlLines(lines)));
      setPeriod(period);
      setSrcLabel(list.length === 1 ? list[0].name : `${list.length} files`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the accounts.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function addPartnership() {
    if (net == null) return;
    const partnership = buildPartnershipFromNet(`upl-pt-${(ret.income.partnerships ?? []).length}-${srcLabel}`, `Partnership — ${srcLabel}`, net, share, period);
    patch(r => ({
      ...r,
      income: appendUploadedPartnership(r.income, partnership),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported partnership share from uploaded accounts (${srcLabel})` }],
    }));
    setNet(null); setImported(true); setTimeout(() => setImported(false), 2500);
  }

  return (
    <StudioCard className="flex flex-col p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><FileUp size={18} /></div>
        <div>
          <p className="text-[13px] font-bold text-[var(--text-primary)]">Upload partnership accounts / TB</p>
          <p className="text-[11px] text-[var(--text-muted)]">Partnership share (SA104)</p>
        </div>
      </div>

      <div className="mt-3 min-h-[48px] flex-1">
        {busy ? (
          <div className="flex items-center gap-2 py-3 text-[12px] text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Reading the accounts…</div>
        ) : error ? (
          <p className="py-2 text-[12px] text-rose-600">{error}</p>
        ) : net != null ? (
          <div>
            <p className="text-[15px] font-extrabold text-[var(--text-primary)]">{fmtMoney(net)} net profit <span className="text-[11px] font-medium text-[var(--text-muted)]">— {srcLabel}</span></p>
            <ShareInput share={share} setShare={setShare} netProfit={net} />
          </div>
        ) : (
          <p className="flex items-start gap-1.5 py-2 text-[11.5px] text-[var(--text-muted)]"><Info size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" /> Upload a partnership’s accounts or trial balance — SMITH reads the net profit and adds your share to the SA104. Upload again to add another partnership.</p>
        )}
      </div>

      <input ref={inputRef} type="file" accept=".pdf,.csv,.txt,image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
      <div className="mt-2 flex justify-end gap-2">
        {net != null ? (
          <button onClick={addPartnership} className="btn-primary">{imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Added' : 'Add partnership'}</button>
        ) : (
          <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-primary disabled:opacity-40">{imported ? <Check size={15} /> : <FileUp size={15} />} {imported ? 'Added' : 'Upload'}</button>
        )}
      </div>
    </StudioCard>
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
