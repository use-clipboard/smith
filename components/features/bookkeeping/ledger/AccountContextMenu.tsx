'use client';

/**
 * AccountContextMenu — VT-style right-click menu on a ledger account row, plus
 * the modals it can open.
 *
 *   • New Account     — quick-create within the current ledger
 *   • Properties      — rename + notes (always), inactive toggle (admin only)
 *   • Move            — admin-only, move to another ledger (with confirm)
 *   • Delete          — admin-only, blocked if any entries exist
 *   • Set Up Ledgers  — admin-only, rename existing ledgers
 *
 * The menu itself reuses RowActionsMenu (portal + viewport clamp + outside-
 * click close) so it behaves identically to the transaction row menu users
 * already know.
 */

import { useEffect, useState } from 'react';
import {
  FilePlus2, Settings2, ArrowRightLeft, Trash2, FolderTree, Loader2, X, AlertTriangle,
} from 'lucide-react';
import RowActionsMenu, { type ActionMenuItem, type AnchorPosition } from '../transactions/RowActionsMenu';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountForMenu {
  id: string;
  name: string;
  ledger: string | null;
  account_type: string;
  notes?: string | null;
  inactive?: boolean;
}

interface LedgerSummary { name: string; account_count: number }

const ACCOUNT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'asset',     label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity',    label: 'Equity' },
  { value: 'income',    label: 'Income' },
  { value: 'expense',   label: 'Expense' },
];

// ── Hook: returns menu + modals to render, plus an opener ────────────────────

interface UseAccountContextMenuOptions {
  bookId: string;
  ledger: string;          // ledger this view is showing — drives "New" default
  isAdmin: boolean;
  /** Called whenever anything in the COA changes so the parent can refetch. */
  onChanged: () => void;
}

export function useAccountContextMenu({ bookId, ledger, isAdmin, onChanged }: UseAccountContextMenuOptions) {
  const [menuAccount, setMenuAccount] = useState<AccountForMenu | null>(null);
  const [menuAnchor,  setMenuAnchor]  = useState<AnchorPosition | null>(null);

  // Modal state — only one open at a time.
  const [newOpen,        setNewOpen]        = useState(false);
  const [propertiesAcc,  setPropertiesAcc]  = useState<AccountForMenu | null>(null);
  const [moveAcc,        setMoveAcc]        = useState<AccountForMenu | null>(null);
  const [deleteAcc,      setDeleteAcc]      = useState<AccountForMenu | null>(null);
  const [setupOpen,      setSetupOpen]      = useState(false);

  /** Spread onto each account row to wire up the right-click trigger. */
  function rowProps(account: AccountForMenu) {
    return {
      onContextMenu: (ev: React.MouseEvent) => {
        ev.preventDefault();
        setMenuAccount(account);
        setMenuAnchor({ type: 'cursor' as const, x: ev.clientX, y: ev.clientY });
      },
    };
  }

  const items: ActionMenuItem[] = menuAccount ? [
    {
      id: 'new',
      label: 'New account…',
      icon: FilePlus2,
      onClick: () => setNewOpen(true),
    },
    {
      id: 'properties',
      label: 'Properties…',
      icon: Settings2,
      onClick: () => setPropertiesAcc(menuAccount),
    },
    {
      id: 'move',
      label: 'Move to ledger…',
      icon: ArrowRightLeft,
      disabled: !isAdmin,
      onClick: () => setMoveAcc(menuAccount),
    },
    {
      id: 'setup',
      label: 'Set up ledgers…',
      icon: FolderTree,
      disabled: !isAdmin,
      onClick: () => setSetupOpen(true),
    },
    {
      id: 'delete',
      label: 'Delete account…',
      icon: Trash2,
      danger: true,
      disabled: !isAdmin,
      onClick: () => setDeleteAcc(menuAccount),
    },
  ] : [];

  const menus = (
    <>
      <RowActionsMenu
        open={menuAccount !== null}
        anchor={menuAnchor}
        items={items}
        onClose={() => { setMenuAccount(null); setMenuAnchor(null); }}
        title={menuAccount?.name}
      />
      {newOpen && (
        <NewAccountModal
          bookId={bookId}
          defaultLedger={ledger}
          onClose={() => setNewOpen(false)}
          onCreated={() => { setNewOpen(false); onChanged(); }}
        />
      )}
      {propertiesAcc && (
        <AccountPropertiesModal
          bookId={bookId}
          account={propertiesAcc}
          isAdmin={isAdmin}
          onClose={() => setPropertiesAcc(null)}
          onSaved={() => { setPropertiesAcc(null); onChanged(); }}
        />
      )}
      {moveAcc && (
        <MoveAccountModal
          bookId={bookId}
          account={moveAcc}
          onClose={() => setMoveAcc(null)}
          onMoved={() => { setMoveAcc(null); onChanged(); }}
        />
      )}
      {deleteAcc && (
        <DeleteAccountModal
          bookId={bookId}
          account={deleteAcc}
          onClose={() => setDeleteAcc(null)}
          onDeleted={() => { setDeleteAcc(null); onChanged(); }}
        />
      )}
      {setupOpen && (
        <LedgerSetupModal
          bookId={bookId}
          onClose={() => setSetupOpen(false)}
          onChanged={() => { onChanged(); }}
        />
      )}
    </>
  );

  return { rowProps, menus };
}

// ── Shared modal shell ───────────────────────────────────────────────────────

function ModalShell({
  title, subtitle, onClose, children, width = 'max-w-md',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  // Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl w-full ${width} max-h-[90vh] overflow-hidden flex flex-col`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
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
        {children}
      </div>
    </div>
  );
}

// ── New Account ──────────────────────────────────────────────────────────────

function NewAccountModal({
  bookId, defaultLedger, onClose, onCreated,
}: {
  bookId: string;
  defaultLedger: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [ledger, setLedger] = useState(defaultLedger);
  const [accountType, setAccountType] = useState<string>('expense');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ledger: ledger.trim(), account_type: accountType }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to create account');
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New account" subtitle={`Add a new account to ${defaultLedger}.`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <Field label="Account name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            placeholder="e.g. Subscriptions"
            className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          />
        </Field>
        <Field label="Ledger">
          <input
            type="text"
            value={ledger}
            onChange={e => setLedger(e.target.value)}
            className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          />
        </Field>
        <Field label="Account type">
          <select
            value={accountType}
            onChange={e => setAccountType(e.target.value)}
            className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          >
            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>}
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} submitLabel="Create" busy={saving} disabled={!name.trim() || !ledger.trim()} />
    </ModalShell>
  );
}

// ── Properties ───────────────────────────────────────────────────────────────

function AccountPropertiesModal({
  bookId, account, isAdmin, onClose, onSaved,
}: {
  bookId: string;
  account: AccountForMenu;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name,     setName]     = useState(account.name);
  const [notes,    setNotes]    = useState(account.notes ?? '');
  const [inactive, setInactive] = useState(Boolean(account.inactive));
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  async function submit() {
    setSaving(true); setError('');
    try {
      const patch: Record<string, unknown> = {};
      if (name.trim() !== account.name) patch.name = name.trim();
      if ((notes || null) !== (account.notes ?? null)) patch.notes = notes.trim() || null;
      if (inactive !== Boolean(account.inactive)) patch.inactive = inactive;
      if (Object.keys(patch).length === 0) { onClose(); return; }

      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to update account');
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Account properties" subtitle={`${account.ledger ?? ''} · ${account.account_type}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <Field label="Account name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          />
        </Field>
        <Field label="Notes" hint="Visible only in this dialog.">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="What this account is for, what should/shouldn't be posted to it…"
            className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 resize-none"
          />
        </Field>
        <div>
          <label className={`flex items-start gap-2 ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              checked={inactive}
              disabled={!isAdmin}
              onChange={e => setInactive(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Don’t allow new entries</span>
              <span className="block text-[11px] text-slate-500">
                Existing entries stay visible. The account is hidden from the account picker so nothing new can be posted to it.
                {!isAdmin && ' (Admin only)'}
              </span>
            </span>
          </label>
        </div>
        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>}
      </div>
      <ModalFooter onClose={onClose} onSubmit={submit} submitLabel="Save" busy={saving} />
    </ModalShell>
  );
}

// ── Move ─────────────────────────────────────────────────────────────────────

function MoveAccountModal({
  bookId, account, onClose, onMoved,
}: {
  bookId: string;
  account: AccountForMenu;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [ledgers, setLedgers] = useState<LedgerSummary[]>([]);
  const [destination, setDestination] = useState<string>('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/bookkeeping/books/${bookId}/ledgers`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setLedgers((d?.ledgers ?? []).filter((l: LedgerSummary) => l.name !== account.ledger)))
      .catch(() => {});
  }, [bookId, account.ledger]);

  const target = creatingNew ? newLedgerName.trim() : destination;

  async function submit() {
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger: target }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to move account');
      }
      onMoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move account');
    } finally {
      setSaving(false);
    }
  }

  if (confirming) {
    return (
      <ModalShell title="Move this account?" onClose={onClose}>
        <div className="p-4 space-y-2 text-sm text-slate-700">
          <p>
            Move <span className="font-semibold text-slate-900">{account.name}</span> from{' '}
            <span className="font-semibold text-slate-900">{account.ledger ?? '(no ledger)'}</span> to{' '}
            <span className="font-semibold text-indigo-700">{target}</span>?
          </p>
          <p className="text-[12px] text-slate-500">
            All entries posted against this account move with it. Report groupings update on the next refresh.
          </p>
          {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>}
        </div>
        <ModalFooter
          onClose={() => setConfirming(false)}
          closeLabel="Back"
          onSubmit={submit}
          submitLabel="Move"
          busy={saving}
        />
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Move account to another ledger" subtitle={`Currently in ${account.ledger ?? '(no ledger)'}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        {!creatingNew ? (
          <Field label="Destination ledger">
            <select
              value={destination}
              onChange={e => setDestination(e.target.value)}
              autoFocus
              className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            >
              <option value="">Pick a ledger…</option>
              {ledgers.map(l => (
                <option key={l.name} value={l.name}>{l.name} ({l.account_count})</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCreatingNew(true)}
              className="mt-2 text-xs text-indigo-700 hover:underline"
            >
              + Create a new ledger instead
            </button>
          </Field>
        ) : (
          <Field label="New ledger name">
            <input
              type="text"
              value={newLedgerName}
              onChange={e => setNewLedgerName(e.target.value)}
              autoFocus
              placeholder="e.g. Marketing"
              className="w-full text-sm px-2.5 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            />
            <button
              type="button"
              onClick={() => { setCreatingNew(false); setNewLedgerName(''); }}
              className="mt-2 text-xs text-slate-500 hover:underline"
            >
              ← Pick from existing ledgers
            </button>
          </Field>
        )}
      </div>
      <ModalFooter
        onClose={onClose}
        onSubmit={() => setConfirming(true)}
        submitLabel="Continue"
        disabled={!target}
      />
    </ModalShell>
  );
}

// ── Delete ───────────────────────────────────────────────────────────────────

function DeleteAccountModal({
  bookId, account, onClose, onDeleted,
}: {
  bookId: string;
  account: AccountForMenu;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function submit() {
    setBusy(true); setError(''); setBlockReason(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts/${account.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // The route returns error='has_entries' with a friendlier message.
        if (d?.error === 'has_entries' && d?.message) {
          setBlockReason(d.message);
          return;
        }
        throw new Error(d.error ?? 'Failed to delete account');
      }
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Delete this account?" onClose={onClose}>
      <div className="p-4 space-y-3 text-sm text-slate-700">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={14} />
          </div>
          <div>
            <p>
              You’re about to delete <span className="font-semibold text-slate-900">{account.name}</span>
              {account.ledger && <> from <span className="font-semibold text-slate-900">{account.ledger}</span></>}.
            </p>
            <p className="text-[12px] text-slate-500 mt-1">
              This is permanent. Accounts with any posted entries cannot be deleted — mark them inactive instead.
            </p>
          </div>
        </div>
        {blockReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            {blockReason}
          </div>
        )}
        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>}
        {!blockReason && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
            <span className="text-[12px] text-slate-700">I understand this can’t be undone.</span>
          </label>
        )}
      </div>
      <ModalFooter
        onClose={onClose}
        onSubmit={submit}
        submitLabel="Delete"
        submitTone="danger"
        busy={busy}
        disabled={Boolean(blockReason) || !confirmed}
      />
    </ModalShell>
  );
}

// ── Set Up Ledgers ───────────────────────────────────────────────────────────

function LedgerSetupModal({
  bookId, onClose, onChanged,
}: {
  bookId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [ledgers, setLedgers] = useState<LedgerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/ledgers`);
      const d = r.ok ? await r.json() : { ledgers: [] };
      setLedgers(d.ledgers ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function commitRename() {
    if (!editing) return;
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/ledgers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: editing.from, to: editing.to.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to rename ledger');
      }
      setEditing(null);
      onChanged();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename ledger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Set up ledgers"
      subtitle="Rename any ledger — the change applies to every account in it. To add a new ledger, create or move an account into it."
      onClose={onClose}
      width="max-w-lg"
    >
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin mr-1.5" /> Loading ledgers…
          </div>
        ) : ledgers.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-4 text-center">No ledgers yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {ledgers.map(l => {
              const isEditing = editing?.from === l.name;
              return (
                <li key={l.name} className="px-3 py-2 flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={editing.to}
                        onChange={e => setEditing({ from: editing.from, to: e.target.value })}
                        autoFocus
                        className="flex-1 text-sm px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                        onKeyDown={e => { if (e.key === 'Enter') void commitRename(); if (e.key === 'Escape') setEditing(null); }}
                      />
                      <button
                        type="button"
                        onClick={commitRename}
                        disabled={saving || !editing.to.trim() || editing.to.trim() === editing.from}
                        className="text-xs px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {saving ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={saving}
                        className="text-xs px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-slate-800">{l.name}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{l.account_count} account{l.account_count === 1 ? '' : 's'}</span>
                      <button
                        type="button"
                        onClick={() => setEditing({ from: l.name, to: l.name })}
                        className="text-xs text-indigo-700 hover:underline ml-2"
                      >
                        Rename
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>}
      </div>
      <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-end bg-slate-50/40">
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
}

// ── Form bits ────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[11px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

function ModalFooter({
  onClose, closeLabel = 'Cancel', onSubmit, submitLabel, busy, disabled, submitTone = 'primary',
}: {
  onClose: () => void;
  closeLabel?: string;
  onSubmit: () => void;
  submitLabel: string;
  busy?: boolean;
  disabled?: boolean;
  submitTone?: 'primary' | 'danger';
}) {
  const submitClass = submitTone === 'danger'
    ? 'bg-rose-600 hover:bg-rose-700'
    : 'bg-indigo-600 hover:bg-indigo-700';
  return (
    <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2 bg-slate-50/40">
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
      >
        {closeLabel}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || disabled}
        className={`text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ${submitClass}`}
      >
        {busy && <Loader2 size={11} className="animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}
