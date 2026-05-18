'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, BarChart3, X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { getQuartersForYear, taxYearLabel } from '@/lib/mtdIt/quarters';
import type { MtdItClientRow as Row, MtdItQuarterStatus, MtdItQuarterType } from '@/types';

const COLLAPSE_KEY = 'smith.mtd_it.dashboard.stats_collapsed';

// Status → swatch colours. These mirror the Tailwind palette used by the
// existing inline quarter squares in MtdItClientRow (amber/green/sky/blue/gray)
// so the donut reads as the same visual language as the per-row indicators.
type Bucket = 'not_started' | MtdItQuarterStatus;

// Display order for the legend and donut segments. 'submitted' is intentionally
// omitted — it's not yet user-reachable, and showing it alongside the gray
// 'Not started' swatch was misread as a duplicate. Add it back here once
// submission is implemented end-to-end.
const BUCKET_ORDER: Bucket[] = ['not_started', 'draft', 'sent', 'approved', 'complete'];

const CLIENT_STATUS_STYLE: Record<Row['status'], { pill: string; dot: string; label: string }> = {
  active:   { pill: 'bg-green-100 text-green-700', dot: 'bg-green-500', label: 'Active'   },
  hold:     { pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', label: 'On Hold'  },
  inactive: { pill: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-400',  label: 'Inactive' },
};

const BUCKET_STYLE: Record<Bucket, { label: string; fill: string; chip: string }> = {
  not_started: { label: 'Not started', fill: '#e5e7eb', chip: 'bg-gray-200'  },   // gray-200
  draft:       { label: 'Draft',       fill: '#fcd34d', chip: 'bg-amber-300' },   // amber-300
  complete:    { label: 'Complete',    fill: '#86efac', chip: 'bg-green-300' },   // green-300
  sent:        { label: 'Sent',        fill: '#7dd3fc', chip: 'bg-sky-300'   },   // sky-300
  approved:    { label: 'Approved',    fill: '#c4b5fd', chip: 'bg-violet-300' },  // violet-300 — distinct from sky 'Sent'
  submitted:   { label: 'Submitted',   fill: '#9ca3af', chip: 'bg-gray-400' },    // gray-400
};

interface Props {
  clients: Row[];
  taxYear: number;
  /** Default quarter type when a client has no preference set */
  fallbackType?: MtdItQuarterType;
}

interface Selection { quarter: 1 | 2 | 3 | 4; bucket: Bucket; }

export default function MtdItQuarterStats({ clients, taxYear, fallbackType = 'calendar' }: Props) {
  // Persist collapsed state. SSR + first paint must match, so we read from
  // localStorage in an effect-free getter — false on the server, then hydrated.
  const [collapsed, setCollapsed] = useState(false);
  // Hydrate from localStorage on mount.
  useMemo(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw === '1') setCollapsed(true);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  // Use calendar ranges for the centre labels — month labels are what the user
  // is asking for ("Q1 — Apr to Jun") and these are the most common form.
  const ranges = useMemo(() => getQuartersForYear(taxYear, fallbackType), [taxYear, fallbackType]);

  // Tally each client's quarter status into per-quarter buckets.
  const tallies = useMemo(() => {
    const result: Record<1 | 2 | 3 | 4, Record<Bucket, number>> = {
      1: emptyTally(), 2: emptyTally(), 3: emptyTally(), 4: emptyTally(),
    };
    for (const c of clients) {
      ([1, 2, 3, 4] as const).forEach(q => {
        const s = c.quarters[q];
        // Both absent quarter rows and explicit 'not_started' status fall
        // into the Not started bucket — they're indistinguishable to the user.
        const bucket: Bucket = !s || s === 'not_started' ? 'not_started' : s;
        result[q][bucket] += 1;
      });
    }
    return result;
  }, [clients]);

  const total = clients.length;

  const [selection, setSelection] = useState<Selection | null>(null);

  // Compute the modal's filtered list lazily — only when something's selected.
  const selectedClients = useMemo(() => {
    if (!selection) return [];
    return clients.filter(c => {
      const s = c.quarters[selection.quarter];
      const bucket: Bucket = !s || s === 'not_started' ? 'not_started' : s;
      return bucket === selection.bucket;
    });
  }, [clients, selection]);

  return (
    <div className="mb-4 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <BarChart3 size={14} className="text-[var(--accent)]" />
          Quarter status — {taxYearLabel(taxYear)}
          <span className="text-xs text-gray-500 font-normal">
            ({total} client{total === 1 ? '' : 's'})
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          {total === 0 ? (
            <p className="text-xs text-gray-500 py-6 text-center">
              No clients to summarise.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {ranges.map(r => (
                  <Donut
                    key={r.quarter}
                    quarter={r.quarter}
                    monthsLabel={r.monthsLabel}
                    counts={tallies[r.quarter]}
                    total={total}
                    onSelect={(bucket) => setSelection({ quarter: r.quarter, bucket })}
                  />
                ))}
              </div>
              {/* Shared legend */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-gray-600">
                {BUCKET_ORDER.map(b => (
                  <span key={b} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block w-2.5 h-2.5 rounded-sm ${BUCKET_STYLE[b].chip}`} />
                    {BUCKET_STYLE[b].label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {selection && (
        <ClientListModal
          quarter={selection.quarter}
          bucket={selection.bucket}
          monthsLabel={ranges.find(r => r.quarter === selection.quarter)?.monthsLabel ?? ''}
          clients={selectedClients}
          taxYear={taxYear}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function emptyTally(): Record<Bucket, number> {
  return { not_started: 0, draft: 0, complete: 0, sent: 0, approved: 0, submitted: 0 };
}

interface DonutProps {
  quarter: 1 | 2 | 3 | 4;
  monthsLabel: string;
  counts: Record<Bucket, number>;
  total: number;
  onSelect: (bucket: Bucket) => void;
}

function Donut({ quarter, monthsLabel, counts, total, onSelect }: DonutProps) {
  // SVG donut: 100×100 viewBox, radius 40, stroke-width 14. Segments are drawn
  // as <circle> elements using stroke-dasharray so each takes up a fraction of
  // the circumference proportional to its share of the total.
  const R = 40;
  const C = 2 * Math.PI * R;

  // Build the segments in the canonical order. Skip zero-count buckets so
  // there's no sub-pixel stroke artefact at zero-length segments.
  const segments: Array<{ bucket: Bucket; count: number; len: number }> = [];
  for (const b of BUCKET_ORDER) {
    const n = counts[b];
    if (n <= 0) continue;
    const len = (n / total) * C;
    segments.push({ bucket: b, count: n, len });
  }

  // Hover state for the custom segment tooltip (renders inside the donut box
  // so it tracks the donut position even on scroll, and uses the same dark
  // pill styling as the chip tooltips below).
  const [hover, setHover] = useState<Bucket | null>(null);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[112px] h-[112px]">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {/* Track */}
          <circle cx="50" cy="50" r={R} fill="none" stroke="#f3f4f6" strokeWidth="14" />
          {/* Segments */}
          {(() => {
            let offset = 0;
            return segments.map(seg => {
              const node = (
                <circle
                  key={seg.bucket}
                  cx="50"
                  cy="50"
                  r={R}
                  fill="none"
                  stroke={BUCKET_STYLE[seg.bucket].fill}
                  strokeWidth="14"
                  strokeDasharray={`${seg.len} ${C - seg.len}`}
                  strokeDashoffset={-offset}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseEnter={() => setHover(seg.bucket)}
                  onMouseLeave={() => setHover(prev => (prev === seg.bucket ? null : prev))}
                  onClick={() => onSelect(seg.bucket)}
                  role="button"
                  aria-label={`${BUCKET_STYLE[seg.bucket].label}: ${seg.count}`}
                />
              );
              offset += seg.len;
              return node;
            });
          })()}
        </svg>
        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-sm font-semibold text-gray-800 leading-none">Q{quarter}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{monthsLabel}</div>
        </div>
        {/* Segment hover tooltip — sits above the donut so the cursor doesn't
            cover it. Pointer-events-none so it never steals the hover. */}
        {hover && (
          <div
            className="absolute left-1/2 -translate-x-1/2 -top-7 px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium shadow-lg whitespace-nowrap pointer-events-none z-10"
            role="tooltip"
          >
            {BUCKET_STYLE[hover].label}: {counts[hover]}
          </div>
        )}
      </div>
      {/* Per-quarter counts strip — click to drill into that bucket */}
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
        {BUCKET_ORDER.map(b => {
          const n = counts[b];
          if (n === 0) return null;
          return (
            <Tooltip key={b} label={`${BUCKET_STYLE[b].label}: ${n}`}>
              <button
                type="button"
                onClick={() => onSelect(b)}
                aria-label={`Show ${BUCKET_STYLE[b].label.toLowerCase()} clients for Q${quarter}`}
                className="inline-flex items-center gap-1 text-[10px] text-gray-600 px-1 rounded hover:bg-gray-100 transition-colors"
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-sm ${BUCKET_STYLE[b].chip}`} />
                {n}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ── Client-list modal ───────────────────────────────────────────────────────
interface ModalProps {
  quarter: 1 | 2 | 3 | 4;
  bucket: Bucket;
  monthsLabel: string;
  clients: Row[];
  taxYear: number;
  onClose: () => void;
}

function ClientListModal({ quarter, bucket, monthsLabel, clients, taxYear, onClose }: ModalProps) {
  const router = useRouter();
  const style = BUCKET_STYLE[bucket];
  function openClientQuarter(clientId: string) {
    onClose();
    router.push(`/mtd-it/${clientId}/${taxYear}/${quarter}`);
  }
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className={`inline-block w-3 h-3 rounded-sm shrink-0 mt-1 ${style.chip}`} />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900">
                {style.label} — Q{quarter} ({monthsLabel})
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {clients.length} client{clients.length === 1 ? '' : 's'} · {taxYearLabel(taxYear)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-gray-100 shrink-0"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {clients.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No clients in this bucket.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {clients
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openClientQuarter(c.id)}
                      className="w-full flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className="text-sm text-gray-900 truncate flex-1 min-w-0">{c.name}</span>
                      {(() => {
                        const s = CLIENT_STATUS_STYLE[c.status] ?? CLIENT_STATUS_STYLE.active;
                        return (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${s.pill}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            {s.label}
                          </span>
                        );
                      })()}
                      <span className="text-xs text-gray-500 font-mono shrink-0 w-14 text-right">
                        {c.client_ref ?? '—'}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
