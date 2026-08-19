'use client';

/**
 * Year-end visual markers for ledger views.
 *
 * The year-end close posts a YET journal dated on the LAST day of the year it
 * closes — that's the correct treatment (the closing entry is the final entry
 * OF that year, which is what flattens the nominals to nil and lets the balance
 * carry forward at zero). Dating it into the following year would leave the
 * closed year unsquared and open the new one with the old year's balances in it.
 *
 * But rendered as an ordinary ledger row it reads like just another transaction
 * sitting on the same date as everything else, which invites the reasonable
 * double-take of "why is the close inside the year it closed?". These markers
 * make it read as what it is: a period boundary.
 *
 *   • YearEndChip     — a "Year end" pill next to the reference.
 *   • YearEndRowClass — the row tint.
 *   • YearEndBoundaryRow — a labelled rule drawn AFTER the YET, used in views
 *     that span more than one year so the boundary between them is visible.
 */

import { CalendarCheck2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

/** True for a year-end transaction, by type or by reference ("YET 000001"). */
export function isYearEnd(typeOrRef: string | null | undefined): boolean {
  return (typeOrRef ?? '').trim().toUpperCase().startsWith('YET');
}

/** Row tint for a year-end entry. Appended after the caller's own classes. */
export const YEAR_END_ROW_CLASS = 'bg-slate-100/70 hover:bg-slate-200/60';

export function YearEndChip() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-middle px-1.5 py-px rounded-full bg-slate-200 text-slate-600 text-[9px] font-semibold uppercase tracking-wide">
      <CalendarCheck2 size={9} /> Year end
    </span>
  );
}

/**
 * A labelled rule marking the end of a financial year, rendered as its own
 * table row.
 *
 * Pass `onClick` to make the label open the year-end transaction itself. The
 * rule is where a user notices the close happened, so it's exactly where
 * they'll want to ask "what did it post?" — the alternative is hunting for the
 * YET in the transaction list.
 */
export function YearEndBoundaryRow({
  colSpan, dateLabel, onClick,
}: {
  colSpan: number;
  dateLabel: string;
  onClick?: () => void;
}) {
  const label = `Year ended ${dateLabel} · closed`;
  return (
    <tr className="border-t border-slate-300">
      <td colSpan={colSpan} className="px-3 py-1">
        <div className="flex items-center gap-2">
          <span className="h-px flex-1 bg-slate-200" />
          {onClick ? (
            <Tooltip label="Open the year-end transaction">
              <button
                type="button"
                onClick={onClick}
                aria-label={`${label} — open the year-end transaction`}
                className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap hover:text-indigo-700 hover:underline transition-colors"
              >
                {label}
              </button>
            </Tooltip>
          ) : (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">
              {label}
            </span>
          )}
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      </td>
    </tr>
  );
}
