'use client';

/**
 * PeriodSelector — compact date-range picker used by the TB/P&L/BS views.
 *
 * Behaviour:
 *   - Two date inputs (from, to) accepting yyyy-mm-dd.
 *   - Quick presets: This month / Last month / This quarter / This FY /
 *     Last FY / All time / Custom.
 *   - When the user picks a preset, the from/to fields populate. Editing
 *     the dates manually flips back to "Custom".
 *   - Persists the chosen range per-book in localStorage so the view
 *     remembers between sessions.
 *
 * Date model: from/to are inclusive. `null` for either side means "open"
 * (no lower or upper bound).
 */

import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import DateInput, { fromIso, toIso } from '../input/DateInput';

export interface DateRange {
  from: string | null;
  to: string | null;
}

interface Props {
  bookId: string;
  value: DateRange;
  onChange: (next: DateRange) => void;
  /** UK financial year start month (1–12). Defaults to April (4). Used by the
   *  "This FY" / "Last FY" presets. */
  fyStartMonth?: number;
}

type Preset = 'this_month' | 'last_month' | 'this_quarter' | 'this_fy' | 'last_fy' | 'all_time' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'this_month',   label: 'This month'   },
  { id: 'last_month',   label: 'Last month'   },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_fy',      label: 'This FY'      },
  { id: 'last_fy',      label: 'Last FY'      },
  { id: 'all_time',     label: 'All time'     },
  { id: 'custom',       label: 'Custom'       },
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); }

/** Compute the start of the current financial year given a fy-start month. */
function startOfFy(today: Date, fyStartMonth: number): Date {
  const year = today.getMonth() + 1 >= fyStartMonth ? today.getFullYear() : today.getFullYear() - 1;
  return new Date(year, fyStartMonth - 1, 1);
}

function rangeForPreset(preset: Preset, today: Date, fyStartMonth: number): DateRange {
  switch (preset) {
    case 'this_month':
      return { from: iso(startOfMonth(today)), to: iso(endOfMonth(today)) };
    case 'last_month': {
      const prev = addMonths(today, -1);
      return { from: iso(startOfMonth(prev)), to: iso(endOfMonth(prev)) };
    }
    case 'this_quarter': {
      const q = Math.floor(today.getMonth() / 3);
      const qStart = new Date(today.getFullYear(), q * 3, 1);
      const qEnd = endOfMonth(new Date(today.getFullYear(), q * 3 + 2, 1));
      return { from: iso(qStart), to: iso(qEnd) };
    }
    case 'this_fy': {
      const start = startOfFy(today, fyStartMonth);
      const end = new Date(start.getFullYear() + 1, start.getMonth(), 0); // last day before next FY
      return { from: iso(start), to: iso(end) };
    }
    case 'last_fy': {
      const thisFyStart = startOfFy(today, fyStartMonth);
      const lastStart = new Date(thisFyStart.getFullYear() - 1, thisFyStart.getMonth(), 1);
      const lastEnd = new Date(thisFyStart.getFullYear(), thisFyStart.getMonth(), 0);
      return { from: iso(lastStart), to: iso(lastEnd) };
    }
    case 'all_time':
      return { from: null, to: null };
    case 'custom':
      return { from: null, to: null };
  }
}

function storageKey(bookId: string) {
  return `smith.bookkeeping.${bookId}.period`;
}

export default function PeriodSelector({ bookId, value, onChange, fyStartMonth = 4 }: Props) {
  const [preset, setPreset] = useState<Preset>('this_fy');

  // Hydrate from localStorage on mount.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(storageKey(bookId));
      if (raw) {
        const stored = JSON.parse(raw) as { preset: Preset; range: DateRange };
        setPreset(stored.preset);
        onChange(stored.range);
        return;
      }
    } catch { /* ignore */ }
    // No stored preference — apply the default preset (this FY).
    const r = rangeForPreset('this_fy', new Date(), fyStartMonth);
    onChange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on change.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(storageKey(bookId), JSON.stringify({ preset, range: value }));
    } catch { /* ignore */ }
  }, [bookId, preset, value]);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== 'custom') {
      onChange(rangeForPreset(p, new Date(), fyStartMonth));
    }
  }

  function setFrom(v: string) {
    setPreset('custom');
    onChange({ ...value, from: v || null });
  }
  function setTo(v: string) {
    setPreset('custom');
    onChange({ ...value, to: v || null });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CalendarDays size={13} className="text-gray-400" />
      <div className="flex items-center gap-1 text-xs text-gray-700">
        <span className="text-gray-500 mr-1">Period</span>
        {/* DateInput speaks dd/mm/yyyy externally — convert at the seams so
            the stored DateRange stays ISO (yyyy-mm-dd) like the rest of the
            API. Empty input clears the bound to null via the existing setters. */}
        <div className="w-32">
          <DateInput
            value={fromIso(value.from ?? '')}
            onChange={uk => setFrom(toIso(uk))}
            className="px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <span className="text-gray-300">→</span>
        <div className="w-32">
          <DateInput
            value={fromIso(value.to ?? '')}
            onChange={uk => setTo(toIso(uk))}
            className="px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {PRESETS.map(p => {
          const active = p.id === preset;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-700'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
