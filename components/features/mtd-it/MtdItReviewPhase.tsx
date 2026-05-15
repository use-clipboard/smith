'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Loader2, AlertTriangle, Undo2, Redo2, Save, CheckCircle2, Layers,
  Sparkles, ArrowLeft, BarChart3,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import MtdItStreamColumn, { type EditorEntry } from './MtdItStreamColumn';
import MtdItSourceViewerModal from './MtdItSourceViewerModal';
import MtdItPnLModal from './MtdItPnLModal';
import { applyAutoFlags } from '@/lib/mtdIt/flags';
import { CONSOLIDATED_REPORTING_LIMIT } from '@/lib/mtdIt/categories';
import type { MtdItStream, MtdItProperty, MtdItTrade, MtdItStreams } from '@/types';

interface Props {
  quarterId: string;
  clientId: string;
  /** Inclusive ISO range used for out-of-range flagging. */
  rangeFrom: string;
  rangeTo: string;
  streams: MtdItStreams;
  fxRates: Record<string, number>;
  /** Whether the consolidated-reporting toggle was already on for the
   *  quarter (loaded from the DB row). The toggle UI lives in this phase. */
  initialConsolidated: boolean;
  /** Client + quarter context used by the P&L modal heading + downloads. */
  clientName: string;
  clientRef: string | null;
  quarterLabel: string;       // e.g. "Q1"
  taxYearLabel: string;       // e.g. "2026/27"
  onBackToSetup: () => void;
  /** Called when the user successfully saves & finishes. Parent navigates
   *  back to the dashboard. */
  onFinished: (status: 'draft' | 'complete') => void;
}

interface ServerEntry {
  id: string;
  stream: MtdItStream;
  trade_id: string | null;
  property_id: string | null;
  source_file_name: string | null;
  page_number: number | null;
  entry_date: string | null;
  description: string | null;
  supplier: string | null;
  category: string;
  entry_type: 'income' | 'expense';
  gross_amount: number;
  net_amount: number | null;
  vat_amount: number | null;
  currency: string;
  fx_rate: number | null;
  gbp_amount: number | null;
  share_pct: number;
  manual: boolean;
  flagged_reason: string | null;
  flag_dismissed: boolean | null;
  drive_link: string | null;
}

const ACTIVE_STREAMS = ['sole', 'uk_rental', 'foreign_rental'] as const;

// Convert server rows → editor rows. Stamps a stable _localId so the table
// can key on it for the whole edit session (the DB id stays in `id`).
function serverToEditor(e: ServerEntry): EditorEntry {
  return {
    _localId: `srv_${e.id}`,
    _isNew: false,
    _dirty: false,
    flag_dismissed: !!e.flag_dismissed,
    id: e.id,
    stream: e.stream,
    trade_id: e.trade_id,
    property_id: e.property_id,
    source_file_name: e.source_file_name,
    page_number: e.page_number,
    entry_date: e.entry_date,
    description: e.description,
    supplier: e.supplier,
    category: e.category,
    entry_type: e.entry_type,
    gross_amount: Number(e.gross_amount ?? 0),
    net_amount: e.net_amount === null ? null : Number(e.net_amount),
    vat_amount: e.vat_amount === null ? null : Number(e.vat_amount),
    currency: e.currency,
    fx_rate: e.fx_rate === null ? null : Number(e.fx_rate),
    gbp_amount: e.gbp_amount === null ? null : Number(e.gbp_amount),
    share_pct: Number(e.share_pct ?? 100),
    manual: e.manual,
    flagged_reason: e.flagged_reason,
    drive_link: e.drive_link,
  };
}

export default function MtdItReviewPhase({
  quarterId, clientId, rangeFrom, rangeTo, streams, fxRates,
  initialConsolidated, clientName, clientRef, quarterLabel, taxYearLabel,
  onBackToSetup, onFinished,
}: Props) {
  // ── Loading entries / properties / trades ───────────────────────────
  const [entries, setEntries] = useState<EditorEntry[]>([]);
  const [properties, setProperties] = useState<MtdItProperty[]>([]);
  const [trades, setTrades] = useState<MtdItTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const [eRes, pRes, tRes] = await Promise.all([
          fetch(`/api/mtd-it/entries?quarter_id=${quarterId}`),
          fetch(`/api/mtd-it/properties?client_id=${clientId}`),
          fetch(`/api/mtd-it/trades?client_id=${clientId}`),
        ]);
        if (!eRes.ok) throw new Error('Failed to load entries');
        if (!pRes.ok) throw new Error('Failed to load properties');
        if (!tRes.ok) throw new Error('Failed to load trades');
        const eJson = await eRes.json();
        const pJson = await pRes.json();
        const tJson = await tRes.json();
        const editor = (eJson.entries ?? []).map((e: ServerEntry) => serverToEditor(e));
        setEntries(applyAutoFlags(editor, rangeFrom, rangeTo));
        setProperties((pJson.properties ?? []) as MtdItProperty[]);
        setTrades((tJson.trades ?? []) as MtdItTrade[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [quarterId, clientId, rangeFrom, rangeTo]);

  // ── Undo / redo (session-scoped, in-memory) ─────────────────────────
  // history holds snapshots of `entries` *before* each mutation. Redo holds
  // snapshots that were popped off history by an undo. Both clear when the
  // user does a new edit (standard editor pattern).
  const historyRef = useRef<EditorEntry[][]>([]);
  const redoRef    = useRef<EditorEntry[][]>([]);
  const HISTORY_LIMIT = 50;
  const pushHistory = useCallback(() => {
    historyRef.current.push(entries);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current = [];
  }, [entries]);
  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    redoRef.current.push(entries);
    setEntries(applyAutoFlags(prev, rangeFrom, rangeTo));
  }, [entries, rangeFrom, rangeTo]);
  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current.pop()!;
    historyRef.current.push(entries);
    setEntries(applyAutoFlags(next, rangeFrom, rangeTo));
  }, [entries, rangeFrom, rangeTo]);
  // Keyboard shortcuts — only fire when not focused inside a form control
  // that already handles undo (text inputs do their own undo on z).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inField) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Source-document viewer state ─────────────────────────────────────
  const [viewing, setViewing] = useState<{ fileName: string; pageNumber: number | null } | null>(null);

  // ── P&L lightbox state ───────────────────────────────────────────────
  const [pnlOpen, setPnlOpen] = useState(false);

  // ── Consolidated reporting ───────────────────────────────────────────
  const [consolidated, setConsolidated] = useState(initialConsolidated);
  const totalIncomeAllStreams = entries
    .filter(e => !e._deleted && e.entry_type === 'income')
    .reduce((a, e) => a + (e.gross_amount || 0), 0);
  const overThreshold = totalIncomeAllStreams >= CONSOLIDATED_REPORTING_LIMIT;

  async function toggleConsolidated() {
    if (!consolidated && overThreshold) {
      const ok = confirm(
        `Combined gross income is £${totalIncomeAllStreams.toLocaleString('en-GB', { maximumFractionDigits: 2 })}, ` +
        `which is at or above the £${CONSOLIDATED_REPORTING_LIMIT.toLocaleString()} consolidated-reporting limit.\n\n` +
        `HMRC's simplified consolidated reporting isn't permitted at this income level. ` +
        `Are you sure you want to enable it anyway?`,
      );
      if (!ok) return;
    }
    const next = !consolidated;
    setConsolidated(next);
    void fetch(`/api/mtd-it/quarters/${quarterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consolidated: next }),
    });
  }

  // ── Dirty / unsaved-changes guard ────────────────────────────────────
  const dirty = useMemo(
    () => entries.some(e => e._dirty || e._isNew || e._deleted),
    [entries],
  );
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── Save (bulk creates / updates / deletes) ──────────────────────────
  const [saving, setSaving] = useState<null | 'draft' | 'complete'>(null);
  async function save(target: 'draft' | 'complete') {
    setSaving(target); setError(null);
    try {
      // Split the editor state into a bulk-save payload. Manual rules:
      //   _deleted true + has id    → goes in `deletes`
      //   _isNew  true              → goes in `creates`
      //   else _dirty true          → goes in `updates`
      // Strip editor-only bookkeeping fields. `flag_dismissed` is the one
      // editor field that DOES persist (it has its own DB column) — keep it.
      const creates = entries
        .filter(e => e._isNew && !e._deleted)
        .map(({ _localId, _isNew, _dirty, _deleted, id, ...rest }) => rest);
      const updates = entries
        .filter(e => !e._isNew && !e._deleted && e._dirty && e.id)
        .map(({ _localId, _isNew, _dirty, _deleted, ...rest }) => rest);
      const deletes = entries
        .filter(e => e._deleted && !!e.id)
        .map(e => e.id!);

      const res = await fetch('/api/mtd-it/entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter_id: quarterId, creates, updates, deletes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Save failed');
      }
      // Bump the quarter status + consolidated flag in one go
      await fetch(`/api/mtd-it/quarters/${quarterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target, consolidated }),
      });
      onFinished(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-2" /> Loading entries…</div>;
  }
  if (error && entries.length === 0) {
    return <div className="py-16 text-center text-sm text-red-600 flex items-center justify-center gap-2"><AlertTriangle size={16} /> {error}</div>;
  }

  const activeStreams = ACTIVE_STREAMS.filter(s => streams[s]);
  const colsClass =
    activeStreams.length === 3 ? 'lg:grid-cols-3' :
    activeStreams.length === 2 ? 'lg:grid-cols-2' :
    /* 1 */                       'lg:grid-cols-1';

  return (
    <div className="space-y-4">
      {/* Toolbar — three separate pills: Consolidated toggle, optional
          over-threshold warning, and Undo/Redo. Each lives in its own pill
          so they read as independent controls. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Consolidated reporting — pill button with explainer tooltip.
            Fills with accent when on. */}
        <Tooltip
          label={
            "Consolidated reporting collapses Income and Expenses into a single total per stream, rather than itemising every HMRC category. Allowed when the client's combined gross income across all property + trade streams stays below £" +
            CONSOLIDATED_REPORTING_LIMIT.toLocaleString() +
            ". Use it for low-income clients to simplify the quarterly return."
          }
        >
          <button
            onClick={toggleConsolidated}
            aria-pressed={consolidated}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors shadow-sm ${
              consolidated
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Layers size={12} />
            Consolidated reporting
            {/* Tiny pill-switch on the right that shows on/off at a glance */}
            <span
              className={`relative inline-block w-7 h-4 rounded-full transition-colors ${
                consolidated ? 'bg-white/30' : 'bg-gray-200'
              }`}
              aria-hidden
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
                  consolidated ? 'left-[14px]' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </Tooltip>

        {/* P&L View — opens a lightbox showing per-stream P&Ls with
            breakdown by trade/property and PDF/Excel download. */}
        <Tooltip label="Open a P&L summary for the quarter, with per-trade or per-property breakdowns and PDF / Excel download">
          <button
            onClick={() => setPnlOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <BarChart3 size={12} /> P&amp;L View
          </button>
        </Tooltip>

        {overThreshold && (
          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] bg-amber-50 text-amber-800 border border-amber-200 rounded-full shadow-sm">
            <AlertTriangle size={11} />
            Combined income ≥ £{CONSOLIDATED_REPORTING_LIMIT.toLocaleString()} — consolidated reporting not normally permitted
          </span>
        )}

        {/* Undo / Redo pill — separate panel on the right */}
        <div className="ml-auto inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1.5 py-1 shadow-sm">
          <Tooltip label="Undo (Ctrl+Z)">
            <button
              onClick={undo}
              disabled={historyRef.current.length === 0}
              aria-label="Undo"
              className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            ><Undo2 size={13} /></button>
          </Tooltip>
          <span aria-hidden className="w-px h-4 bg-gray-200" />
          <Tooltip label="Redo (Ctrl+Shift+Z)">
            <button
              onClick={redo}
              disabled={redoRef.current.length === 0}
              aria-label="Redo"
              className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            ><Redo2 size={13} /></button>
          </Tooltip>
        </div>
      </div>

      {/* Columns */}
      <div className={`grid grid-cols-1 ${colsClass} gap-4`}>
        {activeStreams.map(s => (
          <MtdItStreamColumn
            key={s}
            stream={s}
            entries={entries.filter(e => e.stream === s)}
            properties={properties}
            trades={trades}
            fxRates={fxRates}
            consolidated={consolidated}
            pushHistory={pushHistory}
            onChange={(nextForStream) => {
              // Splice this stream's slice back into the full array, keeping
              // the relative order of other streams stable.
              setEntries(prev => {
                const others = prev.filter(e => e.stream !== s);
                return applyAutoFlags([...others, ...nextForStream], rangeFrom, rangeTo);
              });
            }}
            onViewSource={(fileName, pageNumber) => setViewing({ fileName, pageNumber })}
          />
        ))}
      </div>

      {/* Inline error from save */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
          <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
        </div>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 mt-6 pointer-events-none">
        <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 shadow-lg pointer-events-auto w-fit max-w-[min(720px,calc(100%-9rem))] mr-auto">
          <button
            onClick={onBackToSetup}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={14} /> Back to setup
          </button>
          <div className="text-xs text-gray-500 hidden sm:block">
            {dirty
              ? <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Unsaved changes</span>
              : <span className="text-green-700">All saved</span>}
          </div>
          <button
            onClick={() => save('draft')}
            disabled={saving !== null}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:opacity-90 rounded-lg disabled:opacity-50"
          >
            {saving === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save as draft
          </button>
          <button
            onClick={() => save('complete')}
            disabled={saving !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 rounded-lg disabled:opacity-50"
          >
            {saving === 'complete' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Save &amp; complete
          </button>
        </div>
      </div>

      {/* Source-document viewer modal — singleton, opened from any row */}
      {viewing && (
        <MtdItSourceViewerModal
          quarterId={quarterId}
          fileName={viewing.fileName}
          pageNumber={viewing.pageNumber}
          onClose={() => setViewing(null)}
        />
      )}

      {/* P&L lightbox */}
      {pnlOpen && (
        <MtdItPnLModal
          entries={entries}
          streams={streams}
          trades={trades}
          properties={properties}
          fxRates={fxRates}
          consolidated={consolidated}
          clientName={clientName}
          clientRef={clientRef}
          quarterLabel={quarterLabel}
          taxYearLabel={taxYearLabel}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onClose={() => setPnlOpen(false)}
        />
      )}
    </div>
  );
}
