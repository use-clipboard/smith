'use client';

/**
 * LaunchAnalysisDialog — pick a financial year, then launch the Accounts Review
 * or Performance tool in a new tab, pre-populated with the book's TB / P&L / BS
 * for that year (and, optionally, the prior year).
 *
 * Flow: choose FY (defaults to the one the book's period bar is currently on) →
 * fetch text statements from /books/[id]/statements → stash them via
 * setPendingAnalysis + hand the client to setPendingClient → openInNewTab the
 * target tool. The tool consumes both on mount: client prefills its selector
 * (so it lands on the input screen) and the statements attach as documents.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertCircle, ClipboardCheck, Gauge, ArrowRight } from 'lucide-react';
import { useTabContext, type Tab } from '@/components/ui/TabContext';
import { setPendingClient } from '@/lib/pendingClient';
import { setPendingAnalysis, type PendingAnalysisData } from '@/lib/bookkeeping/pendingAnalysis';
import type { SelectedClient } from '@/components/ui/ClientSelector';
import type { ActivePeriod } from './BookNavigationContext';

export type AnalysisTool = 'accounts-review' | 'performance';

const TOOL_META: Record<AnalysisTool, { route: string; title: string; icon: typeof ClipboardCheck; blurb: string }> = {
  'accounts-review': {
    route: '/final-accounts',
    title: 'Accounts Review',
    icon: ClipboardCheck,
    blurb: 'Review the year-end figures and get suggested journals.',
  },
  'performance': {
    route: '/performance',
    title: 'Performance',
    icon: Gauge,
    blurb: 'Produce a KPI-led performance report from the management figures.',
  },
};

interface Fy { id: string; start_date: string; end_date: string; status: string }

interface Props {
  bookId: string;
  tool: AnalysisTool;
  activePeriod: ActivePeriod;
  onClose: () => void;
}

function ukDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export default function LaunchAnalysisDialog({ bookId, tool, activePeriod, onClose }: Props) {
  const meta = TOOL_META[tool];
  const Icon = meta.icon;
  const { openInNewTab } = useTabContext();

  const [fys, setFys] = useState<Fy[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includePrior, setIncludePrior] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);

  // Load the book's financial years (generate any missing ones first).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}/years?generate=true`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load financial years')))
      .then(d => {
        if (cancelled) return;
        const rows = ((d.years ?? d) as Fy[]).slice().sort((a, b) => a.start_date.localeCompare(b.start_date));
        setFys(rows);
        // Default to the FY the book's period bar is currently on (the one whose
        // range contains the active period end), else the latest year.
        const anchor = activePeriod.toIso ?? activePeriod.fyEndIso;
        const match = anchor ? rows.find(f => f.start_date <= anchor && anchor <= f.end_date) : null;
        setSelectedId((match ?? rows[rows.length - 1])?.id ?? null);
      })
      .catch(e => { if (!cancelled) setLoadErr(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [bookId, activePeriod.toIso, activePeriod.fyEndIso]);

  const selectedFy = useMemo(() => fys?.find(f => f.id === selectedId) ?? null, [fys, selectedId]);
  const priorFy = useMemo(() => {
    if (!fys || !selectedFy) return null;
    const idx = fys.findIndex(f => f.id === selectedFy.id);
    return idx > 0 ? fys[idx - 1] : null;
  }, [fys, selectedFy]);

  async function launch() {
    if (!selectedFy) return;
    setLaunching(true);
    setLaunchErr(null);
    try {
      const usePrior = includePrior && priorFy;
      const qs = new URLSearchParams({ from: selectedFy.start_date, to: selectedFy.end_date });
      if (usePrior) { qs.set('prior_from', priorFy!.start_date); qs.set('prior_to', priorFy!.end_date); }

      const r = await fetch(`/api/bookkeeping/books/${bookId}/statements?${qs.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setLaunchErr(d.error ?? 'Could not build the statements.'); setLaunching(false); return; }

      const client: SelectedClient | null = d.client
        ? {
            id: d.client.id,
            name: d.client.name,
            client_ref: d.client.client_ref ?? null,
            business_type: d.client.business_type ?? null,
            vat_number: d.client.vat_number ?? null,
            status: 'active',
          }
        : null;

      const payload: PendingAnalysisData = {
        source: 'bookkeeping',
        bookId,
        businessName: d.businessName,
        client,
        period: { fromIso: selectedFy.start_date, toIso: selectedFy.end_date },
        priorPeriod: usePrior ? { fromIso: priorFy!.start_date, toIso: priorFy!.end_date } : null,
        current: d.current,
        prior: d.prior ?? null,
      };

      // Stash the statements for the tool, AND hand the client over the existing
      // Quick-Launch path so the tool lands on its input screen pre-filled.
      setPendingAnalysis(meta.route, payload);
      if (client) setPendingClient(meta.route, client);

      openInNewTab({ id: meta.route.slice(1), title: meta.title, route: meta.route, icon: Icon as Tab['icon'] });
      onClose();
    } catch (e) {
      setLaunchErr(String(e));
      setLaunching(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[520px] max-w-full shadow-2xl border border-slate-200 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <Icon size={16} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">Run {meta.title} from these books</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-slate-500">{meta.blurb} Pick the year to analyse — we&apos;ll hand over the Trial Balance, Profit &amp; Loss and Balance Sheet for that period.</p>

          {loadErr && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-800">{loadErr}</div>
            </div>
          )}

          {!fys && !loadErr && (
            <div className="py-8 text-center text-slate-500">
              <Loader2 size={18} className="mx-auto mb-2 animate-spin text-indigo-500" />
              <p className="text-xs">Loading financial years…</p>
            </div>
          )}

          {fys && fys.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              This book has no financial years yet — set a year end in the book settings first.
            </div>
          )}

          {fys && fys.length > 0 && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Financial year</label>
                <select
                  value={selectedId ?? ''}
                  onChange={e => setSelectedId(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {fys.slice().reverse().map(f => (
                    <option key={f.id} value={f.id}>
                      {ukDate(f.start_date)} – {ukDate(f.end_date)}{f.status && f.status !== 'open' ? ` (${f.status})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <label className={`flex items-start gap-2.5 ${priorFy ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  checked={!!priorFy && includePrior}
                  disabled={!priorFy}
                  onChange={e => setIncludePrior(e.target.checked)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span className="text-xs text-slate-700">
                  <span className="font-medium">Include prior year</span>
                  {priorFy
                    ? <span className="text-slate-500"> — {ukDate(priorFy.start_date)} – {ukDate(priorFy.end_date)}, for comparison</span>
                    : <span className="text-slate-500"> — no earlier year on this book</span>}
                </span>
              </label>
            </>
          )}

          {launchErr && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-800">{launchErr}</div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50/40">
          <button onClick={onClose} disabled={launching} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            onClick={() => void launch()}
            disabled={!selectedFy || launching}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            {launching ? <><Loader2 size={11} className="animate-spin" /> Preparing…</> : <>Open {meta.title} <ArrowRight size={12} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
