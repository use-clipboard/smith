'use client';

/**
 * BookSettingsDrawer — slide-out panel from the right that houses the bits
 * that used to bloat the main BookView: Book details form + Admin actions.
 *
 * Keeps the working canvas clean. Reachable via the ⚙ button in the book
 * header. Doesn't change the URL — purely client state.
 */

import { useEffect, useState } from 'react';
import {
  X, Save, Loader2, Check, Lock, Unlock, Archive as ArchiveIcon, AlertTriangle,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import {
  VAT_SCHEME_OPTIONS, BASE_CURRENCY_OPTIONS,
  type Book, type VatScheme,
} from '@/types/bookkeeping';

interface Props {
  open: boolean;
  onClose: () => void;
  book: Book;
  isAdmin: boolean;
  /** Replaces the in-memory book after a successful update so the parent UI re-renders. */
  onUpdated: (next: Book) => void;
}

export default function BookSettingsDrawer({ open, onClose, book, isAdmin, onUpdated }: Props) {
  const lockedForMe = book.admin_locked && !isAdmin;

  const [name, setName]                   = useState(book.name);
  const [baseCurrency, setBaseCurrency]   = useState(book.base_currency);
  const [vatRegistered, setVatRegistered] = useState(book.vat_registered);
  const [vatScheme, setVatScheme]         = useState<VatScheme>((book.vat_scheme ?? 'standard') as VatScheme);
  const [vatNumber, setVatNumber]         = useState(book.vat_number ?? '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  // Reset form state whenever the drawer (re)opens or the book changes.
  useEffect(() => {
    if (!open) return;
    setName(book.name);
    setBaseCurrency(book.base_currency);
    setVatRegistered(book.vat_registered);
    setVatScheme((book.vat_scheme ?? 'standard') as VatScheme);
    setVatNumber(book.vat_number ?? '');
    setError('');
    setSaved(false);
  }, [open, book]);

  async function patch(payload: Record<string, unknown>) {
    const r = await fetch(`/api/bookkeeping/books/${book.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error ?? 'Update failed');
    }
    return (await r.json()).book as Book;
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const next = await patch({
        name: name.trim(),
        base_currency: baseCurrency,
        vat_registered: vatRegistered,
        vat_scheme: vatRegistered ? vatScheme : null,
        vat_number: vatRegistered ? (vatNumber.trim() || null) : null,
      });
      onUpdated(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdminLock() {
    if (!isAdmin) return;
    const willLock = !book.admin_locked;
    if (!confirm(`${willLock ? 'Lock' : 'Unlock'} this book? ${willLock ? 'Only admins will be able to edit it.' : 'All users will be able to edit it again.'}`)) return;
    try {
      const next = await patch({ admin_locked: willLock });
      onUpdated(next);
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : ''}`);
    }
  }

  async function toggleArchive() {
    if (!isAdmin) return;
    const willArchive = !book.archived;
    if (!confirm(`${willArchive ? 'Archive' : 'Restore'} "${book.name}"?`)) return;
    try {
      const next = await patch({ archived: willArchive });
      onUpdated(next);
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : ''}`);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1100] flex" aria-modal="true" role="dialog">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="flex-1 bg-black/30 backdrop-blur-[1px]"
      />
      {/* Drawer */}
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Book settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {lockedForMe && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
              <Lock size={11} />
              Locked by an admin — read-only for you.
            </div>
          )}

          <fieldset disabled={lockedForMe} className={lockedForMe ? 'opacity-60 space-y-4' : 'space-y-4'}>
            <div>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Details</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Book name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Base currency</label>
                  <select
                    value={baseCurrency}
                    onChange={e => setBaseCurrency(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {BASE_CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={vatRegistered}
                    onChange={e => setVatRegistered(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  VAT registered
                </label>
                {vatRegistered && (
                  <div className="space-y-3 p-3 rounded bg-gray-50 border border-gray-100">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">VAT scheme</label>
                      <select
                        value={vatScheme}
                        onChange={e => setVatScheme(e.target.value as VatScheme)}
                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {VAT_SCHEME_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">VAT number</label>
                      <input
                        type="text"
                        value={vatNumber}
                        onChange={e => setVatNumber(e.target.value)}
                        placeholder="GB123456789"
                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save changes
                </button>
                {saved && (
                  <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                    <Check size={12} /> Saved
                  </span>
                )}
              </div>
            </div>
          </fieldset>

          {/* Admin actions */}
          {isAdmin && (
            <div>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Admin</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Tooltip label={book.admin_locked ? 'Allow everyone to edit again' : 'Restrict editing to admins only'}>
                  <button
                    onClick={toggleAdminLock}
                    className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50"
                  >
                    {book.admin_locked ? <Unlock size={13} /> : <Lock size={13} />}
                    {book.admin_locked ? 'Unlock book' : 'Lock book'}
                  </button>
                </Tooltip>
                <Tooltip label={book.archived ? 'Restore to the active list' : 'Hide from the dashboard'}>
                  <button
                    onClick={toggleArchive}
                    className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50"
                  >
                    <ArchiveIcon size={13} />
                    {book.archived ? 'Restore book' : 'Archive book'}
                  </button>
                </Tooltip>
              </div>
              {!isAdmin && (
                <p className="mt-2 text-[11px] text-gray-400 flex items-center gap-1">
                  <AlertTriangle size={10} /> Only admins can lock or archive a book.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
