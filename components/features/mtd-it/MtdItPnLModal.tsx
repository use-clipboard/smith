'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, BarChart3, Download, FileSpreadsheet, AlertTriangle, Briefcase, House, Globe2,
} from 'lucide-react';
import { buildPnL, fmtMoneyGbp, type PnLBucket, type PnLForStream, type PnLSection } from '@/lib/mtdIt/pnl';
import { exportPnLPdf, exportPnLXlsx, type ExportContext } from '@/lib/mtdIt/pnlExport';
import { fetchBrandPdfBundle, type BrandPdfBundle } from '@/lib/mtdIt/fetchBrandPdfBundle';
import { formatDateUk } from '@/lib/mtdIt/dateFormat';
import type { EditorEntry } from './MtdItStreamColumn';
import type { MtdItStream, MtdItStreams, MtdItProperty, MtdItTrade } from '@/types';

interface Props {
  entries: EditorEntry[];
  streams: MtdItStreams;
  trades: MtdItTrade[];
  properties: MtdItProperty[];
  fxRates: Record<string, number>;
  consolidated: boolean;
  clientId: string;
  clientName: string;
  clientRef: string | null;
  taxYear: number;               // 2026
  quarter: 1 | 2 | 3 | 4;
  quarterLabel: string;          // "Q1"
  taxYearLabel: string;          // "2026/27"
  rangeFrom: string;             // ISO
  rangeTo:   string;
  onClose: () => void;
}

const STREAM_ICON: Record<MtdItStream, typeof Briefcase> = {
  sole:           Briefcase,
  uk_rental:      House,
  foreign_rental: Globe2,
};
const STREAM_TINT: Record<MtdItStream, string> = {
  sole:           'border-orange-200',
  uk_rental:      'border-blue-200',
  foreign_rental: 'border-emerald-200',
};

export default function MtdItPnLModal(props: Props) {
  const { entries, streams, trades, properties, fxRates, consolidated, clientId, clientName, clientRef, taxYear, quarterLabel, taxYearLabel, rangeFrom, rangeTo, onClose } = props;

  const activeStreams: MtdItStream[] = (['sole', 'uk_rental', 'foreign_rental'] as const).filter(s => streams[s]);

  // Build one PnLForStream per active stream
  const pnls = useMemo(() => activeStreams.map(s => buildPnL({
    stream:     s,
    entries:    entries.filter(e => e.stream === s),
    trades,
    properties,
    fxRates,
  })), [activeStreams, entries, trades, properties, fxRates]);

  const [tab, setTab] = useState<MtdItStream>(activeStreams[0] ?? 'sole');
  const current = pnls.find(p => p.stream === tab) ?? pnls[0];

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Branding + content toggles + comparison data come from the firm
  // settings — fetched on mount so the Download PDF button is instant.
  const [bundle, setBundle] = useState<BrandPdfBundle | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBrandPdfBundle({ clientId, taxYear }).then(b => { if (!cancelled) setBundle(b); });
    return () => { cancelled = true; };
  }, [clientId, taxYear]);

  const ctx: ExportContext = {
    clientName,
    clientRef,
    quarterLabel,
    taxYearLabel,
    rangeFrom,
    rangeTo,
    consolidated,
    // Pass raw entries so the PDF can render transaction-detail pages.
    entries,
    brandPrimaryColor: bundle?.brandPrimaryColor ?? null,
    logoDataUrl:       bundle?.logoDataUrl       ?? null,
    pdfInclude:        bundle?.pdfInclude,
    comparison:        bundle?.comparison ?? [],
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center">
            <BarChart3 size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">P&amp;L View</h3>
            <p className="text-xs text-gray-500 truncate">
              {clientName}{clientRef ? `  ·  ${clientRef}` : ''}  ·  {quarterLabel} {taxYearLabel}  ·  {formatDateUk(rangeFrom)} → {formatDateUk(rangeTo)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Tab strip */}
        {activeStreams.length > 1 && (
          <div className="flex border-b border-gray-200 bg-gray-50/60">
            {pnls.map(p => {
              const Icon = STREAM_ICON[p.stream];
              const active = p.stream === tab;
              return (
                <button
                  key={p.stream}
                  onClick={() => setTab(p.stream)}
                  aria-pressed={active}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors ${
                    active
                      ? `bg-white border-[var(--accent)] text-[var(--accent)] font-medium`
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'
                  }`}
                >
                  <Icon size={14} /> {p.streamLabel}
                  <span className="text-[10px] text-gray-400">· {p.rowCount}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50/40">
          {!current ? (
            <p className="px-6 py-16 text-center text-sm text-gray-500 italic">
              No active income streams to report on yet.
            </p>
          ) : (
            <div className="px-5 py-4 space-y-5">
              {/* Top-level P&L for the active stream */}
              <PnLCard pnl={current} consolidated={consolidated} />

              {/* Per-trade / per-property breakdown */}
              {current.breakdown.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    Breakdown by {current.stream === 'sole' ? 'trade' : 'property'}
                  </h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    {current.breakdown.map((b, i) => (
                      <BucketCard key={i} bucket={b} streamBorder={STREAM_TINT[current.stream]} consolidated={consolidated} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer — downloads */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-white">
          <div className="text-xs text-gray-500 mr-auto">
            Excludes flagged entries · Foreign rental amounts shown in GBP
          </div>
          <button
            onClick={() => exportPnLXlsx(pnls, ctx)}
            disabled={pnls.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg disabled:opacity-50"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button
            onClick={() => exportPnLPdf(pnls, ctx)}
            disabled={pnls.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--accent)] bg-[var(--accent-light)] hover:bg-[var(--accent-light)]/80 border border-[var(--accent)]/30 rounded-lg disabled:opacity-50"
          >
            <Download size={14} /> PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ── P&L card (full stream-level summary) ───────────────────────────────
function PnLCard({ pnl, consolidated }: { pnl: PnLForStream; consolidated: boolean }) {
  const Icon = STREAM_ICON[pnl.stream];
  return (
    <section className={`bg-white border-2 ${STREAM_TINT[pnl.stream]} rounded-xl overflow-hidden`}>
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <Icon size={15} className="text-gray-500" />
        <div className="text-sm font-semibold text-gray-900">{pnl.streamLabel}</div>
        <span className="text-[11px] text-gray-500 ml-auto">{pnl.rowCount} entries (clean)</span>
      </header>
      {pnl.unconvertedCount > 0 && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 flex items-center gap-1.5">
          <AlertTriangle size={11} />
          {pnl.unconvertedCount} row{pnl.unconvertedCount === 1 ? '' : 's'} without an FX rate — contributing £0.00 to GBP totals.
        </div>
      )}
      <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <SectionBlock section={pnl.income}  consolidated={consolidated} tone="text-green-700" />
        <SectionBlock section={pnl.expense} consolidated={consolidated} tone="text-red-700" />
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Net (Income − Expense)</span>
        <span className={`text-base font-semibold tabular-nums ${pnl.net >= 0 ? 'text-gray-900' : 'text-red-700'}`}>{fmtMoneyGbp(pnl.net)}</span>
      </div>
    </section>
  );
}

// ── Per-trade / per-property mini card ─────────────────────────────────
function BucketCard({ bucket, streamBorder, consolidated }: { bucket: PnLBucket; streamBorder: string; consolidated: boolean }) {
  return (
    <section className={`bg-white border ${streamBorder} rounded-xl overflow-hidden`}>
      <header className="px-3 py-2 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-900 truncate">
          {bucket.label}
          {bucket.unallocated && <span className="ml-1.5 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded uppercase tracking-wide">Unallocated</span>}
        </div>
        {bucket.sublabel && <div className="text-[11px] text-gray-500 truncate">{bucket.sublabel}</div>}
      </header>
      <div className="px-3 py-2 text-xs space-y-1.5">
        <SectionBlock section={bucket.income}  consolidated={consolidated} tone="text-green-700" compact />
        <SectionBlock section={bucket.expense} consolidated={consolidated} tone="text-red-700"   compact />
      </div>
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-gray-600">Net</span>
        <span className={`font-semibold tabular-nums ${bucket.net >= 0 ? 'text-gray-900' : 'text-red-700'}`}>{fmtMoneyGbp(bucket.net)}</span>
      </div>
    </section>
  );
}

function SectionBlock({ section, consolidated, tone, compact }: { section: PnLSection; consolidated: boolean; tone: string; compact?: boolean }) {
  return (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${tone} mb-1`}>{section.title}</div>
      {/* In consolidated mode we hide category lines — only the total matters. */}
      {!consolidated && section.lines.length > 0 && (
        <ul className={`space-y-0.5 ${compact ? 'text-[11px]' : 'text-xs'} text-gray-700`}>
          {section.lines.map(l => (
            <li key={l.category} className="flex items-baseline gap-2">
              <span className="truncate">{l.category}</span>
              <span className="ml-auto tabular-nums">{fmtMoneyGbp(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {!consolidated && section.lines.length === 0 && (
        <p className="text-[11px] text-gray-400 italic">(none)</p>
      )}
      <div className={`flex items-baseline justify-between border-t border-gray-100 mt-1 pt-1 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <span className="font-semibold text-gray-700">Total {section.title}</span>
        <span className={`font-semibold tabular-nums ${tone}`}>{fmtMoneyGbp(section.total)}</span>
      </div>
    </div>
  );
}
