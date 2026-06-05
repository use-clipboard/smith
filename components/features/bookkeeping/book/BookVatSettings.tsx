'use client';

/**
 * BookVatSettings — the "VAT" tab of the book settings drawer.
 *
 * VAT status is effective-dated: rather than editing the book's current VAT
 * fields directly, you RECORD A CHANGE from a date (registered on/off, scheme,
 * flat rate %, VRN). The server updates the book's denormalised "current"
 * fields when the change is the one in effect today, and the VAT-return compute
 * resolves the status as-of each period. The history shows the trail.
 */

import { useEffect, useState } from 'react';
import { Loader2, Plus, Check, ShieldCheck, ExternalLink } from 'lucide-react';
import DateInput, { toIso, fromIso } from '../input/DateInput';
import { VAT_SCHEME_OPTIONS, VAT_SCHEME_LABEL, type Book, type VatScheme } from '@/types/bookkeeping';

interface Creator { id: string; full_name: string | null; email: string }
interface Change {
  id: string;
  effective_from: string;
  vat_registered: boolean;
  vat_scheme: string | null;
  flat_rate_percentage: number | null;
  vat_number: string | null;
  note: string | null;
  created_at: string;
  creator?: Creator | Creator[] | null;
}

function uk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
function creatorName(c: Change['creator']): string {
  const r = Array.isArray(c) ? c[0] : c;
  return r?.full_name ?? r?.email ?? 'Unknown';
}
function describe(c: Change): string {
  if (!c.vat_registered) return 'Not VAT registered';
  const scheme = VAT_SCHEME_LABEL[(c.vat_scheme ?? 'standard') as VatScheme] ?? c.vat_scheme ?? 'Standard';
  const rate = c.vat_scheme === 'flat_rate' && c.flat_rate_percentage != null ? ` ${c.flat_rate_percentage}%` : '';
  return `VAT registered · ${scheme}${rate}${c.vat_number ? ` · ${c.vat_number}` : ''}`;
}

export default function BookVatSettings({
  book, disabled, onUpdated,
}: {
  book: Book;
  disabled?: boolean;
  onUpdated: (next: Book) => void;
}) {
  const [history, setHistory] = useState<Change[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Record-change form
  const [effFrom, setEffFrom] = useState('');
  const [registered, setRegistered] = useState(book.vat_registered);
  const [scheme, setScheme] = useState<VatScheme>((book.vat_scheme ?? 'standard') as VatScheme);
  const [rate, setRate] = useState(book.flat_rate_percentage != null ? String(book.flat_rate_percentage) : '');
  const [vrn, setVrn] = useState(book.vat_number ?? '');
  const [note, setNote] = useState('');

  async function load() {
    try {
      const r = await fetch(`/api/bookkeeping/books/${book.id}/vat-status`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setHistory((d.changes ?? []) as Change[]);
    } catch { /* ignore */ }
  }
  useEffect(() => { void load(); }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const iso = toIso(effFrom);
    if (!iso) { setError('Enter the date the change takes effect.'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${book.id}/vat-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effective_from: iso,
          vat_registered: registered,
          vat_scheme: registered ? scheme : null,
          flat_rate_percentage: registered && scheme === 'flat_rate' && rate.trim() !== '' ? Number(rate) : null,
          vat_number: registered ? (vrn.trim() || null) : null,
          note: note.trim() || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not record the change.');
      // Refresh the book so the drawer/header reflect the new current status.
      const br = await fetch(`/api/bookkeeping/books/${book.id}`);
      const bd = await br.json().catch(() => ({}));
      if (br.ok && bd.book) onUpdated(bd.book as Book);
      await load();
      setAdding(false); setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the change.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current status */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700 mb-1">Current status</p>
        <p className="text-sm text-slate-800">
          {book.vat_registered
            ? `VAT registered · ${VAT_SCHEME_LABEL[(book.vat_scheme ?? 'standard') as VatScheme] ?? book.vat_scheme}${book.vat_scheme === 'flat_rate' && book.flat_rate_percentage != null ? ` ${book.flat_rate_percentage}%` : ''}`
            : 'Not VAT registered'}
        </p>
        {book.vat_number && <p className="text-xs text-slate-500 mt-0.5">{book.vat_number}</p>}
      </div>

      {/* HMRC gateway pointer */}
      <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
        <ShieldCheck size={12} className="text-emerald-600" /> Connect to HMRC and submit returns from the <strong>VAT Return → Submit to HMRC</strong> screen.
        <ExternalLink size={11} className="text-slate-400" />
      </p>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {/* Record a change */}
      {!disabled && (
        adding ? (
          <div className="rounded-lg border border-slate-200 p-3 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Record a VAT change</p>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Effective from</label>
              <div className="w-40"><DateInput value={effFrom} onChange={setEffFrom} ariaLabel="Effective from" /></div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={registered} onChange={e => setRegistered(e.target.checked)} className="rounded border-gray-300" />
              VAT registered from this date
            </label>
            {registered && (
              <div className="space-y-2 pl-1">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Scheme</label>
                  <select value={scheme} onChange={e => setScheme(e.target.value as VatScheme)} className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {VAT_SCHEME_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
                {scheme === 'flat_rate' && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Flat rate (%)</label>
                    <input type="text" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 14.5" className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">VAT number</label>
                  <input type="text" value={vrn} onChange={e => setVrn(e.target.value)} placeholder="GB123456789" className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Note (optional)</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Registered after passing threshold" className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Record change
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setAdding(true); setEffFrom(fromIso(new Date().toISOString().slice(0, 10))); }} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50">
            <Plus size={14} /> Record a VAT change
          </button>
        )
      )}

      {/* History */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">VAT history</p>
        {history === null ? (
          <p className="text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400">No recorded changes yet — the book's starting VAT status applies throughout.</p>
        ) : (
          <ul className="space-y-1.5">
            {history.map(c => (
              <li key={c.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800 tabular-nums">From {uk(c.effective_from)}</span>
                  <span className="text-[10px] text-slate-400">{creatorName(c.creator)}</span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">{describe(c)}</p>
                {c.note && <p className="text-[11px] text-slate-400 mt-0.5 italic">{c.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
