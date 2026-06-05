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
import DateInput, { fromIso, toIso } from '../input/DateInput';
import { BASE_CURRENCY_OPTIONS, type Book } from '@/types/bookkeeping';
import BookVatSettings from './BookVatSettings';
import BookTimeline from './BookTimeline';

type SettingsTab = 'general' | 'vat' | 'timeline';

interface Props {
  open: boolean;
  onClose: () => void;
  book: Book;
  isAdmin: boolean;
  /** Replaces the in-memory book after a successful update so the parent UI re-renders. */
  onUpdated: (next: Book) => void;
}

/** Convert MM-DD (DB) → DD-MM (display). Returns '' for null/invalid. */
function mdToDm(md: string | null | undefined): string {
  if (!md) return '';
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  return m ? `${m[2]}-${m[1]}` : '';
}
/** Convert DD-MM (display) → MM-DD (DB). Returns null when malformed/empty. */
function dmToMd(dm: string): string | null {
  const trimmed = dm.trim();
  if (!trimmed) return null;
  const m = /^(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  return `${m[2]}-${m[1]}`;
}
/** Auto-format DD-MM as the user types: takes any raw input, keeps only
 *  digits, inserts the hyphen after the second digit, and clamps to 4 digits
 *  total. So typing "3103" produces "31-03". */
function autoFormatDm(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export default function BookSettingsDrawer({ open, onClose, book, isAdmin, onUpdated }: Props) {
  const lockedForMe = book.admin_locked && !isAdmin;

  const [settingsTab, setSettingsTab]     = useState<SettingsTab>('general');
  const [name, setName]                   = useState(book.name);
  const [baseCurrency, setBaseCurrency]   = useState(book.base_currency);
  // The DB stores MM-DD for trivial sort/parse; the UI shows DD-MM because
  // that's the UK convention the rest of the module uses for dates.
  const [yearEndDm, setYearEndDm]               = useState(mdToDm(book.year_end_md));
  // Stored as the user-typed dd/mm/yyyy string so half-formed input ('01/0')
  // doesn't get rejected. Converted to ISO at the API boundary.
  const [firstPeriodStartUk, setFirstPeriodStartUk] = useState(fromIso(book.first_period_start ?? ''));

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  // Year-end is locked once any FY has been closed — we fetch the count of
  // closed FYs on open so the UI can grey out the field and explain why.
  const [closedFyCount, setClosedFyCount] = useState<number | null>(null);

  // Reset form state whenever the drawer (re)opens or the book changes.
  useEffect(() => {
    if (!open) return;
    setSettingsTab('general');
    setName(book.name);
    setBaseCurrency(book.base_currency);
    setYearEndDm(mdToDm(book.year_end_md));
    setFirstPeriodStartUk(fromIso(book.first_period_start ?? ''));
    setError('');
    setSaved(false);

    // Pull FY status so we know whether to lock the year-end input.
    fetch(`/api/bookkeeping/books/${book.id}/years`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { years?: { status: string }[] } | null) => {
        if (!d?.years) { setClosedFyCount(0); return; }
        setClosedFyCount(d.years.filter(y => y.status === 'closed').length);
      })
      .catch(() => setClosedFyCount(0));
  }, [open, book]);

  const yearEndLocked = (closedFyCount ?? 0) > 0;

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
      // Build the patch payload. Year-end / first-period only included
      // when not locked AND something actually changed — otherwise the API
      // would re-run FY generation unnecessarily.
      // VAT status is no longer edited here — it's managed via the effective-
      // dated flow in the VAT tab (BookVatSettings → /vat-status).
      const payload: Record<string, unknown> = {
        name: name.trim(),
        base_currency: baseCurrency,
      };
      if (!yearEndLocked) {
        // Convert the displayed DD-MM back to the DB's MM-DD for the API.
        const yearEndMdForApi = dmToMd(yearEndDm);
        if ((yearEndMdForApi || null) !== (book.year_end_md || null)) {
          payload.year_end_md = yearEndMdForApi;
        }
        // Convert dd/mm/yyyy → ISO at the API boundary. Bail early if the
        // user typed something the parser couldn't make sense of.
        const firstPeriodStartIso = firstPeriodStartUk.trim() ? toIso(firstPeriodStartUk) : '';
        if (firstPeriodStartUk.trim() && !firstPeriodStartIso) {
          throw new Error(`"${firstPeriodStartUk}" isn't a valid date — use dd/mm/yyyy.`);
        }
        if ((firstPeriodStartIso || null) !== (book.first_period_start || null)) {
          payload.first_period_start = firstPeriodStartIso || null;
        }
      }
      const next = await patch(payload);
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

        {/* Tab bar */}
        <div className="flex items-stretch gap-1 px-3 pt-2 border-b border-gray-200" role="tablist">
          {([
            { id: 'general', label: 'General' },
            { id: 'vat', label: 'VAT' },
            { id: 'timeline', label: 'Timeline' },
          ] as { id: SettingsTab; label: string }[]).map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={settingsTab === t.id}
              onClick={() => setSettingsTab(t.id)}
              className={`px-3 py-1.5 text-sm rounded-t-md -mb-px border-b-2 transition-colors ${
                settingsTab === t.id
                  ? 'border-indigo-600 text-indigo-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* VAT tab */}
        {settingsTab === 'vat' && (
          <div className="flex-1 overflow-y-auto p-5">
            <BookVatSettings book={book} disabled={lockedForMe} onUpdated={onUpdated} />
          </div>
        )}

        {/* Timeline tab */}
        {settingsTab === 'timeline' && (
          <div className="flex-1 overflow-y-auto p-5">
            <BookTimeline bookId={book.id} />
          </div>
        )}

        {settingsTab === 'general' && (
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
                <div className="space-y-3 p-3 rounded bg-indigo-50/40 border border-indigo-100">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-indigo-900">Year-end &amp; periods</p>
                    {yearEndLocked && (
                      <Tooltip label="Year-end can't be changed once a financial year has been closed.">
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                          <Lock size={9} /> Locked
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Year-end (DD-MM)</label>
                      <input
                        type="text"
                        value={yearEndDm}
                        onChange={e => setYearEndDm(autoFormatDm(e.target.value))}
                        placeholder="31-03"
                        inputMode="numeric"
                        pattern="\d{2}-\d{2}"
                        maxLength={5}
                        disabled={lockedForMe || yearEndLocked}
                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums disabled:bg-gray-100 disabled:text-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">First period start</label>
                      <DateInput
                        value={firstPeriodStartUk}
                        onChange={setFirstPeriodStartUk}
                        disabled={lockedForMe || yearEndLocked || !yearEndDm.trim()}
                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    Drives financial-year boundaries, year-end close and the FY-aware reports. Once a year is closed the pattern is locked — adjusting it would silently break old boundaries.
                  </p>
                </div>

                <p className="text-[11px] text-gray-400">
                  VAT registration, scheme and flat rate are managed in the <strong>VAT</strong> tab.
                </p>
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
        )}
      </div>
    </div>
  );
}
