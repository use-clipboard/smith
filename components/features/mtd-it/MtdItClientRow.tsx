'use client';

import { useState } from 'react';
import {
  ChevronRight, Pencil, Check, Mail, CheckCircle2, Lock, AlertTriangle, Trash2,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { getQuartersForYear, type QuarterRange } from '@/lib/mtdIt/quarters';
import { evaluateThreshold } from '@/lib/mtdIt/thresholds';
import type { MtdItClientRow as Row, MtdItQuarterStatus, MtdItQuarterType } from '@/types';

// Module-level set so expanded state survives parent re-renders / prop updates.
const expandedIds = new Set<string>();

interface Props {
  client: Row;
  taxYear: number;
  /** Default quarter type when the client has no preference set yet */
  fallbackType?: MtdItQuarterType;
  onOpenQuarter: (clientId: string, quarter: 1 | 2 | 3 | 4) => void;
  onRemove: (clientId: string) => Promise<void>;
}

const STATUS_STYLES: Record<NonNullable<Row['status']>, { pill: string; label: string; dot: string }> = {
  active:   { pill: 'bg-green-100 text-green-700', label: 'Active',   dot: 'bg-green-500'  },
  hold:     { pill: 'bg-amber-100 text-amber-700', label: 'On Hold',  dot: 'bg-amber-500'  },
  inactive: { pill: 'bg-gray-100 text-gray-500',   label: 'Inactive', dot: 'bg-gray-400'   },
};

function formatDob(iso: string | null): string {
  if (!iso) return '—';
  // Accept either YYYY-MM-DD or DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  return iso;
}

// ── Mini quarter square (status indicator inline on the row) ───────────────
function MiniSquare({ status }: { status: MtdItQuarterStatus | undefined }) {
  if (!status) {
    return <span className="block w-3 h-3 rounded-sm border border-gray-300 bg-white" aria-label="Not started" />;
  }
  const map: Record<MtdItQuarterStatus, { bg: string; icon: React.ReactNode; label: string }> = {
    draft:     { bg: 'bg-amber-100 border-amber-300',  icon: <Pencil className="w-2 h-2 text-amber-600" strokeWidth={3} />, label: 'Draft' },
    complete:  { bg: 'bg-green-100 border-green-300',  icon: <Check className="w-2 h-2 text-green-700" strokeWidth={4} />,   label: 'Complete' },
    sent:      { bg: 'bg-sky-100 border-sky-300',      icon: <Mail className="w-2 h-2 text-sky-700" strokeWidth={3} />,      label: 'Sent to client' },
    approved:  { bg: 'bg-blue-100 border-blue-300',    icon: <CheckCircle2 className="w-2 h-2 text-blue-700" strokeWidth={3} />, label: 'Approved' },
    submitted: { bg: 'bg-gray-200 border-gray-400',    icon: <Lock className="w-2 h-2 text-gray-700" strokeWidth={3} />,     label: 'Submitted' },
  };
  const s = map[status];
  return (
    <Tooltip label={s.label}>
      <span className={`flex w-3 h-3 rounded-sm border items-center justify-center ${s.bg}`} aria-label={s.label}>
        {s.icon}
      </span>
    </Tooltip>
  );
}

// ── Big quarter square (in the expanded panel) ─────────────────────────────
function BigSquare({
  range, status, onClick,
}: {
  range: QuarterRange;
  status: MtdItQuarterStatus | undefined;
  onClick: () => void;
}) {
  const colour: Record<MtdItQuarterStatus | 'empty', { bg: string; border: string; icon: React.ReactNode; ring: string }> = {
    empty:     { bg: 'bg-white',         border: 'border-gray-200',  icon: null,                                                                ring: 'hover:ring-2 hover:ring-[var(--accent)]/30' },
    draft:     { bg: 'bg-amber-50',      border: 'border-amber-300', icon: <Pencil className="w-6 h-6 text-amber-600" />,                       ring: 'hover:ring-2 hover:ring-amber-300' },
    complete:  { bg: 'bg-green-50',      border: 'border-green-300', icon: <Check className="w-7 h-7 text-green-700" strokeWidth={3} />,        ring: 'hover:ring-2 hover:ring-green-300' },
    sent:      { bg: 'bg-sky-50',        border: 'border-sky-300',   icon: <Mail className="w-6 h-6 text-sky-700" />,                           ring: 'hover:ring-2 hover:ring-sky-300' },
    approved:  { bg: 'bg-blue-50',       border: 'border-blue-300',  icon: <CheckCircle2 className="w-7 h-7 text-blue-700" strokeWidth={2.5} />, ring: 'hover:ring-2 hover:ring-blue-300' },
    submitted: { bg: 'bg-gray-100',      border: 'border-gray-400',  icon: <Lock className="w-6 h-6 text-gray-700" />,                          ring: 'hover:ring-2 hover:ring-gray-300' },
  };
  const c = colour[status ?? 'empty'];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex-1 flex flex-col items-center justify-center rounded-xl border ${c.border} ${c.bg} ${c.ring} transition aspect-square p-3 min-h-[110px]`}
    >
      <div className="text-xs font-semibold text-gray-500 mb-1">Q{range.quarter}</div>
      <div className="flex-1 flex items-center justify-center">
        {c.icon ?? <span className="text-2xl font-light text-gray-300 group-hover:text-gray-400">+</span>}
      </div>
      <div className="text-[11px] text-gray-500 mt-1">{range.monthsLabel}</div>
    </button>
  );
}

// ── Main row ───────────────────────────────────────────────────────────────
export default function MtdItClientRow({ client, taxYear, fallbackType = 'calendar', onOpenQuarter, onRemove }: Props) {
  const [expanded, setExpanded] = useState(() => expandedIds.has(client.id));
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function toggle() {
    setExpanded(prev => {
      const next = !prev;
      if (next) expandedIds.add(client.id);
      else      expandedIds.delete(client.id);
      return next;
    });
  }

  const quarterType = client.mtd_it_quarter_type ?? fallbackType;
  const ranges = getQuartersForYear(taxYear, quarterType);
  const threshold = evaluateThreshold(client.mtd_it_prior_year_income, taxYear);
  const statusStyle = STATUS_STYLES[client.status] ?? STATUS_STYLES.active;

  async function handleRemove() {
    setRemoving(true);
    try { await onRemove(client.id); }
    finally { setRemoving(false); setConfirmRemove(false); }
  }

  return (
    <>
      <tr
        onClick={toggle}
        className="border-b border-gray-100 hover:bg-gray-50/70 cursor-pointer"
      >
        <td className="px-3 py-2.5 w-8">
          <ChevronRight
            size={16}
            className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </td>
        <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[240px] truncate">{client.name}</td>
        <td className="px-3 py-2.5 text-gray-600 text-xs font-mono">{client.client_ref ?? '—'}</td>
        <td className="px-3 py-2.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusStyle.pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
            {statusStyle.label}
          </span>
        </td>
        <td className="px-3 py-2.5 text-gray-600 text-xs">{client.utr_number ?? '—'}</td>
        <td className="px-3 py-2.5 text-gray-600 text-xs">{client.national_insurance_number ?? '—'}</td>
        <td className="px-3 py-2.5 text-gray-600 text-xs">{formatDob(client.date_of_birth)}</td>
        <td className="px-3 py-2.5 text-gray-600 text-xs max-w-[260px] truncate">{client.address ?? '—'}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            {([1,2,3,4] as const).map(q => <MiniSquare key={q} status={client.quarters[q]} />)}
          </div>
        </td>
        <td className="px-3 py-2.5 w-8">
          {threshold.belowThreshold && (
            <Tooltip label={`Prior-year income £${client.mtd_it_prior_year_income?.toLocaleString() ?? '?'} is below the ${taxYear}/${String((taxYear+1)%100).padStart(2,'0')} threshold of £${threshold.threshold.toLocaleString()}`}>
              <span className="inline-flex"><AlertTriangle size={14} className="text-amber-500" aria-label="Below MTD threshold" /></span>
            </Tooltip>
          )}
        </td>
        <td className="px-3 py-2.5 w-8" onClick={e => e.stopPropagation()}>
          {confirmRemove ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleRemove}
                disabled={removing}
                className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >Remove</button>
              <button
                onClick={() => setConfirmRemove(false)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
              >Cancel</button>
            </div>
          ) : (
            <Tooltip label="Remove from MTD IT list">
              <button
                onClick={() => setConfirmRemove(true)}
                aria-label="Remove client from MTD IT list"
                className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
              ><Trash2 size={14} /></button>
            </Tooltip>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50/40">
          <td colSpan={11} className="px-6 py-5">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2 font-semibold">
              {taxYear}/{String((taxYear+1)%100).padStart(2,'0')} Quarters — {quarterType === 'calendar' ? 'Calendar' : 'Standard'}
            </div>
            <div className="flex gap-3">
              {ranges.map(r => (
                <BigSquare
                  key={r.quarter}
                  range={r}
                  status={client.quarters[r.quarter]}
                  onClick={() => onOpenQuarter(client.id, r.quarter)}
                />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
