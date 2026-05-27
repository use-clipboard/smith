'use client';

/**
 * MoveEntriesModal — "Move Entries To Another Account" lightbox.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Move N entries to the following account:    [OK] [Cancel]│
 *   ├──────────────────────────────────────────────────────────┤
 *   │ Ledger:                  │  Account:                     │
 *   │ ┌────────────────┐       │  ┌─────────────────────┐      │
 *   │ │ Suppliers   ▾  │       │  │ Amazon              │      │
 *   │ │ Customers      │       │  │ Apple.com           │      │
 *   │ │ Bank           │       │  │ B&Q                 │      │
 *   │ │ ...            │       │  │ ...                 │      │
 *   │ └────────────────┘       │  └─────────────────────┘      │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Mirrors VT's "Move Entries To Another Account" dialog — two synced lists
 * the user clicks through to drill into the destination account. Driven by
 * the same APIs as the rest of the ledger UI (/ledgers + /accounts).
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, Search } from 'lucide-react';

interface LedgerSummary { name: string; account_count: number }
interface AccountRow {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  inactive?: boolean;
  archived?: boolean;
}

interface Props {
  bookId: string;
  /** How many splits the user is about to move. Drives the header copy +
   *  is shown back to the user so they know what's being moved. */
  selectionCount: number;
  /** Free-text descriptor of the selection ("3 selected", "1 match — 4 entries") */
  selectionLabel: string;
  /** Current account so we can hide it from the destination list (you can't
   *  "move" splits to the same account they're already on). */
  currentAccountId?: string | null;
  /** Current ledger — used to default-select the same ledger when the modal
   *  opens, since most moves stay within the same ledger (e.g. supplier →
   *  supplier when the user mis-tagged a payment). Saves a click. */
  currentLedger?: string | null;
  onClose: () => void;
  onMove: (targetAccountId: string) => Promise<void>;
}

export default function MoveEntriesModal({
  bookId, selectionCount, selectionLabel, currentAccountId, currentLedger, onClose, onMove,
}: Props) {
  const [ledgers, setLedgers] = useState<LedgerSummary[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [selectedLedger, setSelectedLedger] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load ledgers on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}/ledgers`)
      .then(r => r.ok ? r.json() : { ledgers: [] })
      .then(d => {
        if (cancelled) return;
        const list = (d.ledgers ?? []) as LedgerSummary[];
        setLedgers(list);
        // Default-select the source ledger if it's still in the list
        // (most moves stay within the same ledger). Otherwise fall back
        // to the first ledger so the right pane isn't empty.
        const initial = currentLedger && list.some(l => l.name === currentLedger)
          ? currentLedger
          : list[0]?.name;
        if (initial) setSelectedLedger(initial);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookId]);

  // Load accounts whenever the ledger changes. We use pickable_only=true to
  // hide inactive / archived / system-managed accounts — the user can't
  // move to those anyway, so don't tempt them.
  // If pickable_only returns a 500 (almost always the system_managed column
  // missing because migration 20260623 hasn't been applied yet), we retry
  // WITHOUT the flag and filter client-side. That keeps the move workflow
  // working even on partially-migrated installs.
  useEffect(() => {
    if (!selectedLedger) { setAccounts([]); return; }
    let cancelled = false;
    setError('');

    async function load() {
      const tryParams = new URLSearchParams({ ledger: selectedLedger, pickable_only: 'true' });
      let r = await fetch(`/api/bookkeeping/books/${bookId}/accounts?${tryParams}`);
      if (!r.ok) {
        // Most likely cause: system_managed column missing — fall back to
        // a wider fetch and filter client-side. Surface the message in case
        // it was something else.
        const errBody = await r.json().catch(() => ({}));
        const fallbackParams = new URLSearchParams({ ledger: selectedLedger });
        r = await fetch(`/api/bookkeeping/books/${bookId}/accounts?${fallbackParams}`);
        if (!r.ok) {
          if (!cancelled) setError(errBody?.error ?? 'Failed to load accounts.');
          return;
        }
      }
      const d = await r.json();
      if (cancelled) return;
      const list = (d.accounts ?? []) as AccountRow[];
      // Client-side defence — hide inactive/archived/system_managed in case
      // the server didn't already (older API or fallback path above).
      const filtered = list.filter(a =>
        !a.inactive
        && !a.archived
        // system_managed only set if the migration's run, treat undefined as false.
        && !(a as AccountRow & { system_managed?: boolean }).system_managed,
      );
      setAccounts(filtered);
      setSelectedAccountId(null);
    }

    void load();
    return () => { cancelled = true; };
  }, [bookId, selectedLedger]);

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    // Keep the current account in the list — greyed-out + un-clickable —
    // so the user has a visible anchor for "this is where the entries
    // currently are". Filtering it out was technically correct (can't
    // move-to-self) but disorienting in practice.
    return accounts.filter(a => !q || a.name.toLowerCase().includes(q));
  }, [accounts, accountSearch]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      // Enter triggers OK when an account is picked (handy for keyboard users).
      if (e.key === 'Enter' && selectedAccountId && !submitting) void submit();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, selectedAccountId, submitting]);

  async function submit() {
    if (!selectedAccountId) return;
    setSubmitting(true);
    setError('');
    try {
      await onMove(selectedAccountId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
      setSubmitting(false);
    }
    // No need to setSubmitting(false) on success — the modal closes.
  }

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-entries-title"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/40">
          <div>
            <h2 id="move-entries-title" className="text-sm font-semibold text-slate-900">Move entries to another account</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Moving {selectionLabel}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <X size={14} />
          </button>
        </div>

        {/* Two-column body — ledger list left, account list right. */}
        <div className="flex-1 grid grid-cols-2 gap-0 min-h-0 border-t border-slate-100">
          {/* Ledger pane */}
          <div className="border-r border-slate-200 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/40">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ledger</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-6 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin mr-1.5" /> Loading…
                </div>
              ) : ledgers.length === 0 ? (
                <p className="text-xs text-slate-400 italic px-3 py-3">No ledgers yet.</p>
              ) : (
                <ul>
                  {ledgers.map(l => {
                    const active = l.name === selectedLedger;
                    return (
                      <li key={l.name}>
                        <button
                          type="button"
                          onClick={() => setSelectedLedger(l.name)}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                            active
                              ? 'bg-indigo-50 text-indigo-700 font-semibold'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span className="truncate">{l.name}</span>
                          <span className="text-[10px] text-slate-400 tabular-nums shrink-0 ml-2">{l.account_count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Account pane */}
          <div className="flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/40">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Account</div>
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                  placeholder="Filter accounts…"
                  className="w-full text-xs pl-7 pr-3 py-1 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredAccounts.length === 0 ? (
                <p className="text-xs text-slate-400 italic px-3 py-3">
                  {accountSearch ? `No accounts match "${accountSearch}".` : 'No accounts in this ledger.'}
                </p>
              ) : (
                <ul>
                  {filteredAccounts.map(a => {
                    const active = a.id === selectedAccountId;
                    const isCurrent = a.id === currentAccountId;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => { if (!isCurrent) setSelectedAccountId(a.id); }}
                          onDoubleClick={() => {
                            if (isCurrent) return;
                            setSelectedAccountId(a.id);
                            void submit();
                          }}
                          disabled={isCurrent}
                          aria-disabled={isCurrent}
                          // Source account stays visible as an "anchor" so
                          // the user remembers where the entries are now,
                          // but it's greyed out + unclickable (you can't
                          // move-to-self). A "(current)" tag makes that
                          // explicit.
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                            isCurrent
                              ? 'bg-slate-50 text-slate-400 italic cursor-not-allowed'
                              : active
                              ? 'bg-indigo-50 text-indigo-700 font-semibold'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span className="truncate">{a.name}</span>
                          {isCurrent && (
                            <span className="text-[10px] uppercase tracking-wide text-slate-400 ml-2 shrink-0 not-italic">current</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-rose-50 text-xs text-rose-700 border-t border-rose-100">{error}</div>
        )}

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50/40">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!selectedAccountId || submitting}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {submitting ? <Loader2 size={11} className="animate-spin" /> : null}
            Move {selectionCount} {selectionCount === 1 ? 'entry' : 'entries'}
          </button>
        </div>
      </div>
    </div>
  );
}
