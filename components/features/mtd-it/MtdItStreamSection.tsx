'use client';

/**
 * MtdItStreamSection — one stream's entries in the review stage, as a single
 * full-width grid.
 *
 * Replaces the old MtdItStreamColumn, which squeezed each stream into a narrow
 * side-by-side column and therefore had to hide most of the row behind a chevron.
 * The fields that decide the tax outcome (allocation, category, share %) were the
 * hidden ones, which is what made the screen hard to follow. Here every field is
 * a column and nothing is more than one click away.
 *
 * Three deliberate departures from the old design:
 *
 *  1. No Income/Expenses/Flagged TABS. Flagged rows stay exactly where they are,
 *     amber-ringed with the reason inline. The old screen moved a row to another
 *     tab the moment it looked wrong — which unmounted the input the user was
 *     typing into, and hid the rows being dropped from the totals behind a tab
 *     nobody clicked.
 *  2. No Type field. The Category select lists both Income and Expense groups;
 *     picking from the other group moves the row. (Same trick as the Landlord
 *     tool's edit modal.)
 *  3. Tab off the last cell of the last row appends a row, inheriting the date
 *     and allocation above it — the bookkeeping input sheets' pattern.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import {
  Plus, Trash2, Flag, FlagOff, ChevronDown, ChevronRight,
  Briefcase, House, Globe2, Layers, Eye, ExternalLink, RefreshCw,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import DateInput, { fromIso, parseUkDateStrict } from '@/components/features/bookkeeping/input/DateInput';
import {
  SOLE_TRADER_INCOME, SOLE_TRADER_EXPENSES,
  UK_RENTAL_INCOME, UK_RENTAL_EXPENSES,
} from '@/lib/mtdIt/categories';
import { grossGbp, round2, shareAdjustedGbp } from '@/lib/mtdIt/amounts';
import { flagReasonFor, isEntryFlagged } from '@/lib/mtdIt/flags';
import { currencyOptionsIncluding } from '@/lib/mtdIt/currencyCodes';
import type { EditorEntry } from '@/lib/mtdIt/types';
import type { MtdItStream, MtdItProperty, MtdItTrade } from '@/types';

// ── HMRC FX rate fetch (client) ──────────────────────────────────────────
// The month's rate is the same for every entry in that month, so cache per
// CURRENCY|YYYY-MM across the whole editor session — a quarter of foreign rows
// then costs at most three HMRC lookups. `null` = HMRC has no rate for that
// pair; we still cache it so we don't re-ask on every keystroke.
const fxCache = new Map<string, Promise<number | null>>();

function fxKey(currency: string, isoDate: string): string {
  return `${currency.toUpperCase()}|${isoDate.slice(0, 7)}`;
}

function fetchFxRate(currency: string, isoDate: string): Promise<number | null> {
  const key = fxKey(currency, isoDate);
  const hit = fxCache.get(key);
  if (hit) return hit;
  const p = fetch(`/api/mtd-it/fx-rate?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(isoDate)}`)
    .then(r => r.ok ? r.json() : { rate: null })
    .then(d => (typeof d.rate === 'number' ? round2Fx(d.rate) : null))
    .catch(() => null);
  fxCache.set(key, p);
  return p;
}

/** FX rates carry more precision than money — keep 6dp so a small rate like
 *  0.0079 isn't flattened to 0.01. */
function round2Fx(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export type { EditorEntry };

// Borderless cell input — the grid draws the lines, the input fills the cell and
// rings inside it on focus. Same shape the bookkeeping input sheets use.
const CELL =
  'w-full text-xs px-2 py-1 border-0 bg-transparent focus:outline-none ' +
  'focus:ring-2 focus:ring-inset focus:ring-indigo-500 disabled:text-gray-500';
const CELL_NUM = `${CELL} text-right tabular-nums`;

interface Props {
  stream: MtdItStream;
  entries: EditorEntry[];
  properties: MtdItProperty[];
  trades: MtdItTrade[];
  fxRates: Record<string, number>;
  consolidated: boolean;
  onChange: (next: EditorEntry[]) => void;
  /** Snapshot the current entries for undo. Pass a stable key (row + field) for
   *  keystroke-level edits so a run of typing coalesces into one undo step;
   *  omit it for discrete actions (add, delete, flag) that should each be their
   *  own step. */
  pushHistory: (coalesceKey?: string) => void;
  /** Read-only: rows can be read and source docs opened, but nothing is
   *  editable and the add/delete/flag affordances are hidden. Filed/approved
   *  quarters. */
  readOnly?: boolean;
  onViewSource: (fileName: string, pageNumber: number | null) => void;
}

const STREAM_META: Record<MtdItStream, { label: string; Icon: typeof Briefcase; bg: string; border: string; accent: string; allocLabel: string }> = {
  sole:           { label: 'Sole Trader',    Icon: Briefcase, bg: 'bg-orange-50',  border: 'border-orange-200',  accent: 'text-orange-700',  allocLabel: 'Trade' },
  uk_rental:      { label: 'UK Rental',      Icon: House,     bg: 'bg-blue-50',    border: 'border-blue-200',    accent: 'text-blue-700',    allocLabel: 'Property' },
  foreign_rental: { label: 'Foreign Rental', Icon: Globe2,    bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'text-emerald-700', allocLabel: 'Property' },
};

function categoriesForStream(stream: MtdItStream, type: 'income' | 'expense'): readonly string[] {
  if (stream === 'sole') return type === 'income' ? SOLE_TRADER_INCOME : SOLE_TRADER_EXPENSES;
  return type === 'income' ? UK_RENTAL_INCOME : UK_RENTAL_EXPENSES;
}

/** Which type does this category belong to? Drives the Category-select-moves-the-row
 *  behaviour, so a mis-typed row is fixed by re-categorising it. */
function typeForCategory(stream: MtdItStream, category: string): 'income' | 'expense' | null {
  if (categoriesForStream(stream, 'income').includes(category)) return 'income';
  if (categoriesForStream(stream, 'expense').includes(category)) return 'expense';
  return null;
}

/** The client's ownership share of a property, from Setup. Falls back to 100
 *  when the row isn't tagged to one — we don't know whose share to apply, and
 *  100 errs towards over- rather than under-declaring. */
function shareForProperty(properties: MtdItProperty[], propertyId: string | null): number {
  if (!propertyId) return 100;
  return properties.find(p => p.id === propertyId)?.ownership_pct ?? 100;
}

function emptyEntry(
  stream: MtdItStream,
  type: 'income' | 'expense',
  properties: MtdItProperty[],
  opts: { category?: string; inheritFrom?: EditorEntry } = {},
): EditorEntry {
  const prev = opts.inheritFrom;
  return {
    _localId: `tmp_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    _isNew: true,
    _dirty: true,
    // Inherit the date and allocation from the row above: on a long sheet
    // they're nearly always the same, and re-picking them every row is the
    // slowest part of manual entry.
    _dateText: prev?._dateText ?? '',
    entry_date: prev?.entry_date ?? null,
    trade_id: prev?.trade_id ?? null,
    property_id: prev?.property_id ?? null,
    stream,
    source_file_name: null,
    page_number: null,
    description: null,
    supplier: null,
    invoice_number: null,
    category: opts.category ?? categoriesForStream(stream, type)[0],
    entry_type: type,
    gross_amount: 0,
    net_amount: null,
    vat_amount: null,
    currency: prev?.currency ?? (stream === 'foreign_rental' ? 'EUR' : 'GBP'),
    fx_rate: prev?.fx_rate ?? null,
    gbp_amount: null,
    // From the inherited property's Setup share — NOT from the row above. Two
    // consecutive rows can sit on differently-owned properties, so copying the
    // previous row's share would quietly carry the wrong one across.
    share_pct: stream === 'sole' ? 100 : shareForProperty(properties, prev?.property_id ?? null),
    manual: true,
    flagged_reason: null,
    drive_link: null,
  };
}

function fmtMoney(amount: number, currency: string = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Parse a money input without letting a mid-edit value wipe the field.
 *  Number('') is 0 and Number('-') is NaN — both would silently zero the row. */
function parseMoney(raw: string, fallback: number): number {
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** An optional money field: blank means "not stated", not zero. */
function parseOptionalMoney(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Gross = net + VAT, with a blank treated as nil.
 *
 *  Typing net and VAT and then working out the gross by hand is the sort of
 *  arithmetic the app should be doing. Only ever recomputed when the user edits
 *  net or VAT — a gross typed on its own stands, and rows that arrive from the
 *  AI keep whatever it read off the document. Rounded because 0.1 + 0.2 is not
 *  0.3 in binary floating point. */
function grossFromParts(net: number | null, vat: number | null): number {
  return round2((net ?? 0) + (vat ?? 0));
}

export default function MtdItStreamSection({
  stream, entries, properties, trades, fxRates, consolidated,
  onChange, pushHistory, readOnly = false, onViewSource,
}: Props) {
  const M = STREAM_META[stream];
  const visible = entries.filter(e => !e._deleted);

  const showShare = stream === 'uk_rental' || stream === 'foreign_rental';
  const showFx    = stream === 'foreign_rental';

  const valueOf = (e: EditorEntry) => round2(shareAdjustedGbp(e, fxRates));

  // Flagged rows are excluded from the headline totals but stay in place in the
  // grid — see the file header.
  const flagged      = visible.filter(isEntryFlagged);
  const clean        = visible.filter(e => !isEntryFlagged(e));
  const totalIncome  = clean.filter(e => e.entry_type === 'income').reduce((a, e) => a + valueOf(e), 0);
  const totalExpense = clean.filter(e => e.entry_type === 'expense').reduce((a, e) => a + valueOf(e), 0);
  const totalFlagged = flagged.reduce((a, e) => a + valueOf(e), 0);
  const net = totalIncome - totalExpense;

  const [openCat, setOpenCat] = useState<Record<string, boolean>>({});
  const tableRef = useRef<HTMLDivElement>(null);
  // Set when we append a row so we can focus its first cell once it mounts.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${id}"][data-cell="date"]`);
    el?.focus();
    el?.select();
  }, [entries.length]);

  // ── Mutations ────────────────────────────────────────────────────────
  function patch(localId: string, p: Partial<EditorEntry>) {
    // Coalesce on (row, first field touched) so typing a word is one undo step.
    pushHistory(`${localId}|${Object.keys(p)[0] ?? ''}`);
    onChange(entries.map(e => e._localId === localId ? { ...e, ...p, _dirty: true } : e));
  }

  function toggleFlag(localId: string) {
    pushHistory();
    onChange(entries.map(e => {
      if (e._localId !== localId) return e;
      if (isEntryFlagged(e)) {
        // Suppress the flag without erasing why it was raised — the reviewer
        // accepted the row, they didn't decide Claude's finding never happened.
        return { ...e, flag_dismissed: true, _dirty: true };
      }
      return { ...e, flagged_reason: 'Manually flagged for review', flag_dismissed: false, _dirty: true };
    }));
  }

  function deleteEntry(localId: string) {
    pushHistory();
    onChange(entries.map(e => e._localId === localId ? { ...e, _deleted: true, _dirty: true } : e));
  }

  function addEntry(type: 'income' | 'expense', category?: string, inheritFrom?: EditorEntry) {
    pushHistory();
    const fresh = emptyEntry(stream, type, properties, { category, inheritFrom });
    pendingFocus.current = fresh._localId;
    onChange([...entries, fresh]);
    if (category) setOpenCat(p => ({ ...p, [`${type}|${category}`]: true }));
    return fresh;
  }

  /** Re-categorising across the Income/Expense divide moves the row. */
  function setCategory(localId: string, category: string) {
    const nextType = typeForCategory(stream, category);
    patch(localId, nextType ? { category, entry_type: nextType } : { category });
  }

  function commitDate(localId: string, text: string) {
    const iso = parseUkDateStrict(text);
    // Only write entry_date once the text parses to a real day. While it's
    // half-typed we keep the text and leave the stored date alone, so nothing
    // re-sorts, re-flags or re-parents under the cursor.
    patch(localId, { _dateText: text, ...(iso ? { entry_date: iso } : {}) });
  }

  function blurDate(localId: string, text: string) {
    // On blur the text must agree with what we'd save. Anything unparseable
    // clears the stored date rather than leaving a stale one behind it.
    if (text.trim() === '' || !parseUkDateStrict(text)) patch(localId, { entry_date: null });
  }

  const groups = useMemo(() => buildGroups(visible, stream, consolidated), [visible, stream, consolidated]);

  const colCount = 7 + (showShare ? 1 : 0) + (showFx ? 2 : 0) + 1;

  return (
    <section className={`border ${M.border} rounded-xl bg-white shadow-sm overflow-hidden`}>
      <header className={`flex items-center gap-2 px-3 py-2 ${M.bg}`}>
        <M.Icon size={15} className={M.accent} />
        <div className="text-sm font-semibold flex-1 min-w-0 truncate">{M.label}</div>
        <span className="text-[11px] opacity-70">{visible.length} {visible.length === 1 ? 'entry' : 'entries'}</span>
        {!readOnly && (
          <>
            <Tooltip label="Add income entry">
              <button
                onClick={() => addEntry('income')}
                aria-label="Add income entry"
                className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-green-100 text-green-700 hover:bg-green-200 text-[11px] font-medium transition-colors shrink-0"
              ><Plus size={12} strokeWidth={2.5} /> Income</button>
            </Tooltip>
            <Tooltip label="Add expense entry">
              <button
                onClick={() => addEntry('expense')}
                aria-label="Add expense entry"
                className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-red-100 text-red-700 hover:bg-red-200 text-[11px] font-medium transition-colors shrink-0"
              ><Plus size={12} strokeWidth={2.5} /> Expense</button>
            </Tooltip>
          </>
        )}
      </header>

      <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-gray-100 text-xs">
        <Total label="Income"  value={totalIncome}  tone="text-green-700" />
        <Total label="Expense" value={totalExpense} tone="text-red-700" />
        <Total label="Net"     value={net}          tone={net >= 0 ? 'text-gray-800' : 'text-red-700'} />
      </div>

      {flagged.length > 0 && (
        <p className="px-3 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100">
          <strong>{flagged.length}</strong> flagged {flagged.length === 1 ? 'entry' : 'entries'}
          {' '}(<span className="tabular-nums">{fmtMoney(totalFlagged)}</span>) excluded from the totals above —
          they&apos;re highlighted in place below. Fix the issue or clear the flag to include them.
        </p>
      )}

      {visible.length === 0 ? (
        <div className="px-4 py-8 flex flex-col items-center gap-2">
          <p className="text-xs text-gray-500 italic">No entries yet.</p>
          {!readOnly && (
            <div className="flex gap-2">
              <button onClick={() => addEntry('income')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-green-200 text-green-700 hover:bg-green-50">
                <Plus size={12} /> Add income entry
              </button>
              <button onClick={() => addEntry('expense')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50">
                <Plus size={12} /> Add expense entry
              </button>
            </div>
          )}
        </div>
      ) : (
        <div ref={tableRef} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
                <Th className="w-[118px]">Date</Th>
                <Th className="w-[150px]">{M.allocLabel}</Th>
                <Th className="w-[168px]">Category</Th>
                <Th>Description</Th>
                <Th className="w-[130px]">Supplier</Th>
                <Th className="w-[110px]">Invoice no.</Th>
                <Th className="w-[86px]" right>Net</Th>
                <Th className="w-[80px]" right>VAT</Th>
                <Th className="w-[96px]" right>Gross</Th>
                {showFx && <Th className="w-[64px]">Ccy</Th>}
                {showFx && <Th className="w-[84px]" right>FX rate</Th>}
                {showShare && <Th className="w-[70px]" right>Share %</Th>}
                <Th className="w-[92px]" />
              </tr>
            </thead>
            {groups.map(g => (
              <tbody key={g.key} className="border-b border-gray-100 last:border-b-0">
                {g.category !== null && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={colCount + 2} className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setOpenCat(p => ({ ...p, [g.key]: !(p[g.key] ?? true) }))}
                          aria-expanded={openCat[g.key] ?? true}
                          className="inline-flex items-center gap-1.5 text-[11px] hover:text-gray-900"
                        >
                          {(openCat[g.key] ?? true) ? <ChevronDown size={11} className="text-gray-500" /> : <ChevronRight size={11} className="text-gray-500" />}
                          <Layers size={10} className="text-gray-400" />
                          <span className={`font-medium ${g.type === 'income' ? 'text-green-800' : 'text-red-800'}`}>{g.category}</span>
                          <span className="text-[10px] text-gray-400">· {g.rows.length}</span>
                        </button>
                        <span className="ml-auto tabular-nums text-gray-700 font-medium text-[11px]">
                          {fmtMoney(g.rows.reduce((a, e) => a + valueOf(e), 0))}
                        </span>
                        {!readOnly && (
                          <Tooltip label={`Add ${g.type} entry to ${g.category}`}>
                            <button
                              onClick={() => addEntry(g.type, g.category ?? undefined, g.rows[g.rows.length - 1])}
                              aria-label={`Add ${g.type} entry to ${g.category}`}
                              className="p-0.5 rounded hover:bg-gray-200 text-gray-500"
                            ><Plus size={11} /></button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {(g.category === null || (openCat[g.key] ?? true)) && g.rows.map((e, i) => (
                  <EntryRow
                    key={e._localId}
                    entry={e}
                    stream={stream}
                    properties={properties}
                    trades={trades}
                    fxRates={fxRates}
                    showShare={showShare}
                    showFx={showFx}
                    readOnly={readOnly}
                    isLastOfAll={g.isLast && i === g.rows.length - 1}
                    onPatch={p => patch(e._localId, p)}
                    onSetCategory={c => setCategory(e._localId, c)}
                    onDateChange={txt => commitDate(e._localId, txt)}
                    onDateBlur={txt => blurDate(e._localId, txt)}
                    onToggleFlag={() => toggleFlag(e._localId)}
                    onDelete={() => deleteEntry(e._localId)}
                    onViewSource={onViewSource}
                    onTabOffEnd={() => addEntry(e.entry_type, e.category, e)}
                    previousDate={g.rows[i - 1]?._dateText}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}

// ── Grouping ───────────────────────────────────────────────────────────
interface Group {
  key: string;
  category: string | null;   // null = flat (consolidated reporting)
  type: 'income' | 'expense';
  rows: EditorEntry[];
  isLast: boolean;
}

/** Income groups first, then expense; alphabetical within each. Consolidated
 *  reporting collapses to one flat group per type — there are no category
 *  subtotals to show when the figures are filed as a single total. */
function buildGroups(rows: EditorEntry[], stream: MtdItStream, consolidated: boolean): Group[] {
  const out: Group[] = [];
  for (const type of ['income', 'expense'] as const) {
    const ofType = rows.filter(r => r.entry_type === type);
    if (ofType.length === 0) continue;
    if (consolidated) {
      out.push({ key: `${type}|all`, category: null, type, rows: ofType, isLast: false });
      continue;
    }
    const byCat = new Map<string, EditorEntry[]>();
    for (const r of ofType) {
      const arr = byCat.get(r.category) ?? [];
      arr.push(r);
      byCat.set(r.category, arr);
    }
    for (const [category, catRows] of Array.from(byCat.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ key: `${type}|${category}`, category, type, rows: catRows, isLast: false });
    }
  }
  if (out.length > 0) out[out.length - 1].isLast = true;
  void stream;
  return out;
}

// ── Bits ───────────────────────────────────────────────────────────────
function Th({ children, className = '', right = false }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <th className={`px-2 py-1.5 font-semibold ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>;
}

function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`font-medium tabular-nums ${tone}`}>{fmtMoney(value)}</div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function EntryRow(props: {
  entry: EditorEntry;
  stream: MtdItStream;
  properties: MtdItProperty[];
  trades: MtdItTrade[];
  fxRates: Record<string, number>;
  showShare: boolean;
  showFx: boolean;
  readOnly: boolean;
  isLastOfAll: boolean;
  previousDate?: string;
  onPatch: (p: Partial<EditorEntry>) => void;
  onSetCategory: (c: string) => void;
  onDateChange: (text: string) => void;
  onDateBlur: (text: string) => void;
  onToggleFlag: () => void;
  onDelete: () => void;
  onViewSource: (fileName: string, pageNumber: number | null) => void;
  onTabOffEnd: () => void;
}) {
  const {
    entry: e, stream, properties, trades, fxRates, showShare, showFx, readOnly,
    isLastOfAll, previousDate, onPatch, onSetCategory, onDateChange, onDateBlur,
    onToggleFlag, onDelete, onViewSource, onTabOffEnd,
  } = props;

  const flagReason = flagReasonFor(e);
  const allocOptions = stream === 'sole'
    ? trades.map(t => ({ id: t.id, label: t.name }))
    : properties
        .filter(p => p.property_type === (stream === 'uk_rental' ? 'uk' : 'foreign'))
        .map(p => ({ id: p.id, label: p.address }));
  const allocValue = stream === 'sole' ? e.trade_id : e.property_id;
  // Picking a property brings its ownership share across from Setup — that's
  // where the firm records who owns what, so nobody should be retyping it per
  // row. A share typed by hand afterwards stays until the property changes again.
  const setAlloc = (v: string) =>
    onPatch(stream === 'sole'
      ? { trade_id: v || null }
      : { property_id: v || null, share_pct: shareForProperty(properties, v || null) });

  // The converted value of the gross shown in this row — before any co-owner
  // share, since it explains the FX rate sitting next to it, not the split.
  const gbpEquiv = showFx && e.currency !== 'GBP' ? grossGbp(e, fxRates) || null : null;

  // Auto-fill the HMRC monthly rate once the currency and a real date are both
  // in. Fills when the field is blank, and refreshes when the currency/month
  // changes IF the current value was itself auto-filled (_fxAutoKey matches the
  // old key). A hand-typed rate clears _fxAutoKey, so it's never overwritten.
  const canAutoFx = showFx && !readOnly && e.currency !== 'GBP' && !!e.entry_date;
  const fxTargetKey = canAutoFx ? fxKey(e.currency, e.entry_date!) : null;
  useEffect(() => {
    if (!fxTargetKey || !e.entry_date) return;
    const blank = e.fx_rate == null;
    const staleAuto = e._fxAutoKey != null && e._fxAutoKey !== fxTargetKey;
    if (!blank && !staleAuto) return; // a hand-typed value, or already correct
    let cancelled = false;
    fetchFxRate(e.currency, e.entry_date).then(rate => {
      if (cancelled || rate == null) return;
      onPatch({ fx_rate: rate, _fxAutoKey: fxTargetKey });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxTargetKey, e.fx_rate]);

  /** Manual edit of the rate — drops the auto marker so we stop refreshing it. */
  function onFxRateChange(raw: string) {
    onPatch({ fx_rate: raw === '' ? null : Number(raw), _fxAutoKey: null });
  }
  /** Re-pull the official HMRC rate, overriding a manual value on request. */
  function refetchFx() {
    if (!e.entry_date || e.currency === 'GBP') return;
    fetchFxRate(e.currency, e.entry_date).then(rate => {
      if (rate != null) onPatch({ fx_rate: rate, _fxAutoKey: fxKey(e.currency, e.entry_date!) });
    });
  }

  const rowTone = flagReason
    ? 'bg-amber-50/50 border-l-2 border-l-amber-400'
    : e._isNew ? 'bg-purple-50/30' : '';

  return (
    <>
      <tr className={`border-t border-gray-100 ${rowTone}`}>
        <Td>
          <DateInput
            value={e._dateText ?? fromIso(e.entry_date ?? '')}
            onChange={onDateChange}
            onBlur={onDateBlur}
            disabled={readOnly}
            previousDate={previousDate}
            ariaLabel="Entry date"
            data-row-id={e._localId}
            data-cell="date"
            className={CELL}
          />
        </Td>

        {/* Allocation. This is the field that decides which business the entry is
            filed against — an untagged row can be dropped from the filing, so it
            reads amber and is editable right here rather than behind a panel. */}
        <Td>
          <select
            value={allocValue ?? ''}
            onChange={ev => setAlloc(ev.target.value)}
            disabled={readOnly}
            aria-label={STREAM_META[stream].allocLabel}
            className={`${CELL} ${!allocValue ? 'text-amber-700 bg-amber-50/60' : ''}`}
          >
            <option value="">— Untagged —</option>
            {allocOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Td>

        {/* Category doubles as the Type control: picking from the other group
            moves the row between Income and Expenses. */}
        <Td>
          <select
            value={e.category}
            onChange={ev => onSetCategory(ev.target.value)}
            disabled={readOnly}
            aria-label="Category"
            className={CELL}
          >
            {typeForCategory(stream, e.category) === null && (
              <option value={e.category}>{e.category} (non-standard)</option>
            )}
            <optgroup label="Income">
              {categoriesForStream(stream, 'income').map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
            <optgroup label="Expense">
              {categoriesForStream(stream, 'expense').map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          </select>
        </Td>

        <Td>
          <input
            type="text"
            value={e.description ?? ''}
            onChange={ev => onPatch({ description: ev.target.value })}
            disabled={readOnly}
            placeholder="Description"
            aria-label="Description"
            className={CELL}
          />
        </Td>

        <Td>
          <input
            type="text"
            value={e.supplier ?? ''}
            onChange={ev => onPatch({ supplier: ev.target.value || null })}
            disabled={readOnly}
            placeholder="—"
            aria-label="Supplier"
            className={CELL}
          />
        </Td>

        <Td>
          <input
            type="text"
            value={e.invoice_number ?? ''}
            onChange={ev => onPatch({ invoice_number: ev.target.value || null })}
            disabled={readOnly}
            placeholder="—"
            aria-label="Invoice number"
            className={CELL}
          />
        </Td>

        {/* Net and VAT drive Gross — see grossFromParts. Editing either one
            re-totals the row so nobody adds up by hand. */}
        <Td>
          <input
            type="number" step="0.01"
            value={e.net_amount ?? ''}
            onChange={ev => {
              const net = parseOptionalMoney(ev.target.value);
              onPatch({ net_amount: net, gross_amount: grossFromParts(net, e.vat_amount) });
            }}
            disabled={readOnly}
            placeholder="—"
            aria-label="Net amount"
            className={CELL_NUM}
          />
        </Td>

        <Td>
          <input
            type="number" step="0.01"
            value={e.vat_amount ?? ''}
            onChange={ev => {
              const vat = parseOptionalMoney(ev.target.value);
              onPatch({ vat_amount: vat, gross_amount: grossFromParts(e.net_amount, vat) });
            }}
            disabled={readOnly}
            placeholder="—"
            aria-label="VAT amount"
            className={CELL_NUM}
          />
        </Td>

        <Td>
          <Tooltip label={
            e.net_amount != null || e.vat_amount != null
              ? 'Net + VAT. Edit net or VAT and this re-totals itself; type over it to override.'
              : 'Gross amount. Fill in net and/or VAT and this adds them up for you.'
          }>
            <input
              type="number" step="0.01"
              value={e.gross_amount}
              onChange={ev => onPatch({ gross_amount: parseMoney(ev.target.value, e.gross_amount) })}
              disabled={readOnly}
              aria-label="Gross amount"
              className={`${CELL_NUM} font-medium`}
            />
          </Tooltip>
        </Td>

        {showFx && (
          <Td>
            {/* Currency is a dropdown so the code always matches HMRC's, which is
                what the auto rate lookup keys on. Changing it re-pulls the rate
                (unless one was typed by hand). */}
            <select
              value={e.currency}
              onChange={ev => onPatch({ currency: ev.target.value })}
              disabled={readOnly}
              aria-label="Currency"
              className={`${CELL} font-mono`}
            >
              {currencyOptionsIncluding(e.currency).map(c => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </Td>
        )}

        {showFx && (
          <Td>
            <div className="flex items-center">
              <Tooltip label={
                e._fxAutoKey
                  ? `HMRC rate for ${e.currency} (${e._fxAutoKey.slice(4)})${gbpEquiv !== null ? ` · ≈ ${fmtMoney(gbpEquiv, 'GBP')}` : ''}. Type to override.`
                  : gbpEquiv !== null ? `≈ ${fmtMoney(gbpEquiv, 'GBP')} at this rate` : '1 unit → GBP'
              }>
                <input
                  type="number" step="0.0001"
                  value={e.fx_rate ?? ''}
                  onChange={ev => onFxRateChange(ev.target.value)}
                  disabled={readOnly}
                  placeholder={fxRates[e.currency] ? String(fxRates[e.currency]) : '—'}
                  aria-label="FX rate (1 unit to GBP)"
                  className={`${CELL_NUM} ${e._fxAutoKey ? 'text-emerald-700' : ''}`}
                />
              </Tooltip>
              {!readOnly && e.currency !== 'GBP' && e.entry_date && (
                <Tooltip label="Pull the official HMRC monthly rate for this currency and date">
                  <button
                    onClick={refetchFx}
                    aria-label="Use HMRC rate"
                    className="p-0.5 rounded text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 shrink-0"
                  ><RefreshCw size={11} /></button>
                </Tooltip>
              )}
            </div>
          </Td>
        )}

        {showShare && (
          <Td>
            <Tooltip label="The client's ownership share of this property. The reported figure is this percentage of the gross.">
              <input
                type="number" min={0} max={100} step={1}
                value={e.share_pct}
                onChange={ev => onPatch({ share_pct: Math.max(0, Math.min(100, parseMoney(ev.target.value, e.share_pct))) })}
                disabled={readOnly}
                aria-label="Ownership share percentage"
                className={`${CELL_NUM} ${e.share_pct < 100 ? 'text-indigo-700 font-medium' : ''}`}
              />
            </Tooltip>
          </Td>
        )}

        <Td>
          <div className="flex items-center justify-end gap-0.5 pr-1">
            {e.source_file_name && (
              <Tooltip label={`View source: ${e.source_file_name}${e.page_number ? ` · p.${e.page_number}` : ''}`}>
                <button
                  onClick={() => onViewSource(e.source_file_name!, e.page_number)}
                  aria-label="View source document"
                  className="p-1 rounded text-gray-400 hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                ><Eye size={12} /></button>
              </Tooltip>
            )}
            {e.drive_link && (
              <Tooltip label="Open the source document in Google Drive">
                <a
                  href={e.drive_link} target="_blank" rel="noopener noreferrer"
                  aria-label="Open in Google Drive"
                  className="p-1 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                ><ExternalLink size={12} /></a>
              </Tooltip>
            )}
            {!readOnly && (
              <>
                <Tooltip label={flagReason ? 'Clear flag' : 'Flag for review'}>
                  <button
                    onClick={onToggleFlag}
                    aria-label={flagReason ? 'Clear flag' : 'Flag for review'}
                    className={`p-1 rounded transition-colors ${flagReason ? 'text-amber-600 hover:bg-amber-100' : 'text-gray-300 hover:text-amber-600 hover:bg-amber-50'}`}
                  >{flagReason ? <Flag size={12} /> : <FlagOff size={12} />}</button>
                </Tooltip>
                <Tooltip label="Delete entry">
                  <button
                    onClick={onDelete}
                    aria-label="Delete entry"
                    // Tab off the last cell of the last row appends a fresh row,
                    // so a long manual entry session never needs the mouse.
                    onKeyDown={ev => {
                      if (ev.key === 'Tab' && !ev.shiftKey && isLastOfAll) {
                        ev.preventDefault();
                        onTabOffEnd();
                      }
                    }}
                    className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                  ><Trash2 size={12} /></button>
                </Tooltip>
              </>
            )}
          </div>
        </Td>
      </tr>

      {/* Why this row is flagged — inline, under the row it belongs to, so the
          reader never has to go looking for it in another tab. */}
      {flagReason && (
        <tr className={rowTone}>
          <td colSpan={20} className="px-2 pb-1.5 pt-0">
            <div className="flex items-start gap-1.5 text-[11px] text-amber-800 pl-1">
              <Flag size={10} className="shrink-0 mt-0.5" />
              <span className="flex-1">{flagReason}</span>
              {!readOnly && (
                <button onClick={onToggleFlag} className="text-amber-700 hover:underline shrink-0">
                  Clear flag
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="p-0 border-r border-gray-100 last:border-r-0 align-middle">{children}</td>;
}
