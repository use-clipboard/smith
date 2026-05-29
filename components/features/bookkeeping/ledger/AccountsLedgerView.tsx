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

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Search, Loader2, Link2, Unlink, Check, X, AlertCircle,
  Users, Building2, ChevronDown, ChevronUp,
  Wallet, ReceiptText, Layers, FileBadge, Coins, Boxes, FolderTree, ShoppingCart,
  Lock, CheckSquare, ArrowRightLeft,
} from 'lucide-react';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { TxnRefLink, useBookNavigation } from '../book/BookNavigationContext';
import BankRecPanel from './BankRecPanel';
import BankReconcileTab from './BankReconcileTab';
import BankRecHistoryTab from './BankRecHistoryTab';
import BankRecDetailModal from './BankRecDetailModal';
import DepreciationTab from './DepreciationTab';
import { isFixedAssetLedger, depreciationNoun } from '@/lib/bookkeeping/fixedAssets';
void BankRecPanel; // retained for fallback / future reference — superseded by BankReconcileTab in the period-first model
import { useAccountContextMenu } from './AccountContextMenu';
import MoveEntriesModal from './MoveEntriesModal';
import Tooltip from '@/components/ui/Tooltip';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface AccountSummary {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  /** Inactive accounts are still listed in the master pane (so historic
   *  balances are visible) but get a muted style + a small "locked" hint;
   *  the account-picker hides them from new-entry creation server-side. */
  inactive?: boolean;
  notes?: string | null;
  /** Display balance — positive on the natural side for the ledger. */
  balance: number;
  /** Lifetime totals — used by "Hide empty" to detect whether the account
   *  has *ever* had movement (an account that received 100 in and 100 out
   *  has balance=0 but isn't "empty" — it shouldn't be hidden). */
  debit_total: number;
  credit_total: number;
}

interface Entry {
  split_id: string;
  transaction_id: string;
  ref_no: string;
  date: string;
  details: string | null;
  /** Per-split note from the entry (e.g. "Lamp" on one leg of an expense
   *  posting). Lives alongside the transaction-level details so a single
   *  ledger row can show both the payee/narrative AND what this leg is
   *  specifically for. */
  entry_details: string | null;
  due_date: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  match_id: string | null;
  match_status: 'full' | 'partial' | 'write_off' | null;
  /** Period-first bank-rec clearing. Independent from match_id — a split
   *  can be cleared by being ticked off in a reconciliation even when no
   *  formal match record exists. */
  cleared_in_rec_id: string | null;
  bank_rec_status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned' | null;
  bank_rec_label: string | null;
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
  /** Drives admin-only options in the right-click account menu (Move,
   *  Delete, Set Up Ledgers, the "inactive" toggle in Properties). */
  isAdmin?: boolean;
}

/**
 * Bank ledgers keep the legacy three-tab strip (open / all / reconcile) so
 * the reconciliation workflow is undisturbed.
 *
 * Every other ledger gets a six-tab year-aware strip:
 *   • previousYears     — everything dated BEFORE the active FY
 *   • currentYear       — everything dated WITHIN the active FY
 *   • futureYears       — everything dated AFTER the active FY
 *   • all               — every entry, no date filter
 *   • open              — every unmatched entry, no date filter
 *   • openAtYearEnd     — unmatched entries dated within the active FY
 *
 * When no year-end is set on the book the year-aware tabs collapse to
 * just `all` + `open` (the only two that make sense without an FY).
 */
type StatusFilter =
  | 'previousYears' | 'currentYear' | 'futureYears'
  | 'open' | 'openAtYearEnd' | 'all'
  | 'reconcile' | 'history'
  | 'depreciation';

/** Returns ISO yyyy-mm-dd N days from the given ISO date. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

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

export default function AccountsLedgerView({ bookId, ledger, initialAccountId, isAdmin = false }: Props) {
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

      type BalanceRow = { id: string; balance: number; debit_total: number; credit_total: number };
      const balById = new Map<string, BalanceRow>(
        (balancesBody.accounts as BalanceRow[]).map((b: BalanceRow) => [b.id, b]),
      );
      const merged: AccountSummary[] = (accountsBody.accounts as Array<{
        id: string; name: string; ledger: string | null; account_type: string;
        inactive?: boolean; notes?: string | null;
      }>).map(a => {
        const b = balById.get(a.id);
        return {
          ...a,
          balance:      displayBalance(a.account_type, b?.balance ?? 0),
          debit_total:  b?.debit_total  ?? 0,
          credit_total: b?.credit_total ?? 0,
        };
      });
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

  /** Has the account ever been touched? Different from "current balance is
   *  non-zero" — an account that took 100 in and paid 100 out has a £0
   *  balance but is still "active" and should NOT be hidden. */
  const hasMovement = useCallback(
    (a: AccountSummary) => (a.debit_total + a.credit_total) > 0.005,
    [],
  );

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? accounts.filter(a => a.name.toLowerCase().includes(q))
      : accounts;
    if (hideEmpty) {
      list = list.filter(hasMovement);
    }
    const sorted = [...list].sort((a, b) => {
      const cmp = sortBy === 'name'
        ? a.name.localeCompare(b.name)
        : a.balance - b.balance;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [accounts, search, sortBy, sortDir, hideEmpty, hasMovement]);

  /** Count of accounts that have ever had movement — drives the "(N hidden)"
   *  hint next to the checkbox. */
  const activeCount = useMemo(
    () => accounts.filter(hasMovement).length,
    [accounts, hasMovement],
  );

  const total = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);

  // ── Detail (entries) state ─────────────────────────────────────────────
  const [entries, setEntries] = useState<Entry[]>([]);
  const [accountMeta, setAccountMeta] = useState<{ name: string; openingBalance: number; closingBalance: number } | null>(null);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState('');
  // FY-aware default: when the book has a year-end set we land on "Current
  // year" by default; otherwise on "All entries". Bank ledgers keep the
  // legacy "open" default since their three-tab strip is unchanged.
  const nav = useBookNavigation();
  const activePeriod = nav?.activePeriod;
  const fyReady = !!activePeriod?.ready;
  const fyStartIso = activePeriod?.fyStartIso ?? null;
  const fyEndIso   = activePeriod?.fyEndIso   ?? null;
  const isBankLedger = ledger === 'Bank';
  const isFaLedger = isFixedAssetLedger(ledger);
  // Default tab: now identical for Bank and non-Bank ledgers — Bank gained
  // the FY-aware tab set, so "Current year" is the natural landing when a
  // year-end is set, falling back to "All entries" otherwise. The bank-only
  // Reconcile / History tabs are opt-in via their coloured pills.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    fyReady ? 'currentYear' : 'all',
  );
  // When the FY flips from missing → set (e.g. user just picked a year-end),
  // upgrade the default from "All entries" to "Current year". Applies to
  // every ledger including Bank now they share the tab set.
  useEffect(() => {
    if (fyReady && statusFilter === 'all') setStatusFilter('currentYear');
    if (!fyReady && (statusFilter === 'previousYears' || statusFilter === 'currentYear' || statusFilter === 'futureYears' || statusFilter === 'openAtYearEnd')) {
      setStatusFilter('all');
    }
  }, [fyReady, statusFilter]);
  const [selectedSplitIds, setSelectedSplitIds] = useState<Set<string>>(new Set());
  const [matching, setMatching] = useState(false);
  /** When set, the un-match modal is open for this match — shows the
   *  entries inside and lets the user remove some or all of them. */
  const [unmatchModalMatchId, setUnmatchModalMatchId] = useState<string | null>(null);
  /** When true, the Move-entries-to-another-account modal is open. */
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  /** When set, the bank-rec detail modal is open for this import id —
   *  triggered by clicking the green tick on a reconciled ledger row.
   *  Modal opens read-only with a Reopen button (legacy detail modal
   *  enforces period-lock + newer-rec guards on reopen). */
  const [recDetailImportId, setRecDetailImportId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoadingEntries(true);
    setEntriesError('');
    setSelectedSplitIds(new Set());
    try {
      // Translate the tab into the entries-endpoint params. The endpoint
      // supports status=open|all + optional date_from/date_to.
      const params = new URLSearchParams();
      switch (statusFilter) {
        case 'reconcile':
        case 'history':
          // Reconcile / History need every entry on the account so the
          // legacy detail modal can render any rec correctly.
          params.set('status', 'all');
          break;
        case 'previousYears':
          params.set('status', 'all');
          if (fyStartIso) params.set('date_to', addDaysIso(fyStartIso, -1));
          break;
        case 'currentYear':
          params.set('status', 'all');
          if (fyStartIso) params.set('date_from', fyStartIso);
          if (fyEndIso)   params.set('date_to',   fyEndIso);
          break;
        case 'futureYears':
          params.set('status', 'all');
          if (fyEndIso) params.set('date_from', addDaysIso(fyEndIso, 1));
          break;
        case 'openAtYearEnd':
          params.set('status', 'open');
          if (fyStartIso) params.set('date_from', fyStartIso);
          if (fyEndIso)   params.set('date_to',   fyEndIso);
          break;
        case 'open':
          params.set('status', 'open');
          break;
        case 'all':
        default:
          params.set('status', 'all');
          break;
      }
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
  }, [bookId, selectedAccountId, statusFilter, fyStartIso, fyEndIso]);

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

  // Right-click context menu on an account row — VT-style: New / Properties /
  // Move / Delete / Set Up Ledgers. The hook owns the menu + every modal,
  // including the admin gating; we just hand it onChanged so we can refetch.
  const accountMenu = useAccountContextMenu({
    bookId,
    ledger,
    isAdmin,
    onChanged: () => { void loadAccounts(); void loadEntries(); },
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
  // Unified selection: clicking ANY row (matched or unmatched) toggles its
  // membership in selectedSplitIds. Matched rows show a yellow circle on
  // the left; unmatched ones show the usual purple tick. When a selected
  // row sits in a match, its sibling entries get an amber tint so the user
  // can see what was originally grouped together.
  //
  // This lets the user freely combine matched + unmatched splits in one
  // selection — handy for re-matching: select an existing allocation +
  // additional entries that bring the new total to balance, click Match,
  // and the server unmatches the originals then bundles everything into a
  // single bigger match.
  /** Anchor row for Shift+click range selection. Updated on every plain or
   *  Ctrl+click; Shift+click uses it as the "from" end of the range. */
  const lastClickedSplitIdRef = useRef<string | null>(null);

  function handleRowClick(entry: Entry, ev?: React.MouseEvent) {
    const isShift = ev?.shiftKey === true;
    const isCtrlOrMeta = ev ? (ev.ctrlKey || ev.metaKey) : false;

    // Shift+click — select the range between the anchor and this row.
    // Match-aware AND rec-aware: any matched entry OR any rec-cleared entry
    // in the range pulls its siblings in too, so both "matches stay whole"
    // and "recs stay whole" invariants hold.
    if (isShift && lastClickedSplitIdRef.current) {
      const anchorIdx = entries.findIndex(e => e.split_id === lastClickedSplitIdRef.current);
      const currentIdx = entries.findIndex(e => e.split_id === entry.split_id);
      if (anchorIdx >= 0 && currentIdx >= 0) {
        const [from, to] = anchorIdx < currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
        const range = entries.slice(from, to + 1);
        // Auto-expand matched + rec'd rows so groups stay whole.
        const matchIdsInRange = new Set(range.map(e => e.match_id).filter(Boolean) as string[]);
        const recIdsInRange   = new Set(range.map(e => e.cleared_in_rec_id).filter(Boolean) as string[]);
        const siblings = entries.filter(e =>
          (e.match_id && matchIdsInRange.has(e.match_id)) ||
          (e.cleared_in_rec_id && recIdsInRange.has(e.cleared_in_rec_id)),
        );
        setSelectedSplitIds(prev => {
          const next = new Set(prev);
          for (const e of range) next.add(e.split_id);
          for (const e of siblings) next.add(e.split_id);
          return next;
        });
        lastClickedSplitIdRef.current = entry.split_id;
        return;
      }
    }

    // Plain click OR Ctrl/Cmd+click — both toggle this row (existing
    // behaviour). Ctrl is treated identically to a plain click because
    // every row click already adds-or-removes; there's no "replace
    // selection" mode to need a modifier for.
    void isCtrlOrMeta; // accepted; the modifier is informational here
    lastClickedSplitIdRef.current = entry.split_id;
    setSelectedSplitIds(prev => {
      const next = new Set(prev);
      if (entry.match_id) {
        // Clicking ANY entry in a match selects/deselects the whole match —
        // matches the user's mental model ("this allocation goes together").
        // We toggle based on whether the clicked entry is currently selected:
        // if it is, drop every sibling; if not, add every sibling.
        const siblings = entries.filter(e => e.match_id === entry.match_id);
        const isSelected = next.has(entry.split_id);
        for (const s of siblings) {
          if (isSelected) next.delete(s.split_id);
          else next.add(s.split_id);
        }
      } else if (entry.cleared_in_rec_id) {
        // Same whole-group behaviour for splits cleared in a bank rec —
        // clicking any one selects every other split ticked off in the same
        // reconciliation, so the orange highlight shows the full group at
        // a glance. Reconciled splits are read-only (no Match/Move/edit
        // until the rec is reopened) but we still want the visual grouping
        // for parity with matched rows.
        const siblings = entries.filter(e => e.cleared_in_rec_id === entry.cleared_in_rec_id);
        const isSelected = next.has(entry.split_id);
        for (const s of siblings) {
          if (isSelected) next.delete(s.split_id);
          else next.add(s.split_id);
        }
      } else {
        // Unmatched rows toggle individually as before.
        if (next.has(entry.split_id)) next.delete(entry.split_id);
        else next.add(entry.split_id);
      }
      return next;
    });
  }

  /** Ctrl+A / Cmd+A — select every entry currently visible in the table.
   *  Active only when this view has at least one entry loaded; otherwise
   *  the browser's native select-all keeps working. Prevents the default
   *  "select all text on the page" behaviour, which is rarely what the
   *  user wanted while interacting with the ledger. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        if (entries.length === 0) return;
        // Don't hijack Ctrl+A when the user is in a real input field —
        // they're likely selecting text, not entries.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setSelectedSplitIds(new Set(entries.map(en => en.split_id)));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries]);

  const selected = useMemo(() => entries.filter(e => selectedSplitIds.has(e.split_id)), [entries, selectedSplitIds]);
  const selDr = selected.reduce((s, e) => s + e.debit, 0);
  const selCr = selected.reduce((s, e) => s + e.credit, 0);
  const selDiff = +(selDr - selCr).toFixed(2);
  const balancedFull = selected.length >= 2 && Math.abs(selDiff) < 0.005;

  /** Match ids whose entries are currently selected — used to paint the
   *  amber sibling-highlight on rows that share the match. */
  const siblingHighlightMatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of selected) if (e.match_id) ids.add(e.match_id);
    return ids;
  }, [selected]);

  /** Rec ids whose entries are currently selected — paints the same amber
   *  sibling-highlight on every other split ticked off in the same rec.
   *  Visual parity with matched rows. */
  const siblingHighlightRecIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of selected) if (e.cleared_in_rec_id) ids.add(e.cleared_in_rec_id);
    return ids;
  }, [selected]);

  /** Whether the selection touches any already-matched splits — controls
   *  visibility of the Unmatch button and forces the Match flow to
   *  unmatch-then-rematch. */
  const selectedHasMatched = useMemo(() => selected.some(e => e.match_id), [selected]);

  /** Whether the selection touches any reconciled splits — disables Move
   *  and edit actions until the rec is reopened or deleted. */
  const selectedHasReconciled = useMemo(() => selected.some(e => e.cleared_in_rec_id), [selected]);

  /** Entries that the Move action will target. Just the selection now —
   *  the server expands matched siblings automatically. */
  const moveSplits = selected;
  const movePossible = moveSplits.length > 0;
  /** Action bar visible whenever there's any selection. */
  const actionBarVisible = selected.length > 0;

  /** Move the current selection (or the highlighted match) to a different
   *  account. The server auto-expands matched splits to keep matches
   *  single-account, so the user can click any one matched row + Move
   *  and the whole allocation travels together. */
  async function moveTo(targetAccountId: string) {
    const ids = moveSplits.map(s => s.split_id);
    if (ids.length === 0) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/move-splits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ split_ids: ids, target_account_id: targetAccountId }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error ?? 'Move failed');
    }
    setSelectedSplitIds(new Set());
    setMoveModalOpen(false);
    await Promise.all([loadEntries(), loadAccounts()]);
  }

  /** Unmatch — remove just the currently-selected matched entries from
   *  their matches. The server's remove-lines endpoint also auto-dissolves
   *  a match when fewer than 2 lines remain, so partial selections do the
   *  right thing without us having to count.
   *  Different from the green-tick flow (which opens a modal letting the
   *  user pick which entries to release): this is a single-click bulk
   *  unmatch of everything currently selected. */
  async function unmatchSelectedQuick() {
    // Bucket selected splits by their existing match_id.
    const groups = new Map<string, string[]>();
    for (const s of selected) {
      if (!s.match_id) continue;
      const list = groups.get(s.match_id) ?? [];
      list.push(s.split_id);
      groups.set(s.match_id, list);
    }
    if (groups.size === 0) return;
    setMatching(true);
    try {
      // Each match gets its own remove-lines call. Could parallelise but
      // these are tiny POSTs and usually only 1-3 matches are involved.
      for (const [matchId, splitIds] of groups) {
        const r = await fetch(`/api/bookkeeping/books/${bookId}/matches/${matchId}/remove-lines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split_ids: splitIds }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Un-match failed');
        }
      }
      setSelectedSplitIds(new Set());
      await Promise.all([loadEntries(), loadAccounts()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Un-match failed');
    } finally {
      setMatching(false);
    }
  }

  /** One-click "balance + match" — calls /auto-match which creates the
   *  contra entry (Write offs/discounts or Petty cash) and bundles the
   *  whole lot into a single allocation so they all disappear from the
   *  Open entries view together. */
  async function autoBalance(action: 'wof' | 'ctx') {
    if (selected.length === 0) return;
    setMatching(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/auto-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_ids: [...selectedSplitIds], action }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `${action.toUpperCase()} failed`);
      }
      setSelectedSplitIds(new Set());
      await Promise.all([loadEntries(), loadAccounts()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : `${action.toUpperCase()} failed`);
    } finally {
      setMatching(false);
    }
  }

  async function matchSelected(status: 'full' | 'partial') {
    if (selected.length < 2) return;
    setMatching(true);
    try {
      // If any selected entries are already in a match, release them
      // from those matches first so /matches POST won't reject them as
      // already-matched. The server auto-dissolves matches that drop to
      // <2 lines so we don't leave orphaned single-line matches lying
      // around. After this dance, every selected split is unmatched
      // and ready to be combined into the new merged match.
      const matchedBySplit = new Map<string, string[]>();
      for (const s of selected) {
        if (!s.match_id) continue;
        const list = matchedBySplit.get(s.match_id) ?? [];
        list.push(s.split_id);
        matchedBySplit.set(s.match_id, list);
      }
      for (const [matchId, splitIds] of matchedBySplit) {
        const r = await fetch(`/api/bookkeeping/books/${bookId}/matches/${matchId}/remove-lines`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split_ids: splitIds }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? 'Could not release prior match');
        }
      }

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
                {hideEmpty && (
                  <span className="text-slate-400">
                    {' '}({accounts.length - activeCount} hidden)
                  </span>
                )}
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
                const rowButton = (
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId(a.id)}
                    aria-label={a.inactive ? `${a.name} — locked` : a.name}
                    {...accountMenu.rowProps({
                      id: a.id, name: a.name, ledger: a.ledger,
                      account_type: a.account_type,
                      inactive: a.inactive, notes: a.notes,
                    })}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                      active
                        ? `bg-indigo-50 text-indigo-700${a.inactive ? ' italic' : ''}`
                        : a.inactive
                        ? 'hover:bg-slate-50 text-slate-400 italic'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="text-xs truncate flex-1">{a.name}</span>
                    <span className={`text-xs tabular-nums shrink-0 ml-2 ${
                      active
                        ? `font-semibold${a.inactive ? ' not-italic' : ''}`
                        : a.inactive ? 'text-slate-400 not-italic'
                        : nonZero ? 'text-slate-700' : 'text-slate-400'
                    }`}>
                      {fmt(a.balance)}
                    </span>
                  </button>
                );
                return (
                  <li key={a.id}>
                    {/* Inactive (locked) accounts get a hover tooltip explaining
                        why they're greyed out — saves users right-clicking to
                        check Properties. Active accounts don't need one.
                        Pass `block w-full` on the tooltip wrapper so the
                        button keeps its full-width layout (the wrapper is
                        otherwise inline-flex and would collapse the row). */}
                    {a.inactive
                      ? <Tooltip label={`${a.name} — locked`} className="block w-full">{rowButton}</Tooltip>
                      : rowButton}
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
            Pick a {(title.endsWith('s') ? title.slice(0, -1) : title).toLowerCase()} on the left to see their statement.
          </div>
        ) : (
          <>
            {/* Top instruction + selection summary — hidden in Reconcile /
                History modes since the workspace renders its own chrome. */}
            {statusFilter !== 'reconcile' && statusFilter !== 'history' && statusFilter !== 'depreciation' && (
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/40">
              {!actionBarVisible ? (
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
                    <Tooltip label="Clear the current selection">
                      <button
                        type="button"
                        onClick={() => setSelectedSplitIds(new Set())}
                        aria-label="Clear selection"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      >
                        <X size={11} /> Clear
                      </button>
                    </Tooltip>
                    {/* Unmatch — visible only when the selection touches at
                        least one matched split. One click releases just
                        those splits from their matches (whereas the
                        green-tick flow on a row opens a modal letting the
                        user pick which entries to release). The server
                        auto-dissolves matches that drop to <2 lines so we
                        don't have to count. */}
                    {selectedHasMatched && !isBankLedger && (
                      <Tooltip label="Release the selected matched entries from their match(es)">
                        <button
                          type="button"
                          onClick={() => void unmatchSelectedQuick()}
                          disabled={matching}
                          aria-label="Unmatch selected"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {matching ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />}
                          Unmatch
                        </button>
                      </Tooltip>
                    )}
                    {/* Move — works on either a tick-selection OR a
                        highlighted match. Always present whenever the
                        action bar is visible. Server expands the selection
                        to whole-match siblings so matches stay single-
                        account. */}
                    <Tooltip label={
                      selectedHasReconciled
                        ? 'Reconciled entries are locked — reopen or delete the rec to move them'
                        : 'Move the selected entries to another account'
                    }>
                      <button
                        type="button"
                        onClick={() => setMoveModalOpen(true)}
                        disabled={!movePossible || matching || selectedHasReconciled}
                        aria-label="Move to another account"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ArrowRightLeft size={11} /> Move
                      </button>
                    </Tooltip>
                    {/* Select all — picks every UNMATCHED entry in the
                        current view. Matched rows are deliberately excluded
                        because they can't be re-added to a fresh allocation.
                        Visible only once the user has selected at least one
                        row (the whole action bar is gated on selection). */}
                    {/* Select all — picks every UNMATCHED entry in the
                        current view. Matched rows stay untouched (the user
                        can always tick them individually if they want to
                        absorb them into a new match). */}
                    <Tooltip label="Select every unmatched entry in the current view">
                      <button
                        type="button"
                        onClick={() => setSelectedSplitIds(
                          new Set(entries.filter(e => !e.match_id).map(e => e.split_id)),
                        )}
                        aria-label="Select all unmatched entries"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                      >
                        <CheckSquare size={11} /> Select all
                      </button>
                    </Tooltip>
                    {/* WOF + CTX + Match — match-creating actions. Hidden
                        entirely on Bank ledgers because the bank workflow
                        is period-first reconciliation, not free-form
                        matching: every clearing action goes through the
                        Reconcile tab. Keep the action bar visible for
                        Bank so Move / Clear / Select-all still work
                        (Move is itself disabled when the selection
                        includes a reconciled split). */}
                    {!isBankLedger && (<>
                    <Tooltip label={
                      selectedHasMatched
                        ? 'Unmatch the selected entries first, then Write off the imbalance'
                        : balancedFull
                        ? 'Selection already balances — use Match instead'
                        : 'Write off the imbalance to Expenses: Write offs/discounts'
                    }>
                      <button
                        type="button"
                        onClick={() => void autoBalance('wof')}
                        disabled={selected.length === 0 || balancedFull || matching || selectedHasMatched}
                        aria-label="Write off"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {matching ? <Loader2 size={11} className="animate-spin" /> : null}
                        WOF
                      </button>
                    </Tooltip>
                    <Tooltip label={
                      selectedHasMatched
                        ? 'Unmatch the selected entries first, then post a cash transaction'
                        : balancedFull
                        ? 'Selection already balances — use Match instead'
                        : 'Post the imbalance against Bank: Petty cash'
                    }>
                      <button
                        type="button"
                        onClick={() => void autoBalance('ctx')}
                        disabled={selected.length === 0 || balancedFull || matching || selectedHasMatched}
                        aria-label="Cash transaction"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {matching ? <Loader2 size={11} className="animate-spin" /> : null}
                        CTX
                      </button>
                    </Tooltip>
                    <Tooltip label={balancedFull
                      ? 'Match these entries'
                      : 'Selected entries must balance (Dr = Cr) to fully match'}>
                      <button
                        type="button"
                        onClick={() => void matchSelected('full')}
                        disabled={!balancedFull || matching}
                        aria-label="Match selected"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {matching ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                        Match
                      </button>
                    </Tooltip>
                    </>)}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Reconcile sub-tab — period-first workspace entry point.
                Decides between empty-state (no active rec) and the resume
                card. Only mounted for Bank ledger + selected account. */}
            {statusFilter === 'depreciation' && isFaLedger ? (
              <div className="flex-1 overflow-y-auto min-h-0">
                <DepreciationTab
                  bookId={bookId}
                  ledger={ledger}
                  isAdmin={isAdmin}
                  onChanged={() => { void loadEntries(); void loadAccounts(); }}
                />
              </div>
            ) : statusFilter === 'reconcile' && ledger === 'Bank' && selectedAccountId ? (
              <div className="flex-1 overflow-hidden min-h-0">
                <BankReconcileTab
                  bookId={bookId}
                  accountId={selectedAccountId}
                  accountName={accountMeta?.name ?? ''}
                  entries={entries}
                  onReconciliationChanged={() => void loadEntries()}
                />
              </div>
            ) : statusFilter === 'history' && ledger === 'Bank' && selectedAccountId ? (
              <div className="flex-1 overflow-hidden min-h-0">
                <BankRecHistoryTab
                  bookId={bookId}
                  accountId={selectedAccountId}
                  accountName={accountMeta?.name ?? ''}
                  entries={entries}
                  onChanged={() => void loadEntries()}
                />
              </div>
            ) : (
            <>
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
                      const recCleared = e.cleared_in_rec_id !== null;
                      // Treat reconciled splits as a "group" for the same
                      // visual highlight rules used for matches.
                      const grouped = matched || recCleared;
                      const isSelected = selectedSplitIds.has(e.split_id);
                      // A row is "sibling-highlighted" when it belongs to
                      // a match OR a rec whose other splits are currently
                      // selected — gives the user visual confirmation of
                      // which group their click just pulled in.
                      const isSiblingHighlighted = !isSelected && (
                        (matched && e.match_id !== null && siblingHighlightMatchIds.has(e.match_id)) ||
                        (recCleared && e.cleared_in_rec_id !== null && siblingHighlightRecIds.has(e.cleared_in_rec_id))
                      );
                      return (
                        <tr
                          key={e.split_id}
                          onClick={(ev) => handleRowClick(e, ev)}
                          onContextMenu={ev => {
                            const t = ev.target as HTMLElement;
                            if (t.closest('input, textarea, select, [contenteditable]')) return;
                            // Reconciled rows are locked — no edit / move /
                            // delete via context menu either. Reopen or
                            // delete the rec to unlock.
                            if (recCleared) { ev.preventDefault(); return; }
                            ev.preventDefault();
                            // Use the rowProps' context-menu handler against
                            // the constructed txn stub.
                            const stub = entryAsTxnStub(e);
                            rowActions.rowProps(stub).onContextMenu(ev);
                          }}
                          className={`border-b border-slate-50 cursor-pointer transition-colors ${
                            isSelected && grouped
                              ? 'bg-amber-100 hover:bg-amber-200 ring-1 ring-amber-300'
                              : isSelected
                              ? 'bg-indigo-50 hover:bg-indigo-100'
                              : isSiblingHighlighted
                              ? 'bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-200'
                              : grouped
                              ? 'opacity-70 hover:bg-slate-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            {/* Left-column indicator:
                                  • Unmatched + selected → purple square + tick (existing)
                                  • Unmatched, not selected → empty square hint (existing)
                                  • Matched + selected → yellow filled circle (new — parity with
                                    the purple tick, makes selection state on matched rows visually obvious)
                                  • Matched, not selected → nothing (existing — keeps the
                                    column visually quiet for matched rows the user isn't acting on) */}
                            {/* Both states use a solid filled CIRCLE so the
                                visual model is consistent — amber for
                                matched (the colour of the row highlight),
                                violet for unmatched-but-ticked. Unselected
                                unmatched rows keep the empty hint circle. */}
                            {grouped ? (
                              isSelected && (
                                <span
                                  aria-hidden
                                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 border border-amber-600"
                                />
                              )
                            ) : (
                              <span
                                aria-hidden
                                className={`inline-flex items-center justify-center w-4 h-4 rounded-full border transition-colors ${
                                  isSelected
                                    ? 'bg-violet-600 border-violet-700'
                                    : 'bg-white border-slate-300 group-hover:border-slate-400'
                                }`}
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-slate-700 tabular-nums">{formatDateUk(e.date)}</td>
                          <td className="px-3 py-1.5 text-xs">
                            <TxnRefLink txn={entryAsTxnStub(e)} className="text-xs" />
                          </td>
                          <td className="px-3 py-1.5 max-w-[300px]">
                            <div className="text-slate-900 truncate">{e.details ?? ''}</div>
                            {e.entry_details && (
                              <div className="text-xs text-slate-500 italic truncate">{e.entry_details}</div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {e.match_status === 'full' && (
                              <Tooltip label="Fully matched — click to manage allocation">
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); if (e.match_id) setUnmatchModalMatchId(e.match_id); }}
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-emerald-700 hover:bg-emerald-100"
                                >
                                  <Check size={12} strokeWidth={3} />
                                </button>
                              </Tooltip>
                            )}
                            {e.match_status === 'partial' && (
                              <Tooltip label="Partially matched">
                                <span className="inline-flex items-center justify-center w-5 h-5 text-amber-700">
                                  <AlertCircle size={11} />
                                </span>
                              </Tooltip>
                            )}
                            {e.match_status === 'write_off' && (
                              <Tooltip label="Written off">
                                <span className="inline-flex items-center justify-center w-5 h-5 text-slate-500">
                                  <Unlink size={11} />
                                </span>
                              </Tooltip>
                            )}
                            {/* Bank-rec clearing — independent from match_status.
                                Only show when there's no match indicator already
                                (a split shouldn't really have both, but if it
                                does, the formal match wins visually). */}
                            {!e.match_status && e.cleared_in_rec_id && e.bank_rec_status === 'reconciled' && (
                              <Tooltip label={e.bank_rec_label ? `Reconciled in ${e.bank_rec_label} — click to open the rec` : 'Reconciled — click to open the rec'}>
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); if (e.cleared_in_rec_id) setRecDetailImportId(e.cleared_in_rec_id); }}
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-emerald-700 hover:bg-emerald-100"
                                >
                                  <Check size={12} strokeWidth={3} />
                                </button>
                              </Tooltip>
                            )}
                            {!e.match_status && e.cleared_in_rec_id && e.bank_rec_status && e.bank_rec_status !== 'reconciled' && e.bank_rec_status !== 'abandoned' && (
                              <Tooltip label={e.bank_rec_label ? `Cleared in ${e.bank_rec_label} (${e.bank_rec_status.replace('_',' ')}) — click to open` : 'Cleared in in-progress rec — click to open'}>
                                <button
                                  type="button"
                                  onClick={(ev) => { ev.stopPropagation(); if (e.cleared_in_rec_id) setRecDetailImportId(e.cleared_in_rec_id); }}
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-emerald-400 hover:bg-emerald-50"
                                >
                                  <Check size={12} strokeWidth={3} />
                                </button>
                              </Tooltip>
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

            </> /* close the non-reconcile branch */
            )}

            {/* Filter tabs at the bottom.
                  • Non-Bank ledgers: FY-aware six-tab strip when a year-end
                    is set; collapses to Open / All when it isn't.
                  • Bank ledgers get the same FY-aware strip PLUS two extra
                    bank-only tabs (Reconcile + History) on the far right
                    with a coloured fill so they read as a separate group
                    from the generic ledger views. */}
            <div className="border-t border-slate-200 px-3 py-2 flex items-center gap-2 bg-slate-50/40 flex-wrap">
              {(() => {
                // Shared "generic ledger" tabs — same set for Bank and
                // non-Bank, FY-aware. Bank gets Reconcile + History
                // appended below as a visually distinct group.
                const generic = !fyReady
                  ? [
                      { id: 'all'  as const,  label: 'All entries',  group: 'generic' as const },
                      { id: 'open' as const,  label: 'Open entries', group: 'generic' as const },
                    ]
                  : [
                      { id: 'previousYears' as const, label: 'Previous years',         group: 'generic' as const },
                      { id: 'currentYear'   as const, label: 'Current year',           group: 'generic' as const },
                      { id: 'futureYears'   as const, label: 'Future years',           group: 'generic' as const },
                      { id: 'all'           as const, label: 'All entries',            group: 'generic' as const },
                      { id: 'open'          as const, label: 'Open entries',           group: 'generic' as const },
                      { id: 'openAtYearEnd' as const, label: 'Open entries at year end', group: 'generic' as const },
                    ];
                if (isBankLedger) return [
                  ...generic,
                  { id: 'reconcile' as const, label: 'Reconcile', group: 'bank' as const },
                  { id: 'history'   as const, label: 'History',   group: 'bank' as const },
                ];
                if (isFaLedger) return [
                  ...generic,
                  { id: 'depreciation' as const, label: depreciationNoun(ledger), group: 'fa' as const },
                ];
                return generic;
              })().map((t, i, arr) => {
                const isActive = statusFilter === t.id;
                const isBankGroup = t.group === 'bank';
                const isFaGroup = t.group === 'fa';
                // Add a thin vertical divider before the first workflow tab
                // (bank Reconcile/History or the FA Depreciation tab) so the
                // visual split between "ledger view" tabs and "workflow" tabs
                // is obvious without extra chrome.
                const showDivider = (isBankGroup || isFaGroup) && (i === 0 || arr[i - 1].group === 'generic');
                return (
                  <span key={t.id} className="inline-flex items-center gap-2">
                    {showDivider && <span aria-hidden className="w-px h-4 bg-slate-200 mx-1" />}
                    <button
                      type="button"
                      onClick={() => setStatusFilter(t.id)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                        isActive
                          ? isBankGroup
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : isFaGroup
                            ? 'bg-violet-100 text-violet-800 border-violet-300'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : isBankGroup
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : isFaGroup
                            ? 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                            : 'text-slate-600 border-transparent hover:bg-slate-100 hover:text-slate-800'
                      }`}
                    >
                      {t.label}
                    </button>
                  </span>
                );
              })}
              <span className="ml-auto text-[10px] text-slate-400">
                {statusFilter === 'reconcile'
                  ? 'Period-first reconciliation workspace'
                  : statusFilter === 'history'
                  ? 'Completed & abandoned reconciliations'
                  : statusFilter === 'depreciation'
                  ? `${depreciationNoun(ledger)} schedule & posting`
                  : `${entries.length} ${statusFilter === 'open' || statusFilter === 'openAtYearEnd' ? 'open' : 'total'}`}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Bank-rec detail modal — opened by clicking the green tick on a
          reconciled (or in-progress) split. Read-only by default; the
          modal owns the Reopen button which respects period-lock + newer-
          rec guards. Refetches entries on change so a reopen / delete
          immediately reflects in the ledger (cleared_in_rec_id clears,
          rows fall back into Open). */}
      {recDetailImportId && selectedAccountId && (
        <BankRecDetailModal
          bookId={bookId}
          importId={recDetailImportId}
          accountId={selectedAccountId}
          accountName={accountMeta?.name ?? ''}
          entries={entries}
          onClose={() => setRecDetailImportId(null)}
          onChanged={() => { void loadEntries(); }}
        />
      )}

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
      {/* Account context menu — right-click on an account in the master list */}
      {accountMenu.menus}
      {/* Move entries dialog — VT-style two-pane ledger/account picker. */}
      {moveModalOpen && (
        <MoveEntriesModal
          bookId={bookId}
          selectionCount={moveSplits.length}
          selectionLabel={`${moveSplits.length} ${moveSplits.length === 1 ? 'selected entry' : 'selected entries'}`}
          currentAccountId={selectedAccountId}
          // Pass the source ledger so the modal opens with the same ledger
          // pre-selected — most moves stay in-ledger (supplier → supplier).
          currentLedger={ledger}
          onClose={() => setMoveModalOpen(false)}
          onMove={moveTo}
        />
      )}
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
                    <span className="text-xs text-slate-900 flex-1 truncate">
                      {e.details ?? ''}
                      {e.entry_details && (
                        <span className="text-slate-500 italic"> · {e.entry_details}</span>
                      )}
                    </span>
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
