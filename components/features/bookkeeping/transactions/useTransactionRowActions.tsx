'use client';

/**
 * useTransactionRowActions — single hook each transaction list mounts to
 * get the per-row action behaviour for free. Returns:
 *
 *   • rowProps(txn)  — props to spread on a row element. Wires up the
 *                       right-click context menu, the `group` class needed
 *                       for hover-reveal, and the `onContextMenu` handler.
 *   • renderActions(txn) — call inside the last cell of each row to render
 *                       the hover-revealed quick-action icons + ⋯ menu.
 *   • menus           — the actual modals/drawers/menu. Render this once
 *                       outside the table loop.
 *
 * Usage in a list view:
 *
 *   const { rowProps, renderActions, menus } = useTransactionRowActions({
 *     bookId, vatRegistered: book.vat_registered, vatLockDate: book.vat_lock_date,
 *     onChanged: refreshList,
 *   });
 *   return (
 *     <>
 *       <table>
 *         {rows.map(t => (
 *           <tr key={t.id} {...rowProps(t)}>
 *             <td>…</td>
 *             <td className="w-12">{renderActions(t)}</td>
 *           </tr>
 *         ))}
 *       </table>
 *       {menus}
 *     </>
 *   );
 */

import { useCallback, useState } from 'react';
import {
  Pencil, Copy as CopyIcon, Trash2, MoreHorizontal,
  Clipboard, History, ArrowRightLeft, Paperclip,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import RowActionsMenu, { type ActionMenuItem, type AnchorPosition } from './RowActionsMenu';
import TransactionEditModal from './TransactionEditModal';
import AuditHistoryDrawer from './AuditHistoryDrawer';
import ChangeTypeModal from './ChangeTypeModal';
import { useBookNavigation } from '../book/BookNavigationContext';
import type { Transaction } from '@/types/bookkeeping';

interface Options {
  bookId: string;
  vatRegistered: boolean;
  vatLockDate: string | null;
  /** Called after a successful edit / duplicate / delete so the list can
   *  refresh. */
  onChanged: () => void;
}

export function useTransactionRowActions({
  bookId, vatRegistered, vatLockDate, onChanged,
}: Options) {
  // After any change, refresh THIS list (the caller's onChanged) AND bump the
  // book-wide data version so every other mounted view (balances, reports,
  // other ledgers) refreshes too — an edit from one surface must never leave
  // another surface showing a stale figure.
  const nav = useBookNavigation();
  const notifyChanged = useCallback(() => {
    onChanged();
    nav?.bumpDataVersion?.();
  }, [onChanged, nav]);

  // Open menu state — which row + where on screen
  const [menuTxn, setMenuTxn] = useState<Transaction | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<AnchorPosition | null>(null);

  // Modals / drawers
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [editMode, setEditMode] = useState<'edit' | 'duplicate'>('edit');
  const [auditTxn, setAuditTxn] = useState<Transaction | null>(null);
  const [changeTypeTxn, setChangeTypeTxn] = useState<Transaction | null>(null);

  // Brief toast for copy-ref
  const [toast, setToast] = useState<string | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleEdit = useCallback((t: Transaction) => {
    setEditMode('edit');
    setEditingTxn(t);
  }, []);

  const handleDuplicate = useCallback((t: Transaction) => {
    setEditMode('duplicate');
    setEditingTxn(t);
  }, []);

  const handleDelete = useCallback(async (t: Transaction) => {
    const ok = confirm(`Delete ${t.ref_no}? The reference number will not be reused.`);
    if (!ok) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${t.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? 'Delete failed');
      return;
    }
    notifyChanged();
  }, [bookId, notifyChanged]);

  const handleCopyRef = useCallback((t: Transaction) => {
    void navigator.clipboard?.writeText(t.ref_no);
    flashToast(`${t.ref_no} copied`);
  }, [flashToast]);

  const handleAudit = useCallback((t: Transaction) => {
    setAuditTxn(t);
  }, []);

  const handleChangeType = useCallback((t: Transaction) => {
    setChangeTypeTxn(t);
  }, []);

  // ── Menu items builder ────────────────────────────────────────────────────
  function buildMenuItems(t: Transaction): ActionMenuItem[] {
    return [
      { id: 'edit',         label: 'Edit',              icon: Pencil,         shortcut: 'Enter', onClick: () => handleEdit(t) },
      { id: 'duplicate',    label: 'Duplicate',         icon: CopyIcon,       shortcut: '⌘D',    onClick: () => handleDuplicate(t) },
      { id: 'change_type',  label: 'Change type…',      icon: ArrowRightLeft,                    onClick: () => handleChangeType(t) },
      { id: 'copy',         label: 'Copy reference',    icon: Clipboard,      shortcut: '⌘C',    onClick: () => handleCopyRef(t) },
      { id: 'audit',        label: 'Audit history',     icon: History,                           onClick: () => handleAudit(t) },
      { id: 'delete',       label: 'Delete',            icon: Trash2,         shortcut: 'Del',   danger: true, onClick: () => void handleDelete(t) },
    ];
  }

  // ── rowProps + renderActions ──────────────────────────────────────────────
  const rowProps = useCallback((t: Transaction) => ({
    className: 'group',
    onContextMenu: (e: React.MouseEvent) => {
      // Allow the default browser menu in inputs / textareas (for copy/paste).
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      setMenuTxn(t);
      setMenuAnchor({ type: 'cursor', x: e.clientX, y: e.clientY });
    },
  }), []);

  const renderActions = useCallback((t: Transaction) => (
    <div className="inline-flex items-center gap-0.5">
      {t.source_doc_url && (
        <Tooltip label={t.source_doc_name ? `Source document — ${t.source_doc_name}` : 'Source document'}>
          <a
            href={t.source_doc_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            aria-label={`Open source document for ${t.ref_no}`}
            className="p-1 rounded text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50"
          >
            <Paperclip size={12} />
          </a>
        </Tooltip>
      )}
      <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); handleEdit(t); }}
        aria-label={`Edit ${t.ref_no}`}
        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); handleDuplicate(t); }}
        aria-label={`Duplicate ${t.ref_no}`}
        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
      >
        <CopyIcon size={12} />
      </button>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); void handleDelete(t); }}
        aria-label={`Delete ${t.ref_no}`}
        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
      >
        <Trash2 size={12} />
      </button>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenuTxn(t);
          setMenuAnchor({ type: 'rect', rect });
        }}
        aria-label={`More actions for ${t.ref_no}`}
        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
      >
        <MoreHorizontal size={12} />
      </button>
      </span>
    </div>
  ), [handleEdit, handleDuplicate, handleDelete]);

  // ── Renderable bundle ─────────────────────────────────────────────────────
  const menus = (
    <>
      <RowActionsMenu
        open={menuTxn !== null && menuAnchor !== null}
        anchor={menuAnchor}
        items={menuTxn ? buildMenuItems(menuTxn) : []}
        title={menuTxn?.ref_no}
        onClose={() => { setMenuTxn(null); setMenuAnchor(null); }}
      />
      {editingTxn && (
        <TransactionEditModal
          open
          mode={editMode}
          bookId={bookId}
          txId={editingTxn.id}
          seed={editingTxn}
          vatRegistered={vatRegistered}
          vatLockDate={vatLockDate}
          onClose={() => setEditingTxn(null)}
          onSaved={() => { setEditingTxn(null); notifyChanged(); }}
        />
      )}
      <AuditHistoryDrawer
        bookId={bookId}
        txId={auditTxn?.id ?? null}
        refNo={auditTxn?.ref_no}
        onClose={() => setAuditTxn(null)}
      />
      {changeTypeTxn && (
        <ChangeTypeModal
          open
          bookId={bookId}
          txn={changeTypeTxn}
          onClose={() => setChangeTypeTxn(null)}
          onSaved={() => { setChangeTypeTxn(null); notifyChanged(); }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1600] px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </>
  );

  return { rowProps, renderActions, menus };
}
