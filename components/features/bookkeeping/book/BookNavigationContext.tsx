'use client';

/**
 * BookNavigationContext — shared navigation handlers for the bookkeeping
 * workspace. Provided once at BookView level and consumed by ANY descendant
 * via `useBookNavigation()`.
 *
 * ── Coding rule ─────────────────────────────────────────────────────────────
 * Every transaction reference, account name and ledger name shown anywhere
 * in the bookkeeping tool MUST be clickable. Click → open the matching view:
 *
 *   • Transaction reference (e.g. PAY 000001) → opens the type-list tab for
 *     that type, with the transaction pre-selected.
 *   • Account ("Bank: Current account", "Suppliers: Suspense", …) → opens
 *     the ledger drill-down for that specific account.
 *   • Ledger ("Bank", "Suppliers", "Expenses", …) → opens that ledger's
 *     master view (the fixed Customers / Suppliers tabs, or a generic
 *     AccountsLedgerView dynamic tab for other ledgers).
 *
 * Use the helper components below (<TxnRefLink>, <AccountLink>, <LedgerLink>)
 * rather than rolling your own spans — they fall back to a plain span when
 * no nav context is mounted (e.g. unit tests, lone Storybook stories) so
 * they're safe to drop in anywhere.
 */

import { createContext, useContext } from 'react';
import type { TransactionType } from '@/types/bookkeeping';

export interface BookNavigation {
  /** Opens the per-account ledger drill-down. */
  openAccount: (account: { id: string; name: string; ledger: string | null }) => void;
  /** Opens the transaction-type list view, optionally pre-selecting a row. */
  openTypeList: (type: TransactionType, txnId?: string) => void;
  /** Opens the ledger-level view (Customers / Suppliers / Bank / etc.).
   *  Falls back to opening the first non-empty account in that ledger. */
  openLedger: (ledger: string) => void;
}

const BookNavigationContext = createContext<BookNavigation | null>(null);

export function BookNavigationProvider({
  value, children,
}: { value: BookNavigation; children: React.ReactNode }) {
  return (
    <BookNavigationContext.Provider value={value}>
      {children}
    </BookNavigationContext.Provider>
  );
}

export function useBookNavigation(): BookNavigation | null {
  return useContext(BookNavigationContext);
}

// ── Link primitives ──────────────────────────────────────────────────────────
// Drop-in replacements for the inline `<span class="text-indigo-700">…</span>`
// pattern used historically. If no nav is mounted, they render as plain text
// styled the same way — so behaviour degrades gracefully.

interface TxnLike { id: string; type: TransactionType; ref_no: string; }

export function TxnRefLink({ txn, className }: { txn: TxnLike; className?: string }) {
  const nav = useBookNavigation();
  const cls = `text-indigo-700 font-mono ${className ?? ''}`;
  if (!nav) return <span className={cls}>{txn.ref_no}</span>;
  return (
    <button
      type="button"
      onClick={() => nav.openTypeList(txn.type, txn.id)}
      className={`${cls} hover:underline hover:text-indigo-900 transition-colors`}
    >
      {txn.ref_no}
    </button>
  );
}

interface AccountLike { id: string; name: string; ledger: string | null; }

/**
 * Renders an account as `Ledger: Name` (or just `Name` when ledger is null).
 * Clickable when nav is mounted; plain span otherwise.
 */
export function AccountLink({
  account, className, showLedger = true,
}: { account: AccountLike | null | undefined; className?: string; showLedger?: boolean }) {
  const nav = useBookNavigation();
  if (!account) return <span></span>;
  const label = showLedger && account.ledger ? `${account.ledger}: ${account.name}` : account.name;
  const cls = `text-indigo-700 ${className ?? ''}`;
  if (!nav) return <span className={cls}>{label}</span>;
  return (
    <button
      type="button"
      onClick={() => nav.openAccount(account)}
      className={`${cls} hover:underline hover:text-indigo-900 text-left transition-colors`}
    >
      {label}
    </button>
  );
}

/**
 * Renders a bare ledger name. Click → opens that ledger's master view.
 * Falls back to a plain span when no nav context is mounted.
 */
export function LedgerLink({
  ledger, className, children,
}: { ledger: string; className?: string; children?: React.ReactNode }) {
  const nav = useBookNavigation();
  const cls = `text-indigo-700 ${className ?? ''}`;
  if (!nav) return <span className={cls}>{children ?? ledger}</span>;
  return (
    <button
      type="button"
      onClick={() => nav.openLedger(ledger)}
      className={`${cls} hover:underline hover:text-indigo-900 text-left transition-colors`}
    >
      {children ?? ledger}
    </button>
  );
}
