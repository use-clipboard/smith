'use client';

/**
 * EntryToastHost — floating quick-entry windows for the bookkeeping module.
 *
 * When a user picks a transaction type from the side-rail "+" menu, instead of
 * navigating away to the full Input tab we pop a floating panel in the bottom-
 * right corner that hosts the very same entry grid (UniversalInputSheet /
 * JournalInputSheet, unchanged). This keeps whatever ledger / report the user
 * was looking at visible underneath, so they can see what the entry needs to
 * be while they type it.
 *
 * Behaviour:
 *   - Multiple panels can be open at once. They cascade from the bottom-right;
 *     clicking a panel brings it to the front.
 *   - Each panel can be minimised to a chip (a row of chips sits along the
 *     bottom edge) and restored later.
 *   - Posting an entry leaves the panel open — the embedded sheet resets itself
 *     to a fresh blank row — so the user can keep entering (VT-style rapid
 *     entry). The panel closes only when the user closes it.
 *   - The embedded sheet keeps its own type-selector bar, so switching type
 *     inside a panel works exactly as it does on the Input tab (including
 *     reaching YET/DVT/WOF/WBK, which were removed from the + menu but remain
 *     valid entry types). The host swaps between the journal grid and the
 *     universal grid based on the panel's current type.
 */

import { X, Minus } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import UniversalInputSheet from './UniversalInputSheet';
import JournalInputSheet from './JournalInputSheet';
import type { TransactionType } from '@/types/bookkeeping';

export interface EntryToast {
  /** Local-only React key / handle. */
  id: string;
  /** Current transaction type — follows the embedded sheet's type bar. */
  type: TransactionType;
  /** Collapsed to a chip when true. */
  minimised: boolean;
}

/** Types that use the multi-leg Dr/Cr journal grid rather than the universal
 *  header-plus-analysis grid. Mirrors the swap logic on the Input tab. */
const JOURNAL_TYPES = new Set<TransactionType>(['JRN', 'RJN', 'YET', 'DVT']);

interface Props {
  toasts: EntryToast[];
  bookId: string;
  vatRegistered: boolean;
  vatScheme?: string | null;
  vatLockDate?: string | null;
  /** ISO date new entries default to — the end of the currently-selected
   *  accounting period. Falls back to today when null. */
  defaultDateIso?: string | null;
  /** Update a panel's type when the user switches it via the embedded sheet. */
  onTypeChange: (id: string, type: TransactionType) => void;
  onMinimise: (id: string, minimised: boolean) => void;
  onClose: (id: string) => void;
  /** Raise a panel to the front (called on mousedown anywhere in the panel). */
  onFocus: (id: string) => void;
  /** Fired after any successful post so the Home tab / balances refresh. */
  onPosted: () => void;
}

export default function EntryToastHost({
  toasts, bookId, vatRegistered, vatScheme, vatLockDate, defaultDateIso,
  onTypeChange, onMinimise, onClose, onFocus, onPosted,
}: Props) {
  if (toasts.length === 0) return null;

  const openToasts = toasts.filter(t => !t.minimised);
  const minimised  = toasts.filter(t => t.minimised);

  // Lift open panels above the chip row when chips are present so the chips
  // stay clickable underneath.
  const bottomBase = minimised.length > 0 ? 64 : 16;

  return (
    <>
      {/* Open panels — cascade from the bottom-right; last in array on top. */}
      {openToasts.map((t, i) => {
        const isJournal = JOURNAL_TYPES.has(t.type);
        // The front panel (last in array → focused) sits at the corner; older
        // panels peek out up-and-left behind it.
        const depth = openToasts.length - 1 - i;
        return (
          <div
            key={t.id}
            className="fixed w-[min(96vw,1440px)] flex flex-col bg-white rounded-xl shadow-2xl border border-slate-200"
            style={{
              bottom: bottomBase + depth * 26,
              right: 16 + depth * 26,
              maxHeight: '82vh',
              zIndex: 60 + i,
            }}
            onMouseDown={() => onFocus(t.id)}
          >
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 rounded-t-xl shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">New transaction</span>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{t.type}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <Tooltip label="Minimise">
                  <button
                    onClick={() => onMinimise(t.id, true)}
                    aria-label="Minimise"
                    className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    <Minus size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="Close">
                  <button
                    onClick={() => onClose(t.id)}
                    aria-label="Close"
                    className="p-1 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Body — the existing entry grid, scrollable when it overflows. */}
            <div className="overflow-auto p-4 grow">
              {isJournal ? (
                <JournalInputSheet
                  bookId={bookId}
                  vatRegistered={vatRegistered}
                  type={t.type as 'JRN' | 'RJN' | 'YET' | 'DVT'}
                  onTypeChange={next => onTypeChange(t.id, next)}
                  onPosted={onPosted}
                  defaultDateIso={defaultDateIso}
                />
              ) : (
                <UniversalInputSheet
                  bookId={bookId}
                  vatRegistered={vatRegistered}
                  vatScheme={vatScheme}
                  vatLockDate={vatLockDate}
                  type={t.type}
                  onTypeChange={next => onTypeChange(t.id, next)}
                  onPosted={onPosted}
                  defaultDateIso={defaultDateIso}
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Minimised chips — a row along the bottom-right. */}
      {minimised.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[70] flex flex-wrap-reverse justify-end gap-2 max-w-[70vw]">
          {minimised.map(t => (
            <div
              key={t.id}
              className="inline-flex items-center gap-2 pl-3 pr-1.5 py-2 rounded-lg bg-white shadow-lg border border-slate-200"
            >
              <button
                onClick={() => onMinimise(t.id, false)}
                className="inline-flex items-center gap-2 text-left"
                aria-label={`Restore ${t.type} entry`}
              >
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{t.type}</span>
                <span className="text-xs text-slate-600">New transaction</span>
              </button>
              <Tooltip label="Close">
                <button
                  onClick={() => onClose(t.id)}
                  aria-label="Close"
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
