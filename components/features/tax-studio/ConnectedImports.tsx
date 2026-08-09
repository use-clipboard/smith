'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Link2, CalendarCheck, Calculator, BookOpen, House, Receipt, Users,
  Loader2, Download, Check, Info, RefreshCw, Search, Sparkles, FileUp,
  Plus, Trash2, CalendarDays,
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
  /** Human date/period label for the found data (assurance it's the right one). */
  dateLabel?: (s: S) => string | undefined;
  timelineLabel: (sourceLabel: string) => string;
}

// dd-mm-yyyy display for an ISO or already-UK date string.
function ukDate(s?: string): string {
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : s;
}
function rangeLabel(a?: string, b?: string): string {
  const x = ukDate(a), y = ukDate(b);
  return x && y ? `${x} – ${y}` : (x || y || '');
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
  dateLabel: s => `${s.taxYear}${s.quartersFound ? ` · ${s.quartersFound} quarter${s.quartersFound === 1 ? '' : 's'}` : ''}`,
  timelineLabel: l => `Imported MTD IT figures from ${l}`,
};

const ACCOUNTS: ToolAdapter<AccountsStudioSummary> = {
  name: 'Accounts Studio', target: 'Trade profit', icon: Calculator,
  fetch: fetchAccountsStudioSummary, hasData: s => s.found && !!s.netProfit, headline: s => `${fmtMoney(s.netProfit)} net profit`, note: s => s.note,
  merge: mergeCrossAccounts,
  getLines: s => s.lines, itemiseKind: 'as', expectedNet: s => s.netProfit,
  datesFor: s => ({ start: dmyToIso(s.periodStart), end: dmyToIso(s.periodEnd) }),
  dateLabel: s => rangeLabel(s.periodStart, s.periodEnd),
  timelineLabel: l => `Imported itemised trade from ${l} (Accounts Studio)`,
};

const BOOKKEEPING: ToolAdapter<BookkeepingSummary> = {
  name: 'Bookkeeping', target: 'Trade profit', icon: BookOpen,
  fetch: fetchBookkeepingSummary, hasData: s => s.found && !!s.netProfit, headline: s => `${fmtMoney(s.netProfit)} net profit`, note: s => s.note,
  merge: mergeCrossBookkeeping,
  getLines: s => s.lines, itemiseKind: 'bk', expectedNet: s => s.netProfit,
  datesFor: s => ({ start: s.from || undefined, end: s.to || undefined }),
  dateLabel: s => rangeLabel(s.from, s.to),
  timelineLabel: l => `Imported itemised trade from ${l} (Bookkeeping)`,
};

const LANDLORD: ToolAdapter<LandlordSummary> = {
  name: 'Landlord Analysis', target: 'UK property', icon: House,
  fetch: fetchLandlordSummary, hasData: s => s.found && !!s.taxableProfit,
  headline: s => `${fmtMoney(s.taxableProfit)} taxable profit${s.ownerSharePct != null ? ` · your ${s.ownerSharePct}% share` : ''}`,
  note: s => [s.ownerSharePct != null && s.analysisClientName ? `This is your ${s.ownerSharePct}% share of ${s.analysisClientName}’s rental portfolio.` : '', s.note ?? ''].filter(Boolean).join(' ') || undefined,
  merge: mergeCrossLandlord, dateLabel: s => rangeLabel(s.dateFrom, s.dateTo),
  timelineLabel: l => `Imported rental from ${l} (Landlord Analysis)`,
};

export default function ConnectedImports({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]">
          <Link2 size={15} className="text-[var(--accent)]" /> Pull figures from connected tools
        </p>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
          Each tool shows what it found for this client — with the period and amount. Tick what to include, hit <span className="font-semibold">Add another source</span> to pull a second business (or another client’s data), and use the bin to drop any. Nothing imports until you press Import.
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

interface SourceEntry<S> {
  key: string;
  clientId: string; name: string; ref: string; own: boolean;
  summary: S | null; loading: boolean; error: string;
  included: boolean;
  selected: Set<string>;
}

function ToolImportPanel<S>({ adapter, ret, patch }: { adapter: ToolAdapter<S>; ret: TaxReturn; patch: Patch }) {
  const [sources, setSources] = useState<SourceEntry<S>[]>([{
    key: 'own', clientId: ret.clientId ?? '', name: ret.clientName ?? 'This client', ref: ret.clientRef ?? '', own: true,
    summary: null, loading: !!ret.clientId, error: ret.clientId ? '' : 'No client linked to this return.', included: true, selected: new Set<string>(),
  }]);
  const [searching, setSearching] = useState(false);
  const [imported, setImported] = useState(false);
  const [queue, setQueue] = useState<{ src: SourceEntry<S>; lines: PlLine[] }[]>([]);

  const patchSource = useCallback((key: string, u: Partial<SourceEntry<S>>) =>
    setSources(ss => ss.map(s => (s.key === key ? { ...s, ...u } : s))), []);

  const loadSource = useCallback(async (key: string, clientId: string) => {
    if (!clientId) { patchSource(key, { loading: false, error: 'No client linked to this return.' }); return; }
    patchSource(key, { loading: true, error: '' });
    try {
      const summary = await adapter.fetch(clientId, ret.taxYear);
      patchSource(key, {
        summary, loading: false, included: adapter.hasData(summary),
        selected: adapter.parts ? new Set(adapter.parts(summary).map(p => p.key)) : new Set<string>(),
      });
    } catch (e) {
      patchSource(key, { loading: false, error: e instanceof Error ? e.message : `Could not read ${adapter.name}.` });
    }
  }, [adapter, ret.taxYear, patchSource]);

  useEffect(() => { if (ret.clientId) void loadSource('own', ret.clientId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (s: SourceEntry<S>) => `${s.name}${s.ref ? ` (${s.ref})` : ''}`;

  function addSource(clientId: string, name: string, ref: string) {
    if (sources.some(s => s.clientId === clientId)) { setSearching(false); return; } // already listed
    const key = `s-${Date.now()}`;
    setSources(ss => [...ss, { key, clientId, name, ref, own: clientId === ret.clientId, summary: null, loading: true, error: '', included: true, selected: new Set<string>() }]);
    setSearching(false);
    void loadSource(key, clientId);
  }
  const removeSource = (key: string) => setSources(ss => ss.filter(s => s.key !== key));
  const toggleInclude = (key: string) => setSources(ss => ss.map(s => (s.key === key ? { ...s, included: !s.included } : s)));
  const togglePart = (key: string, part: string) => setSources(ss => ss.map(s => {
    if (s.key !== key) return s;
    const n = new Set(s.selected); if (n.has(part)) n.delete(part); else n.add(part);
    return { ...s, selected: n };
  }));
  const reloadAll = () => sources.forEach(s => { if (s.clientId) void loadSource(s.key, s.clientId); });

  const chosen = () => sources.filter(s => s.summary && adapter.hasData(s.summary) && s.included && (!adapter.parts || s.selected.size > 0));
  const Icon = adapter.icon;

  function mergeDirect(r: TaxReturn, s: SourceEntry<S>): TaxReturn {
    return {
      ...r,
      income: adapter.merge(r.income, s.summary as S, { clientId: s.clientId, label: label(s) }, adapter.parts ? s.selected : undefined),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: adapter.timelineLabel(label(s)) }],
    };
  }

  function doImport() {
    const list = chosen();
    if (!list.length) return;
    const q: { src: SourceEntry<S>; lines: PlLine[] }[] = [];
    let didDirect = false;
    for (const s of list) {
      const lines = adapter.getLines && s.summary ? (adapter.getLines(s.summary) ?? []) : [];
      if (adapter.itemiseKind && lines.length) q.push({ src: s, lines });
      else { patch(r => mergeDirect(r, s)); didDirect = true; }
    }
    if (q.length) setQueue(q);
    else if (didDirect) { setImported(true); setTimeout(() => setImported(false), 2500); }
  }

  function confirmItemised(allocations: BoxAllocation[]) {
    const head = queue[0];
    if (head?.src.summary && adapter.itemiseKind) {
      const trade = buildItemisedTrade('tmp', `Trade — ${label(head.src)}`, allocations, adapter.datesFor?.(head.src.summary));
      patch(r => ({
        ...r,
        income: mergeItemisedTrade(r.income, trade, { clientId: head.src.clientId, label: label(head.src) }, adapter.itemiseKind!),
        timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: adapter.timelineLabel(label(head.src)) }],
      }));
    }
    const rest = queue.slice(1);
    setQueue(rest);
    if (!rest.length) { setImported(true); setTimeout(() => setImported(false), 2500); }
  }

  const count = chosen().length;

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
        <button onClick={reloadAll} className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-black/[0.03] hover:text-[var(--text-secondary)]" aria-label={`Refresh ${adapter.name}`}><RefreshCw size={14} /></button>
      </div>

      <div className="mt-3 flex-1 space-y-2">
        {sources.map(s => (
          <SourceRow key={s.key} adapter={adapter} entry={s} taxYear={ret.taxYear}
            onToggleInclude={() => toggleInclude(s.key)} onTogglePart={p => togglePart(s.key, p)}
            onRemove={() => removeSource(s.key)} />
        ))}

        {searching ? (
          <InlineClientSearch onPick={addSource} />
        ) : (
          <button onClick={() => setSearching(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] py-1.5 text-[11.5px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/[0.04]">
            <Plus size={13} /> Add another source
          </button>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button onClick={doImport} disabled={count === 0} className="btn-primary disabled:opacity-40">
          {imported ? <Check size={15} /> : adapter.itemiseKind ? <Sparkles size={15} /> : <Download size={15} />} {imported ? 'Imported' : `Import selected${count > 1 ? ` (${count})` : ''}`}
        </button>
      </div>

      {queue.length > 0 && queue[0].src.summary && (
        <TradeImportReview
          lines={queue[0].lines}
          sourceLabel={label(queue[0].src)}
          expectedNet={adapter.expectedNet?.(queue[0].src.summary)}
          onConfirm={confirmItemised}
          onClose={() => setQueue([])}
        />
      )}
    </StudioCard>
  );
}

// One source (client) inside a tool card: shows what was found — amount + period
// — with an include toggle, per-part toggles (MTD), and a bin to remove it.
function SourceRow<S>({ adapter, entry, taxYear, onToggleInclude, onTogglePart, onRemove }: {
  adapter: ToolAdapter<S>; entry: SourceEntry<S>; taxYear: string;
  onToggleInclude: () => void; onTogglePart: (p: string) => void; onRemove: () => void;
}) {
  const s = entry.summary;
  const has = !!s && adapter.hasData(s);
  const parts = s && has && adapter.parts ? adapter.parts(s) : null;
  const note = s && has && adapter.note ? adapter.note(s) : undefined;
  const date = s && has && adapter.dateLabel ? adapter.dateLabel(s) : undefined;

  return (
    <div className={`rounded-xl border px-2.5 py-2 transition-colors ${entry.included && has ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.05]' : 'border-[var(--border)] bg-white/60'}`}>
      <div className="flex items-start gap-2">
        {has
          ? <input type="checkbox" checked={entry.included} onChange={onToggleInclude} className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-[var(--accent)]" aria-label="Include this source" />
          : <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-semibold text-[var(--text-primary)]">
            {entry.name || '—'}{entry.ref ? <span className="font-mono font-normal text-[var(--text-muted)]"> · {entry.ref}</span> : null}
            {entry.own && <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-500">This client</span>}
          </p>

          {entry.loading ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Loader2 size={11} className="animate-spin" /> Reading…</p>
          ) : entry.error ? (
            <p className="mt-0.5 text-[11px] text-rose-600">{entry.error}</p>
          ) : has && s ? (
            <>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12.5px] font-bold text-[var(--text-primary)]">{adapter.headline(s)}</span>
                {date && <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)]"><CalendarDays size={10} /> {date}</span>}
              </div>
              {parts && (
                <div className="mt-1.5 space-y-1">
                  {parts.map(p => {
                    const on = entry.selected.has(p.key);
                    return (
                      <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-white/70 px-2 py-1">
                        <input type="checkbox" checked={on} onChange={() => onTogglePart(p.key)} className="h-3 w-3 rounded border-slate-300 text-[var(--accent)]" />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--text-primary)]">{p.label}</span>
                        <span className="shrink-0 text-[11.5px] font-bold text-[var(--text-primary)]">{fmtMoney(p.profit)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {note && <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700"><Info size={11} className="mt-0.5 shrink-0" /> {note}</p>}
            </>
          ) : (
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">No {adapter.name} data for {taxYear}.</p>
          )}
        </div>

        <button onClick={onRemove} className="shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500" aria-label="Remove source"><Trash2 size={13} /></button>
      </div>
    </div>
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
interface PtSourceEntry {
  key: string;
  clientId: string; name: string; ref: string; own: boolean;
  summary: AccountsStudioSummary | null; loading: boolean; error: string;
  included: boolean; share: number;
}

function PartnershipAccountsCard({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const [sources, setSources] = useState<PtSourceEntry[]>([{
    key: 'own', clientId: ret.clientId ?? '', name: ret.clientName ?? 'This client', ref: ret.clientRef ?? '', own: true,
    summary: null, loading: !!ret.clientId, error: ret.clientId ? '' : 'No client linked to this return.', included: true, share: 100,
  }]);
  const [searching, setSearching] = useState(false);
  const [imported, setImported] = useState(false);

  const patchSource = useCallback((key: string, u: Partial<PtSourceEntry>) =>
    setSources(ss => ss.map(s => (s.key === key ? { ...s, ...u } : s))), []);

  const loadSource = useCallback(async (key: string, clientId: string) => {
    if (!clientId) { patchSource(key, { loading: false, error: 'No client linked to this return.' }); return; }
    patchSource(key, { loading: true, error: '' });
    try {
      const summary = await fetchAccountsStudioSummary(clientId, ret.taxYear);
      patchSource(key, { summary, loading: false, included: summary.found && !!summary.netProfit });
    } catch (e) {
      patchSource(key, { loading: false, error: e instanceof Error ? e.message : 'Could not read Accounts Studio.' });
    }
  }, [ret.taxYear, patchSource]);

  useEffect(() => { if (ret.clientId) void loadSource('own', ret.clientId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (s: PtSourceEntry) => `${s.name}${s.ref ? ` (${s.ref})` : ''}`;
  const has = (s: PtSourceEntry) => !!s.summary && s.summary.found && !!s.summary.netProfit;

  function addSource(clientId: string, name: string, ref: string) {
    if (sources.some(s => s.clientId === clientId)) { setSearching(false); return; }
    const key = `s-${Date.now()}`;
    setSources(ss => [...ss, { key, clientId, name, ref, own: clientId === ret.clientId, summary: null, loading: true, error: '', included: true, share: 100 }]);
    setSearching(false);
    void loadSource(key, clientId);
  }
  const removeSource = (key: string) => setSources(ss => ss.filter(s => s.key !== key));
  const toggleInclude = (key: string) => setSources(ss => ss.map(s => (s.key === key ? { ...s, included: !s.included } : s)));
  const setShare = (key: string, share: number) => patchSource(key, { share });
  const reloadAll = () => sources.forEach(s => { if (s.clientId) void loadSource(s.key, s.clientId); });

  const chosen = () => sources.filter(s => has(s) && s.included);

  function doImport() {
    const list = chosen();
    if (!list.length) return;
    for (const s of list) {
      const lbl = label(s);
      const summary = s.summary as AccountsStudioSummary;
      patch(r => ({
        ...r,
        income: mergeImportedPartnership(r.income, buildPartnershipFromNet('tmp', `Partnership — ${lbl}`, summary.netProfit, s.share, { start: dmyToIso(summary.periodStart), end: dmyToIso(summary.periodEnd) }), { clientId: s.clientId, label: lbl }, 'as'),
        timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported partnership share from ${lbl} (Accounts Studio)` }],
      }));
    }
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  const count = chosen().length;

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
        <button onClick={reloadAll} className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-black/[0.03] hover:text-[var(--text-secondary)]" aria-label="Refresh Accounts Studio"><RefreshCw size={14} /></button>
      </div>

      <div className="mt-3 flex-1 space-y-2">
        {sources.map(s => (
          <PtSourceRow key={s.key} entry={s} taxYear={ret.taxYear} hasData={has(s)}
            onToggleInclude={() => toggleInclude(s.key)} onShare={v => setShare(s.key, v)} onRemove={() => removeSource(s.key)} />
        ))}
        {searching ? (
          <InlineClientSearch onPick={addSource} />
        ) : (
          <button onClick={() => setSearching(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] py-1.5 text-[11.5px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/[0.04]">
            <Plus size={13} /> Add another partnership
          </button>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button onClick={doImport} disabled={count === 0} className="btn-primary disabled:opacity-40">
          {imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Added' : `Add partnership${count > 1 ? `s (${count})` : ''}`}
        </button>
      </div>
    </StudioCard>
  );
}

// One partnership source (client) inside the Accounts Studio card — amount +
// period + a per-source profit-share input, an include toggle and a bin.
function PtSourceRow({ entry, taxYear, hasData, onToggleInclude, onShare, onRemove }: {
  entry: PtSourceEntry; taxYear: string; hasData: boolean;
  onToggleInclude: () => void; onShare: (v: number) => void; onRemove: () => void;
}) {
  const s = entry.summary;
  const date = s && hasData ? rangeLabel(s.periodStart, s.periodEnd) : undefined;
  return (
    <div className={`rounded-xl border px-2.5 py-2 transition-colors ${entry.included && hasData ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.05]' : 'border-[var(--border)] bg-white/60'}`}>
      <div className="flex items-start gap-2">
        {hasData
          ? <input type="checkbox" checked={entry.included} onChange={onToggleInclude} className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-[var(--accent)]" aria-label="Include this partnership" />
          : <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-semibold text-[var(--text-primary)]">
            {entry.name || '—'}{entry.ref ? <span className="font-mono font-normal text-[var(--text-muted)]"> · {entry.ref}</span> : null}
            {entry.own && <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-500">This client</span>}
          </p>
          {entry.loading ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Loader2 size={11} className="animate-spin" /> Reading…</p>
          ) : entry.error ? (
            <p className="mt-0.5 text-[11px] text-rose-600">{entry.error}</p>
          ) : hasData && s ? (
            <>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12.5px] font-bold text-[var(--text-primary)]">{fmtMoney(s.netProfit)} net profit</span>
                {date && <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)]"><CalendarDays size={10} /> {date}</span>}
              </div>
              {!s.isPartnership && <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700"><Info size={11} className="mt-0.5 shrink-0" /> Not flagged as a partnership — double-check the source.</p>}
              {entry.included && <ShareInput share={entry.share} setShare={onShare} netProfit={s.netProfit} />}
            </>
          ) : (
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">No Accounts Studio data for {taxYear}.</p>
          )}
        </div>
        <button onClick={onRemove} className="shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500" aria-label="Remove source"><Trash2 size={13} /></button>
      </div>
    </div>
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
            {rangeLabel(period?.start, period?.end) && <p className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)]"><CalendarDays size={10} /> {rangeLabel(period?.start, period?.end)}</p>}
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
