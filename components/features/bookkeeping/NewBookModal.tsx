'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, BookCopy, ChevronRight, ChevronDown, ListTree } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import DateInput, { fromIso, toIso } from './input/DateInput';
import {
  BOOK_TEMPLATE_OPTIONS, BOOK_TEMPLATE_LABEL, VAT_SCHEME_OPTIONS, BASE_CURRENCY_OPTIONS,
  defaultTemplateFromBusinessType,
  type Book, type BookTemplateType, type VatScheme,
} from '@/types/bookkeeping';
import { previewCoa } from '@/config/bookkeeping/coa-defaults';

interface Props {
  onClose: () => void;
  onCreated: (book: Book) => void;
}

interface ClientDetail {
  id: string;
  name: string;
  business_type: string | null;
  vat_number: string | null;
  // Note: the client record's vat_scheme is the FILING FREQUENCY
  // (Monthly/Quarterly/Yearly) and vat_submit_type is Cash/Accrual.
  // Neither maps cleanly to the bookkeeping VAT scheme (standard/flat/...) —
  // so we only use vat_submit_type and Yearly frequency as soft hints below.
  vat_scheme: 'Monthly' | 'Quarterly' | 'Yearly' | null;
  vat_submit_type: 'Cash' | 'Accrual' | null;
  /** Free-text year-end on the client record (e.g. "31 March", "31/03",
   *  "March", "31-03"). We do a best-effort parse to suggest a MM-DD
   *  default for the book; the user always confirms. */
  year_end: string | null;
}

/** Best-effort parse of the client.year_end free-text field into MM-DD.
 *  Returns null when nothing sensible can be extracted. */
function parseClientYearEnd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Already canonical (MM-DD)
  const md = /^(\d{2})-(\d{2})$/.exec(s);
  if (md) return s;

  // dd/mm or dd/mm/yyyy or dd-mm or dd-mm-yyyy
  const slash = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?$/.exec(s);
  if (slash) {
    const dd = String(parseInt(slash[1], 10)).padStart(2, '0');
    const mm = String(parseInt(slash[2], 10)).padStart(2, '0');
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${mm}-${dd}`;
  }

  // "31 March", "31st March", "31 Mar 2025"
  const named = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/.exec(s);
  if (named) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mIndex = months.findIndex(m => named[2].toLowerCase().startsWith(m));
    if (mIndex !== -1) {
      const dd = String(parseInt(named[1], 10)).padStart(2, '0');
      const mm = String(mIndex + 1).padStart(2, '0');
      return `${mm}-${dd}`;
    }
  }

  // Just a month name ("March") — assume last day of that month
  const monthOnly = /^([A-Za-z]+)$/.exec(s);
  if (monthOnly) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mIndex = months.findIndex(m => monthOnly[1].toLowerCase().startsWith(m));
    if (mIndex !== -1) {
      // Last day of the month — leap-year-agnostic; we pick the 28th for Feb.
      const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const dd = String(monthDays[mIndex]).padStart(2, '0');
      const mm = String(mIndex + 1).padStart(2, '0');
      return `${mm}-${dd}`;
    }
  }

  return null;
}

/** Auto-format DD-MM as the user types: keep only digits, insert the hyphen
 *  after the second digit. Same behaviour as Book Settings. */
function autoFormatDm(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function inferVatSchemeFromClient(c: Pick<ClientDetail, 'vat_scheme' | 'vat_submit_type'>): VatScheme {
  if (c.vat_submit_type === 'Cash') return 'cash';
  if (c.vat_scheme === 'Yearly')    return 'annual';
  return 'standard';
}

export default function NewBookModal({ onClose, onCreated }: Props) {
  // ── Form state ─────────────────────────────────────────────────────────────
  const [clientId, setClientId]   = useState('');
  const [clientName, setClientName] = useState('');
  const [unallocated, setUnallocated] = useState(false);

  const [name, setName]                   = useState('');
  const [template, setTemplate]           = useState<BookTemplateType>('basic');
  const [baseCurrency, setBaseCurrency]   = useState('GBP');
  const [vatRegistered, setVatRegistered] = useState(false);
  const [vatScheme, setVatScheme]         = useState<VatScheme>('standard');
  const [vatNumber, setVatNumber]         = useState('');

  // Year-end pattern shown in DD-MM (UK convention). Internally converted
  // to MM-DD before sending to the API since that's what the DB column
  // stores. Pre-filled from the client record when we can parse it.
  const [yearEndDm, setYearEndDm]         = useState('');
  // First-period start as the user-typed dd/mm/yyyy string. Holding the
  // raw string here means half-formed input ('01/0…') stays in the input
  // box. Converted to ISO when we send to the API.
  const [firstPeriodStartUk, setFirstPeriodStartUk] = useState<string>(() => fromIso(new Date().toISOString().slice(0, 10)));

  // Track whether the user has manually edited the book name. Once they have,
  // we stop auto-rewriting it when the client/template changes.
  const [nameTouched, setNameTouched] = useState(false);

  // Human-readable note of what we pre-filled from the client record, so the
  // suggestion is transparent and the user can sanity-check / override it.
  const [clientHint, setClientHint] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── COA preview state ──────────────────────────────────────────────────────
  // Recomputed every render from the (small) seed registry — no API call.
  const coaPreview = useMemo(
    () => previewCoa(template, vatRegistered),
    [template, vatRegistered],
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expandedLedgers, setExpandedLedgers] = useState<Set<string>>(new Set());
  function toggleLedger(name: string) {
    setExpandedLedgers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // ── Pre-fill from selected client ──────────────────────────────────────────
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/clients/${clientId}`);
        if (!r.ok) return;
        const d = await r.json();
        const c: ClientDetail | null = d.client ?? null;
        if (!c || cancelled) return;
        const inferredTemplate = defaultTemplateFromBusinessType(c.business_type);
        setTemplate(inferredTemplate);

        // VAT: a stored VAT number OR a filing frequency (vat_scheme) means the
        // client is VAT-registered. Set the flag explicitly either way so
        // switching from a VAT to a non-VAT client correctly clears it.
        const vatRegisteredSignal = !!(c.vat_number || c.vat_scheme);
        setVatRegistered(vatRegisteredSignal);
        if (vatRegisteredSignal) {
          if (c.vat_number) setVatNumber(c.vat_number);
          setVatScheme(inferVatSchemeFromClient(c));
        }

        // Soft-parse the client's free-text year_end. parseClientYearEnd
        // returns MM-DD; flip to DD-MM for the input.
        const parsedYeMd = parseClientYearEnd(c.year_end);
        if (parsedYeMd) {
          const [mm, dd] = parsedYeMd.split('-');
          setYearEndDm(`${dd}-${mm}`);
        }

        // Build the transparency note.
        const bits: string[] = [];
        if (c.business_type) bits.push(BOOK_TEMPLATE_LABEL[inferredTemplate]);
        if (vatRegisteredSignal) bits.push('VAT registered');
        if (parsedYeMd) bits.push(`year-end ${parsedYeMd.split('-').reverse().join('-')}`);
        setClientHint(bits.length ? `Suggested from ${c.name}’s record: ${bits.join(' · ')}. Change anything below.` : '');
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // ── Auto-suggest book name ─────────────────────────────────────────────────
  useEffect(() => {
    if (nameTouched) return;
    if (unallocated) {
      setName('New unallocated book');
      return;
    }
    if (clientName) {
      setName(`${clientName} — Books`);
      return;
    }
    setName('');
  }, [clientName, unallocated, nameTouched]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!unallocated && !clientId) {
      setError('Pick a client or tick "Create unallocated".');
      return;
    }
    if (!name.trim()) {
      setError('Book name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/bookkeeping/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: unallocated ? null : clientId,
          name: name.trim(),
          template_type: template,
          base_currency: baseCurrency,
          vat_registered: vatRegistered,
          vat_scheme: vatRegistered ? vatScheme : null,
          vat_number: vatRegistered ? (vatNumber.trim() || null) : null,
          // Flip DD-MM (display) → MM-DD (DB) at the API boundary.
          year_end_md: (() => {
            const m = /^(\d{2})-(\d{2})$/.exec(yearEndDm.trim());
            return m ? `${m[2]}-${m[1]}` : null;
          })(),
          // Convert dd/mm/yyyy → ISO for the API. Falls back to null if
          // the user didn't supply a year-end or didn't enter a valid date.
          first_period_start: yearEndDm.trim() ? (toIso(firstPeriodStartUk) || null) : null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to create book');
      }
      const d = await r.json();
      onCreated(d.book as Book);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create book');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <BookCopy size={18} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">New set of books</h2>
              <p className="text-xs text-gray-500">Create a bookkeeping file linked to a client, or leave unallocated.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Client picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Client</label>
            <ClientSearchInput
              value={unallocated ? '' : clientId}
              valueName={unallocated ? '' : clientName}
              onChange={(id, n) => {
                setClientId(id);
                setClientName(n);
                if (id) setUnallocated(false);
                if (!id) setClientHint('');
              }}
              disabled={unallocated}
              placeholder="Choose a client…"
            />
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={unallocated}
                onChange={e => {
                  setUnallocated(e.target.checked);
                  if (e.target.checked) { setClientId(''); setClientName(''); setClientHint(''); }
                }}
                className="rounded border-gray-300"
              />
              Create unallocated (no client link yet)
            </label>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Book name</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setNameTouched(true); }}
              placeholder="e.g. Smith Ltd — Books"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Suggested-from-client hint */}
          {clientHint && !unallocated && (
            <div className="flex items-start gap-2 rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-800">
              <ListTree size={13} className="mt-px shrink-0 text-indigo-500" />
              <span>{clientHint}</span>
            </div>
          )}

          {/* Template picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Template</label>
            <div className="grid grid-cols-2 gap-2">
              {BOOK_TEMPLATE_OPTIONS.map(opt => {
                const active = template === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTemplate(opt.id)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      active
                        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* VAT + Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Base currency</label>
              <select
                value={baseCurrency}
                onChange={e => setBaseCurrency(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {BASE_CURRENCY_OPTIONS.map(c => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">VAT registered</label>
              <label className="inline-flex items-center gap-2 h-9 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={vatRegistered}
                  onChange={e => setVatRegistered(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Yes — register VAT details below
              </label>
            </div>
          </div>

          {/* Year-end pattern + first-period anchor. Optional — books work
              fine without one, but until set the period management features
              (year-end close, FY-aware reports) stay dormant. */}
          <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-indigo-50/40 border border-indigo-100">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Year-end <span className="text-[10px] font-normal text-gray-400 normal-case">(optional, DD-MM)</span>
              </label>
              <input
                type="text"
                value={yearEndDm}
                onChange={e => setYearEndDm(autoFormatDm(e.target.value))}
                placeholder="31-03"
                inputMode="numeric"
                pattern="\d{2}-\d{2}"
                maxLength={5}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                e.g. <code>31-03</code> for 31 March. Drives financial years + year-end close.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                First period start
              </label>
              <DateInput
                value={firstPeriodStartUk}
                onChange={setFirstPeriodStartUk}
                disabled={!yearEndDm.trim()}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                When the very first FY starts. Can be a short year.
              </p>
            </div>
          </div>

          {vatRegistered && (
            <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">VAT scheme</label>
                <select
                  value={vatScheme}
                  onChange={e => setVatScheme(e.target.value as VatScheme)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {VAT_SCHEME_OPTIONS.map(o => (<option key={o.id} value={o.id}>{o.label}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">VAT number</label>
                <input
                  type="text"
                  value={vatNumber}
                  onChange={e => setVatNumber(e.target.value)}
                  placeholder="GB123456789"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {/* COA preview — live updates with template + VAT toggle */}
          <div className="rounded-lg border border-gray-200">
            <button
              type="button"
              onClick={() => setPreviewOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ListTree size={14} className="text-gray-500 shrink-0" />
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Chart of accounts preview</span>
                  <span className="text-gray-500 ml-2">
                    {coaPreview.has_seed
                      ? `${coaPreview.total_ledgers} ledger${coaPreview.total_ledgers !== 1 ? 's' : ''}, ${coaPreview.total_accounts} account${coaPreview.total_accounts !== 1 ? 's' : ''}`
                      : 'Empty COA — you’ll add accounts as you go'}
                  </span>
                </div>
              </div>
              {previewOpen
                ? <ChevronDown size={14} className="text-gray-400 shrink-0" />
                : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
            </button>

            {previewOpen && (
              <div className="border-t border-gray-200 max-h-72 overflow-y-auto p-2 bg-gray-50/50">
                {!coaPreview.has_seed ? (
                  <p className="text-xs text-gray-500 px-2 py-3 italic">
                    No default COA shipped for this template yet. The book will be created
                    with an empty Chart of Accounts — you can add ledgers and accounts as you go.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {coaPreview.ledgers.map(l => {
                      const isOpen = expandedLedgers.has(l.name);
                      const isEmpty = l.accounts.length === 0;
                      return (
                        <div key={l.name} className="bg-white rounded border border-gray-100">
                          <button
                            type="button"
                            onClick={() => !isEmpty && toggleLedger(l.name)}
                            disabled={isEmpty}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left ${
                              isEmpty ? 'cursor-default' : 'hover:bg-gray-50 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {!isEmpty && (isOpen
                                ? <ChevronDown size={11} className="text-gray-400 shrink-0" />
                                : <ChevronRight size={11} className="text-gray-400 shrink-0" />)}
                              {isEmpty && <span className="w-[11px] shrink-0" />}
                              <span className="text-xs font-medium text-gray-800 truncate">{l.name}</span>
                              <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                                l.ledger_type === 'profit_and_loss'
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}>
                                {l.ledger_type === 'profit_and_loss' ? 'P&L' : 'BS'}
                              </span>
                            </div>
                            <span className="text-[11px] text-gray-400 shrink-0">
                              {isEmpty ? 'empty' : `${l.accounts.length}`}
                            </span>
                          </button>
                          {isOpen && l.accounts.length > 0 && (
                            <ul className="px-2.5 pb-2 pt-0.5 space-y-0.5">
                              {l.accounts.map(a => (
                                <li key={a} className="text-[11px] text-gray-600 pl-4">{a}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              Create book
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
