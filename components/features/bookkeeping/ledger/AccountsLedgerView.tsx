'use client';

/**
 * AccountsLedgerView — master/detail view of a single ledger (Suppliers or
 * Customers). Modelled on VT's supplier-ledger window:
 *
 *   ┌─ Left: A-Z list of accounts ─┐  ┌─ Right: selected account's entries ─┐
 *   │  Search…                     │  │  Tip / selection summary             │
 *   │  All Suppliers   £81,084.03  │  │  Date | Ref | Details | A | Dr | Cr  │
 *   │  Acme Ltd          £123.00   │  │  ...                                  │
 *   │  Amazon         £23,114.42   │  │                                        │
 *   │  ...                         │  │                                        │
 *   │  Total          £81,084.03   │  │  Filter tabs: All / Open entries     │
 *   └──────────────────────────────┘  └───────────────────────────────────────┘
 *
 * Click rows to select. When two or more selected entries balance to zero,
 * the Match button enables — click to create a 'full' allocation. Matched
 * entries get a ✓ icon and are hidden from the Open entries view.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Search, Loader2, Link2, Unlink, Check, X, AlertCircle,
  Users, Building2, ChevronDown, ChevronUp,
  Wallet, ReceiptText, Layers, FileBadge, Coins, Boxes, FolderTree, ShoppingCart,
} from 'lucide-react';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface AccountSummary {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  /** Display balance — positive on the natural side for the ledger. */
  balance: number;
}

interface Entry {
  split_id: string;
  transaction_id: string;
  ref_no: string;
  date: string;
  details: string | null;
  due_date: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  match_id: string | null;
  match_status: 'full' | 'partial' | 'write_off' | null;
}

interface Props {
  bookId: string;
  /** Which ledger to drive the master list — any string matching the
   *  account.ledger column. 'Suppliers' / 'Customers' get their bespoke
   *  titles; everything else falls back to the ledger name verbatim. */
  ledger: string;
  /** Optional account id to pre-select on first render. Used by the TB
   *  drill-down so the clicked account opens straight onto its statement. */
  initialAccountId?: string;
}

type StatusFilter = 'open' | 'all';

// Bespoke titles + balance labels for the AR/AP ledgers. Anything else
// falls through to the generic config below, which uses the ledger name as
// the title and a sensible icon based on the account type.
const TITLE_MAP: Record<string, { title: string; icon: typeof Users; balanceLabel: string; iconTone: string }> = {
  Suppliers: { title: 'Suppliers', icon: Building2,  balanceLabel: 'They are owed', iconTone: 'bg-violet-50 text-violet-600' },
  Customers: { title: 'Customers', icon: Users,      balanceLabel: 'They owe us',   iconTone: 'bg-violet-50 text-violet-600' },
  Bank:      { title: 'Bank',      icon: Wallet,     balanceLabel: 'Total in bank', iconTone: 'bg-emerald-50 text-emerald-600' },
};

// Static fallback icon per ledger family (so common ledgers don't always
// fall back to the generic FolderTree).
function fallbackIcon(ledger: string): typeof Users {
  if (ledger.startsWith('FA ')) return Boxes;
  if (ledger.startsWith('Investments')) return Boxes;
  if (ledger === 'Income')       return ReceiptText;
  if (ledger === 'Cost of sales') return ShoppingCart;
  if (ledger === 'Expenses')     return Coins;
  if (ledger === 'Taxation')     return FileBadge;
  if (ledger === 'Stocks')       return Boxes;
  if (ledger === 'Debtors')      return Users;
  if (ledger === 'Creditors')    return Building2;
  if (ledger === 'Deferred tax') return FileBadge;
  if (ledger.startsWith('Share') || ledger === 'Revaluation reserve' || ledger === 'Profit and loss account') return Layers;
  return FolderTree;
}


function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return '0.00';
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

// Display balance for an account row in the master list. We hit the /balances
// endpoint which returns natural Dr-Cr; for Suppliers (liability) we flip the
// sign so the balance reads positive when we owe them.
function displayBalance(account_type: string, balance: number): number {
  if (account_type === 'liability' || account_type === 'equity' || account_type === 'income') return -balance;
  return balance;
}

export default function AccountsLedgerView({ bookId, ledger, initialAccountId }: Props) {
  // Resolve title / icon / balance label — bespoke for AR/AP/Bank, generic
  // fallback for everything else (FA - vehicles, Expenses, etc.).
  const bespoke = TITLE_MAP[ledger];

  // Book-level VAT info for row-actions edit modal late-entry detection.
  const [bookVatInfo, setBookVatInfo] = useState<{ vatRegistered: boolean; vatLockDate: string | null }>({
    vatRegistered: false, vatLockDate: null,
  });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.book) return;
        setBookVatInfo({
          vatRegistered: Boolean(d.book.vat_registered),
          vatLockDate: d.book.vat_lock_date ?? null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);
  const TitleIcon = bespoke?.icon ?? fallbackIcon(ledger);
  const title = bespoke?.title ?? ledger;
  const balanceLabel = bespoke?.balanceLabel ?? 'Total';
  const iconTone = bespoke?.iconTone ?? 'bg-slate-100 text-slate-600';

  // ── Master list state ──────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(initialAccountId ?? null);
  const [sortBy, setSortBy] = useState<'name' | 'balance'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Row actions — exposed via right-click (no inline strip in this view to
  // avoid clashing with the per-row matching-checkbox interaction).
  // Lazy-loaded inside the callback; the modal fetches the full transaction.
  // Defined later via useTransactionRowActions once the relevant deps are in scope.

  /** Hide accounts with no movement. Default ON for COA ledgers (Expenses,
   *  Cost of sales, etc.) where most accounts in a 100+ COA are unused —
   *  default OFF for AR/AP ledgers where every supplier/customer matters
   *  even when their balance has netted to zero. */
  const [hideEmpty, setHideEmpty] = useState<boolean>(
    !['Suppliers', 'Customers', 'Bank'].includes(ledger),
  );

  // Load accounts + their balances on mount.
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const [accountsRes, balancesRes] = await Promise.all([
        fetch(`/api/bookkeeping/books/${bookId}/accounts?ledger=${encodeURIComponent(ledger)}`),
        fetch(`/api/bookkeeping/books/${bookId}/balances?include_zero=true`),
      ]);
      const accountsBody  = accountsRes.ok  ? await accountsRes.json()  : { accounts: [] };
      const balancesBody  = balancesRes.ok  ? await balancesRes.json()  : { accounts: [] };

      type BalanceRow = { id: string; balance: number };
      const balById = new Map<string, number>(
        (balancesBody.accounts as BalanceRow[]).map((b: BalanceRow) => [b.id, b.balance]),
      );
      const merged: AccountSummary[] = (accountsBody.accounts as Array<{
        id: string; name: string; ledger: string | null; account_type: string;
      }>).map(a => ({
        ...a,
        balance: displayBalance(a.account_type, balById.get(a.id) ?? 0),
      }));
      setAccounts(merged);
      // Auto-select: respect any pre-selected id from props (TB drill-down
      // sets this); otherwise pick the first account with movement so the
      // pane isn't blank.
      if (merged.length > 0 && !selectedAccountId) {
        if (initialAccountId && merged.some(a => a.id === initialAccountId)) {
          setSelectedAccountId(initialAccountId);
        } else {
          const firstWithMovement = merged.find(a => Math.abs(a.balance) > 0.005);
          setSelectedAccountId(firstWithMovement?.id ?? merged[0].id);
        }
      }
    } finally {
      setLoadingAccounts(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, ledger]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? accounts.filter(a => a.name.toLowerCase().includes(q))
      : accounts;
    if (hideEmpty) {
      list = list.filter(a => Math.abs(a.balance) > 0.005);
    }
    const sorted = [...list].sort((a, b) => {
      const cmp = sortBy === 'name'
        ? a.name.localeCompare(b.name)
        : a.balance - b.balance;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [accounts, search, sortBy, sortDir, hideEmpty]);

  /** Count of accounts that have any movement — used in the "hidden N" hint. */
  const activeCount = useMemo(
    () => accounts.filter(a => Math.abs(a.balance) > 0.005).length,
    [accounts],
  );

  const total = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);

  // ── Detail (entries) state ─────────────────────────────────────────────
  const [entries, setEntries] = useState<Entry[]>([]);
  const [accountMeta, setAccountMeta] = useState<{ name: string; openingBalance: number; closingBalance: number } | null>(null);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [selectedSplitIds, setSelectedSplitIds] = useState<Set<string>>(new Set());
  const [matching, setMatching] = useState(false);
  /** When set, all entries with this match_id glow amber so the user can
   *  see at a glance which entries belong to the same allocation. */
  const [highlightedMatchId, setHighlightedMatchId] = useState<string | null>(null);
  /** When set, the un-match modal is open for this match — shows the
   *  entries inside and lets the user remove some or all of them. */
  const [unmatchModalMatchId, setUnmatchModalMatchId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoadingEntries(true);
    setEntriesError('');
    setSelectedSplitIds(new Set());
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const r = await fetch(
        `/api/bookkeeping/books/${bookId}/accounts/${selectedAccountId}/entries?${params}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to load entries');
      }
      const d = await r.json();
      setEntries((d.entries ?? []) as Entry[]);
      setAccountMeta({
        name: d.account?.name ?? '',
        openingBalance: Number(d.account?.opening_balance ?? 0),
        closingBalance: Number(d.account?.closing_balance ?? 0),
      });
    } catch (e) {
      setEntriesError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoadingEntries(false);
    }
  }, [bookId, selectedAccountId, statusFilter]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  // Row actions — wires right-click context menu + edit/duplicate/delete/audit.
  // We don't render the hover-icon strip in this view because the per-row
  // matching checkbox already owns that interaction zone; users get to the
  // same actions via right-click anywhere on the row.
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered: bookVatInfo.vatRegistered,
    vatLockDate: bookVatInfo.vatLockDate,
    onChanged: () => { void loadEntries(); void loadAccounts(); },
  });
  /** Cast an Entry to the minimum Transaction shape the row-actions hook
   *  needs. The TransactionEditModal does its own full fetch by id. */
  function entryAsTxnStub(e: Entry): Transaction {
    const type = (e.ref_no.split(' ')[0] ?? 'PAY') as TransactionType;
    return {
      id: e.transaction_id,
      book_id: bookId,
      type,
      ref_no: e.ref_no,
      ref_seq: 0,
      date: e.date,
      payee_text: null,
      details: e.details,
      total: 0,
      vat_total: 0,
      vat_rate: null,
      vat_treatment: null,
      vat_period_override: null,
      primary_account_id: null,
      status: 'posted',
      created_by: null,
      created_at: '',
      updated_at: '',
      posted_at: null,
    };
  }

  // ── Selection / highlight models ─────────────────────────────────────
  // Two different things happen on row click depending on the row's state:
  //   • Open (unmatched) row → toggle selection (for building a new match)
  //   • Matched row          → flash the whole match (every row sharing its
  //                            match_id glows so the user can see what was
  //                            matched together)
  function handleRowClick(entry: Entry) {
    if (entry.match_id) {
      setHighlightedMatchId(prev => prev === entry.match_id ? null : entry.match_id);
      return;
    }
    setSelectedSplitIds(prev => {
      const next = new Set(prev);
      if (next.has(entry.split_id)) next.delete(entry.split_id); else next.add(entry.split_id);
      return next;
    });
  }

  // Clear highlight when leaving the account, refetching, or matching.
  useEffect(() => { setHighlightedMatchId(null); }, [selectedAccountId, statusFilter]);

  const selected = useMemo(() => entries.filter(e => selectedSplitIds.has(e.split_id)), [entries, selectedSplitIds]);
  const selDr = selected.reduce((s, e) => s + e.debit, 0);
  const selCr = selected.reduce((s, e) => s + e.credit, 0);
  const selDiff = +(selDr - selCr).toFixed(2);
  const balancedFull = selected.length >= 2 && Math.abs(selDiff) < 0.005;

  async function matchSelected(status: 'full' | 'partial') {
    if (selected.length < 2) return;
    setMatching(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_ids: [...selectedSplitIds], status }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Match failed');
      }
      setSelectedSplitIds(new Set());
      await Promise.all([loadEntries(), loadAccounts()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Match failed');
    } finally {
      setMatching(false);
    }
  }

  async function unmatchAll(matchId: string) {
    const r = await fetch(`/api/bookkeeping/books/${bookId}/matches/${matchId}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error ?? 'Un-match failed');
    }
    await Promise.all([loadEntries(), loadAccounts()]);
  }

  async function unmatchSelected(matchId: string, splitIds: string[]) {
    const r = await fetch(`/api/bookkeeping/books/${bookId}/matches/${matchId}/remove-lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ split_ids: splitIds }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error ?? 'Un-match failed');
    }
    await Promise.all([loadEntries(), loadAccounts()]);
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 items-start">
      {/* ── Master list ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col" style={{ height: 'calc(100vh - 14rem)' }}>
        <div className="px-3 pt-3 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconTone}`}>
              <TitleIcon size={14} />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 truncate" title={title}>{title}</h3>
            <span className="ml-auto text-[10px] uppercase tracking-wide font-semibold text-slate-400 tabular-nums">
              {hideEmpty ? `${activeCount}/${accounts.length}` : accounts.length}
            </span>
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="w-full text-xs pl-7 pr-3 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            />
          </div>
          {/* Hide-empty toggle — keeps long COA ledgers (50+ accounts) usable
              by collapsing unused rows. Only shown when there's actually
              something to hide. */}
          {accounts.length > activeCount && (
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={e => setHideEmpty(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3 h-3"
              />
              <span>
                Hide empty accounts
                <span className="text-slate-400">
                  {' '}({accounts.length - activeCount} hidden)
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingAccounts ? (
            <div className="flex items-center justify-center py-6 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin mr-1.5" /> Loading…
            </div>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-3 py-3">
              {accounts.length === 0
                ? `No ${title.toLowerCase()} yet — they get added as you post their first invoice.`
                : `No ${title.toLowerCase()} match "${search}".`}
            </p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {/* "All <Title>" sticky header row */}
              <li>
                <button
                  type="button"
                  onClick={() => { setSortBy('name'); setSortDir(d => sortBy === 'name' ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500 hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-1">
                    Name {sortBy === 'name' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSortBy('balance'); setSortDir(d => sortBy === 'balance' ? (d === 'asc' ? 'desc' : 'asc') : 'desc'); }}
                    className="inline-flex items-center gap-1 hover:text-slate-700"
                  >
                    Balance {sortBy === 'balance' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                  </button>
                </button>
              </li>
              {filteredAccounts.map(a => {
                const active = a.id === selectedAccountId;
                const nonZero = Math.abs(a.balance) > 0.005;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedAccountId(a.id)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                        active
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span className="text-xs truncate flex-1">{a.name}</span>
                      <span className={`text-xs tabular-nums shrink-0 ml-2 ${
                        active ? 'font-semibold' : nonZero ? 'text-slate-700' : 'text-slate-400'
                      }`}>
                        {fmt(a.balance)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Total at the bottom */}
        <div className="border-t border-slate-200 px-3 py-2 flex items-center justify-between bg-slate-50">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
            Total · {balanceLabel}
          </span>
          <span className="text-sm font-bold text-slate-900 tabular-nums">{fmt(total)}</span>
        </div>
      </div>

      {/* ── Detail pane ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col" style={{ height: 'calc(100vh - 14rem)' }}>
        {!selectedAccountId ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Pick a {title.slice(0, -1).toLowerCase()} on the left to see their statement.
          </div>
        ) : (
          <>
            {/* Top instruction + selection summary */}
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/40">
              {selected.length === 0 ? (
                <p className="text-xs text-slate-600">
                  <span className="font-medium text-slate-800">{accountMeta?.name ?? '…'}</span> — tick the entries you want to allocate against each other.
                  When their debits and credits balance, click <span className="font-medium text-indigo-700">Match</span>.
                </p>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-900">{selected.length}</span> selected ·
                    Dr <span className="font-mono tabular-nums">{fmt(selDr)}</span> /
                    Cr <span className="font-mono tabular-nums">{fmt(selCr)}</span> ·
                    Diff <span className={`font-mono tabular-nums font-semibold ${
                      Math.abs(selDiff) < 0.005 ? 'text-emerald-700' : 'text-amber-700'
                    }`}>{fmt(selDiff)}</span>
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedSplitIds(new Set())}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    >
                      <X size={11} /> Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => void matchSelected('full')}
                      disabled={!balancedFull || matching}
                      title={balancedFull ? 'Match these entries' : 'Selected entries must balance (Dr = Cr) to fully match'}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {matching ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                      Match
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Entries table — scrolls inside the fixed-height card */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {entriesError && (
                <div className="m-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{entriesError}</div>
              )}
              {loadingEntries ? (
                <div className="flex items-center justify-center py-10 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin mr-1.5" /> Loading entries…
                </div>
              ) : entries.length === 0 ? (
                <p className="text-xs text-slate-400 italic px-4 py-6 text-center">
                  No {statusFilter === 'open' ? 'open ' : ''}entries on this account.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left w-8" />
                      <th className="px-3 py-2 text-left w-24">Date</th>
                      <th className="px-3 py-2 text-left w-28">Reference</th>
                      <th className="px-3 py-2 text-left">Details</th>
                      <th className="px-3 py-2 text-center w-12">A</th>
                      <th className="px-3 py-2 text-right w-28">Debit</th>
                      <th className="px-3 py-2 text-right w-28">Credit</th>
                      <th className="px-3 py-2 text-right w-28">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(e => {
                      const matched = e.match_id !== null;
                      const isSelected = selectedSplitIds.has(e.split_id);
                      const isHighlightedMatch = matched && e.match_id === highlightedMatchId;
                      return (
                        <tr
                          key={e.split_id}
                          onClick={() => handleRowClick(e)}
                          onContextMenu={ev => {
                            const t = ev.target as HTMLElement;
                            if (t.closest('input, textarea, select, [contenteditable]')) return;
                            ev.preventDefault();
                            // Use the rowProps' context-menu handler against
                            // the constructed txn stub.
                            const stub = entryAsTxnStub(e);
                            rowActions.rowProps(stub).onContextMenu(ev);
                          }}
                          className={`border-b border-slate-50 cursor-pointer transition-colors ${
                            isHighlightedMatch
                              ? 'bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-200'
                              : matched
                              ? 'opacity-70 hover:bg-slate-50'
                              : 'hover:bg-slate-50'
                          } ${isSelected ? 'bg-indigo-50 hover:bg-indigo-50' : ''}`}
                        >
                          <td className="px-3 py-1.5">
                            {!matched && (
                              <span
                                aria-hidden
                                className={`inline-flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                                  isSelected
                                    ? 'bg-indigo-600 border-indigo-600'
                                    : 'bg-white border-slate-300 group-hover:border-slate-400'
                                }`}
                              >
                                {isSelected && <Check size={11} strokeWidth={3} className="text-white" />}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-slate-700 tabular-nums">{formatDateUk(e.date)}</td>
                          <td className="px-3 py-1.5 text-indigo-700 text-xs">{e.ref_no}</td>
                          <td className="px-3 py-1.5 text-slate-900 truncate max-w-[300px]">{e.details ?? ''}</td>
                          <td className="px-3 py-1.5 text-center">
                            {e.match_status === 'full' && (
                              <button
                                type="button"
                                onClick={(ev) => { ev.stopPropagation(); if (e.match_id) setUnmatchModalMatchId(e.match_id); }}
                                title="Fully matched — click to manage allocation"
                                className="inline-flex items-center justify-center w-5 h-5 rounded text-emerald-700 hover:bg-emerald-100"
                              >
                                <Check size={12} strokeWidth={3} />
                              </button>
                            )}
                            {e.match_status === 'partial' && (
                              <span title="Partially matched" className="inline-flex items-center justify-center w-5 h-5 text-amber-700">
                                <AlertCircle size={11} />
                              </span>
                            )}
                            {e.match_status === 'write_off' && (
                              <span title="Written off" className="inline-flex items-center justify-center w-5 h-5 text-slate-500">
                                <Unlink size={11} />
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">
                            {e.debit > 0 ? fmt(e.debit) : ''}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-rose-700">
                            {e.credit > 0 ? fmt(e.credit) : ''}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                            {fmt(e.running_balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50">
                      <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                        Balance carried forward
                      </td>
                      <td />
                      <td />
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">
                        {fmt(accountMeta?.closingBalance ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Filter tabs at the bottom */}
            <div className="border-t border-slate-200 px-3 py-2 flex items-center gap-2 bg-slate-50/40">
              {([
                { id: 'open' as const, label: 'Open entries' },
                { id: 'all'  as const, label: 'All entries'  },
              ]).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStatusFilter(t.id)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    statusFilter === t.id
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'text-slate-600 border-transparent hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-slate-400">
                {entries.length} {statusFilter === 'open' ? 'open' : 'total'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Un-match modal */}
      {unmatchModalMatchId && (
        <UnmatchModal
          matchId={unmatchModalMatchId}
          entries={entries.filter(e => e.match_id === unmatchModalMatchId)}
          onClose={() => setUnmatchModalMatchId(null)}
          onUnmatchAll={async () => {
            try {
              await unmatchAll(unmatchModalMatchId);
              setUnmatchModalMatchId(null);
            } catch (e) {
              alert(e instanceof Error ? e.message : 'Un-match failed');
            }
          }}
          onUnmatchSelected={async (splitIds) => {
            try {
              await unmatchSelected(unmatchModalMatchId, splitIds);
              setUnmatchModalMatchId(null);
            } catch (e) {
              alert(e instanceof Error ? e.message : 'Un-match failed');
            }
          }}
        />
      )}

      {/* Row actions — right-click context menu + edit/duplicate/audit/delete */}
      {rowActions.menus}
    </div>
  );
}

// ── Un-match modal ────────────────────────────────────────────────────────────

function UnmatchModal({
  matchId, entries, onClose, onUnmatchAll, onUnmatchSelected,
}: {
  matchId: string;
  entries: Entry[];
  onClose: () => void;
  onUnmatchAll: () => Promise<void>;
  onUnmatchSelected: (splitIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(prev => prev.size === entries.length ? new Set() : new Set(entries.map(e => e.split_id)));
  }

  const allSelected = selected.size === entries.length && entries.length > 0;
  const someSelected = selected.size > 0;

  // If the user picks every entry, "remove selected" would leave 0 lines and
  // delete the match anyway — show that explicitly via a single button.
  const willDeleteMatch = allSelected || entries.length - selected.size < 2;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`unmatch-${matchId}-title`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Check size={14} strokeWidth={3} />
            </div>
            <div>
              <h2 id={`unmatch-${matchId}-title`} className="text-sm font-semibold text-slate-900">Allocation</h2>
              <p className="text-[11px] text-slate-500">{entries.length} entries matched together · tick the ones you want to release.</p>
            </div>
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

        {/* Body — match contents */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Select-all row */}
          <button
            type="button"
            onClick={toggleAll}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-slate-500 hover:bg-slate-50 rounded"
          >
            <span
              aria-hidden
              className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                allSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
              }`}
            >
              {allSelected && <Check size={11} strokeWidth={3} className="text-white" />}
            </span>
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <ul className="space-y-0.5 mt-1">
            {entries.map(e => {
              const isChecked = selected.has(e.split_id);
              return (
                <li key={e.split_id}>
                  <button
                    type="button"
                    onClick={() => toggle(e.split_id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                      isChecked ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                        isChecked ? 'bg-rose-600 border-rose-600' : 'bg-white border-slate-300'
                      }`}
                    >
                      {isChecked && <Check size={11} strokeWidth={3} className="text-white" />}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums w-16">{formatDateUk(e.date)}</span>
                    <span className="text-xs text-indigo-700 w-20">{e.ref_no}</span>
                    <span className="text-xs text-slate-900 flex-1 truncate">{e.details ?? ''}</span>
                    <span className="text-xs tabular-nums text-slate-700 w-20 text-right">
                      {e.debit > 0 ? fmt(e.debit) : ''}
                    </span>
                    <span className="text-xs tabular-nums text-rose-700 w-20 text-right">
                      {e.credit > 0 ? fmt(e.credit) : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-200 p-3 flex items-center gap-2 flex-wrap bg-slate-50/40">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex-1" />
          {someSelected && !willDeleteMatch && (
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                try { await onUnmatchSelected([...selected]); } finally { setBusy(false); }
              }}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-50"
            >
              Remove {selected.size} from match
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Un-match the entire allocation? Every entry returns to the open list.')) return;
              setBusy(true);
              try { await onUnmatchAll(); } finally { setBusy(false); }
            }}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {willDeleteMatch && someSelected ? 'Un-match all' : 'Un-match all'}
          </button>
        </div>
      </div>
    </div>
  );
}
