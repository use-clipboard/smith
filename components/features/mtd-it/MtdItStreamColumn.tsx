'use client';

import { useMemo, useState } from 'react';
import {
  Plus, Trash2, Flag, FlagOff, ChevronDown, ChevronRight,
  FileText, Briefcase, House, Globe2, Layers, Eye, ExternalLink,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import {
  SOLE_TRADER_INCOME, SOLE_TRADER_EXPENSES,
  UK_RENTAL_INCOME, UK_RENTAL_EXPENSES,
} from '@/lib/mtdIt/categories';
import type { MtdItStream, MtdItProperty, MtdItTrade } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────
// EditorEntry mirrors the mtd_it_entries DB row plus a few editor-only fields:
//   - _localId  : stable client-side key
//   - _isNew    : true if this row hasn't been INSERTed yet
//   - _dirty    : true if the row has been edited locally since last save
//   - _deleted  : true if the user marked the row for deletion
export interface EditorEntry {
  _localId: string;
  _isNew?: boolean;
  _dirty?: boolean;
  _deleted?: boolean;
  flag_dismissed?: boolean;

  id?: string;
  stream: MtdItStream;
  trade_id: string | null;
  property_id: string | null;
  source_file_name: string | null;
  page_number: number | null;
  entry_date: string | null;
  description: string | null;
  supplier: string | null;
  invoice_number: string | null;
  category: string;
  entry_type: 'income' | 'expense';
  gross_amount: number;
  net_amount: number | null;
  vat_amount: number | null;
  currency: string;
  fx_rate: number | null;
  gbp_amount: number | null;
  share_pct: number;
  manual: boolean;
  flagged_reason: string | null;
  drive_link: string | null;
}

interface Props {
  stream: MtdItStream;
  entries: EditorEntry[];
  properties: MtdItProperty[];
  trades: MtdItTrade[];
  fxRates: Record<string, number>;
  consolidated: boolean;
  onChange: (next: EditorEntry[]) => void;
  pushHistory: () => void;
  /** Read-only: rows can be opened/viewed and source docs inspected, but no
   *  field is editable and the add/delete/flag affordances are hidden. Used for
   *  filed/approved quarters. */
  readOnly?: boolean;
  /** Open the source-document viewer for the given filename. Only rows with
   *  a source_file_name show the View source button — manual entries don't. */
  onViewSource: (fileName: string, pageNumber: number | null) => void;
}

const STREAM_META: Record<MtdItStream, { label: string; Icon: typeof Briefcase; bg: string; border: string; chip: string; accent: string }> = {
  sole:           { label: 'Sole Trader',     Icon: Briefcase, bg: 'bg-orange-50',   border: 'border-orange-200',   chip: 'bg-orange-100 text-orange-800',   accent: 'text-orange-700' },
  uk_rental:      { label: 'UK Rental',       Icon: House,     bg: 'bg-blue-50',     border: 'border-blue-200',     chip: 'bg-blue-100 text-blue-800',       accent: 'text-blue-700'   },
  foreign_rental: { label: 'Foreign Rental',  Icon: Globe2,    bg: 'bg-emerald-50',  border: 'border-emerald-200',  chip: 'bg-emerald-100 text-emerald-800', accent: 'text-emerald-700' },
};

function categoriesForStream(stream: MtdItStream, type: 'income' | 'expense'): readonly string[] {
  if (stream === 'sole') return type === 'income' ? SOLE_TRADER_INCOME : SOLE_TRADER_EXPENSES;
  return type === 'income' ? UK_RENTAL_INCOME : UK_RENTAL_EXPENSES;
}

function emptyEntry(stream: MtdItStream, type: 'income' | 'expense' = 'expense', category?: string): EditorEntry {
  return {
    _localId: `tmp_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    _isNew: true,
    _dirty: true,
    stream,
    trade_id: null,
    property_id: null,
    source_file_name: null,
    page_number: null,
    entry_date: null,
    description: null,
    supplier: null,
    invoice_number: null,
    category: category ?? categoriesForStream(stream, type)[0],
    entry_type: type,
    gross_amount: 0,
    net_amount: null,
    vat_amount: null,
    currency: stream === 'foreign_rental' ? 'EUR' : 'GBP',
    fx_rate: null,
    gbp_amount: null,
    share_pct: 100,
    manual: true,
    flagged_reason: null,
    drive_link: null,
  };
}

// Always renders as £X,XXX.XX (or equivalent for non-GBP currencies). Min + max
// fraction digits are pinned to 2 so we never get £1,234.5 inconsistencies.
function fmtMoney(amount: number, currency: string = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function isFlagged(e: EditorEntry): boolean {
  return !!e.flagged_reason && !e.flag_dismissed;
}

export default function MtdItStreamColumn({ stream, entries, properties, trades, fxRates, consolidated, onChange, pushHistory, readOnly = false, onViewSource }: Props) {
  const M = STREAM_META[stream];
  const visible = entries.filter(e => !e._deleted);

  // ── Split entries into income / expense / flagged ────────────────────
  // Flagged rows live in their own bucket regardless of type/category. Headline
  // totals deliberately exclude them — they're not "clean" until reviewed.
  const flagged   = visible.filter(isFlagged);
  const cleanRows = visible.filter(e => !isFlagged(e));
  const incomes   = cleanRows.filter(e => e.entry_type === 'income');
  const expenses  = cleanRows.filter(e => e.entry_type === 'expense');

  const totalIncome  = incomes.reduce((a, e) => a + (e.gross_amount || 0), 0);
  const totalExpense = expenses.reduce((a, e) => a + (e.gross_amount || 0), 0);
  const totalFlagged = flagged.reduce((a, e) => a + (e.gross_amount || 0), 0);
  const net = totalIncome - totalExpense;

  // ── Active tab + per-category collapse state ─────────────────────────
  // The three top-level sections (Income, Expense, Flagged) are now a tab
  // bar — exactly one is visible at a time. Categories inside Income /
  // Expense are still independently collapsible.
  type Tab = 'income' | 'expense' | 'flagged';
  const [tab, setTab] = useState<Tab>('income');
  const [openCat, setOpenCat] = useState<Record<string, boolean>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  function toggleCat(key: string) {
    setOpenCat(prev => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }

  // ── Mutations ────────────────────────────────────────────────────────
  function patch(localId: string, p: Partial<EditorEntry>) {
    pushHistory();
    onChange(entries.map(e => e._localId === localId ? { ...e, ...p, _dirty: true } : e));
  }
  function toggleFlag(localId: string) {
    pushHistory();
    onChange(entries.map(e => {
      if (e._localId !== localId) return e;
      if (isFlagged(e)) {
        // Currently flagged → clear it
        return { ...e, flagged_reason: null, flag_dismissed: true, _dirty: true };
      }
      // Not flagged → manually flag it
      return { ...e, flagged_reason: 'Manually flagged for review', flag_dismissed: false, _dirty: true };
    }));
  }
  function deleteEntry(localId: string) {
    pushHistory();
    onChange(entries.map(e => e._localId === localId ? { ...e, _deleted: true, _dirty: true } : e));
    if (expandedRow === localId) setExpandedRow(null);
  }
  function addEntry(type: 'income' | 'expense', category?: string) {
    pushHistory();
    const fresh = emptyEntry(stream, type, category);
    onChange([...entries, fresh]);
    setExpandedRow(fresh._localId);
    // Switch to the right tab so the user sees the new row immediately.
    setTab(type);
    if (category) setOpenCat(p => ({ ...p, [`${type}|${category}`]: true }));
  }

  // ── Group clean rows by category for the section render ──────────────
  const incomeByCategory  = useMemo(() => groupByCategory(incomes),  [incomes]);
  const expenseByCategory = useMemo(() => groupByCategory(expenses), [expenses]);

  return (
    <section className={`border-2 ${M.border} rounded-xl bg-white shadow-sm overflow-hidden flex flex-col`}>
      {/* Header — stream identity + green/red + circles for quick adds */}
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
                className="w-6 h-6 rounded-full bg-green-100 text-green-700 hover:bg-green-200 inline-flex items-center justify-center transition-colors shrink-0"
              ><Plus size={13} strokeWidth={2.5} /></button>
            </Tooltip>
            <Tooltip label="Add expense entry">
              <button
                onClick={() => addEntry('expense')}
                aria-label="Add expense entry"
                className="w-6 h-6 rounded-full bg-red-100 text-red-700 hover:bg-red-200 inline-flex items-center justify-center transition-colors shrink-0"
              ><Plus size={13} strokeWidth={2.5} /></button>
            </Tooltip>
          </>
        )}
      </header>

      {/* Totals strip — flagged is shown separately and is NOT in income/expense */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-gray-100 text-xs">
        <Total label="Income"  value={totalIncome}  tone="text-green-700" />
        <Total label="Expense" value={totalExpense} tone="text-red-700" />
        <Total label="Net"     value={net}          tone={net >= 0 ? 'text-gray-800' : 'text-red-700'} />
      </div>

      {/* Tab bar — Income / Expenses / Flagged with counts */}
      <div className="flex border-b border-gray-200 bg-gray-50/60">
        <TabButton
          label="Income"
          count={incomes.length}
          tone="green"
          active={tab === 'income'}
          onClick={() => setTab('income')}
        />
        <TabButton
          label="Expenses"
          count={expenses.length}
          tone="red"
          active={tab === 'expense'}
          onClick={() => setTab('expense')}
        />
        <TabButton
          label="Flagged"
          count={flagged.length}
          tone="amber"
          active={tab === 'flagged'}
          onClick={() => setTab('flagged')}
        />
      </div>

      {/* Tab body */}
      <div className="flex-1 min-h-[80px]">
        {tab === 'income' && (
          // Empty state shows the add-entry hint in BOTH consolidated and
          // itemised modes — only branch on `consolidated` once there are rows
          // to lay out (flat list vs per-category groups).
          incomes.length === 0 ? (
            <EmptyTabHint type="income" onAdd={() => addEntry('income')} readOnly={readOnly} />
          ) : consolidated ? (
            <CategoryBody
              entries={incomes}
              stream={stream}
              properties={properties}
              trades={trades}
              fxRates={fxRates}
              consolidated={consolidated}
              expandedRow={expandedRow}
              readOnly={readOnly}
              onToggleRow={(id) => setExpandedRow(expandedRow === id ? null : id)}
              onPatch={patch}
              onToggleFlag={toggleFlag}
              onDelete={deleteEntry}
              onViewSource={onViewSource}
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {incomeByCategory.map(([category, rows]) => (
                <CategoryGroup
                  key={`income|${category}`}
                  category={category}
                  type="income"
                  readOnly={readOnly}
                  rows={rows}
                  open={openCat[`income|${category}`] ?? true}
                  onToggle={() => toggleCat(`income|${category}`)}
                  onAdd={() => addEntry('income', category)}
                >
                  <CategoryBody
                    entries={rows}
                    stream={stream}
                    properties={properties}
                    trades={trades}
                    fxRates={fxRates}
                    consolidated={consolidated}
                    expandedRow={expandedRow}
                    readOnly={readOnly}
              onToggleRow={(id) => setExpandedRow(expandedRow === id ? null : id)}
                    onPatch={patch}
                    onToggleFlag={toggleFlag}
                    onDelete={deleteEntry}
                    onViewSource={onViewSource}
                  />
                </CategoryGroup>
              ))}
            </div>
          )
        )}

        {tab === 'expense' && (
          expenses.length === 0 ? (
            <EmptyTabHint type="expense" onAdd={() => addEntry('expense')} readOnly={readOnly} />
          ) : consolidated ? (
            <CategoryBody
              entries={expenses}
              stream={stream}
              properties={properties}
              trades={trades}
              fxRates={fxRates}
              consolidated={consolidated}
              expandedRow={expandedRow}
              readOnly={readOnly}
              onToggleRow={(id) => setExpandedRow(expandedRow === id ? null : id)}
              onPatch={patch}
              onToggleFlag={toggleFlag}
              onDelete={deleteEntry}
              onViewSource={onViewSource}
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {expenseByCategory.map(([category, rows]) => (
                <CategoryGroup
                  key={`expense|${category}`}
                  category={category}
                  type="expense"
                  readOnly={readOnly}
                  rows={rows}
                  open={openCat[`expense|${category}`] ?? true}
                  onToggle={() => toggleCat(`expense|${category}`)}
                  onAdd={() => addEntry('expense', category)}
                >
                  <CategoryBody
                    entries={rows}
                    stream={stream}
                    properties={properties}
                    trades={trades}
                    fxRates={fxRates}
                    consolidated={consolidated}
                    expandedRow={expandedRow}
                    readOnly={readOnly}
              onToggleRow={(id) => setExpandedRow(expandedRow === id ? null : id)}
                    onPatch={patch}
                    onToggleFlag={toggleFlag}
                    onDelete={deleteEntry}
                    onViewSource={onViewSource}
                  />
                </CategoryGroup>
              ))}
            </div>
          )
        )}

        {tab === 'flagged' && (
          flagged.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-gray-500 italic">
              No flagged entries — everything is clean.
            </p>
          ) : (
            <>
              <p className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100">
                <strong>{flagged.length}</strong> flagged {flagged.length === 1 ? 'entry' : 'entries'} (<span className="tabular-nums">{fmtMoney(totalFlagged)}</span>) excluded from Income / Expense totals — clear the flag or fix the issue to move them back in.
              </p>
              <CategoryBody
                entries={flagged}
                stream={stream}
                properties={properties}
                trades={trades}
                fxRates={fxRates}
                consolidated={consolidated}
                expandedRow={expandedRow}
                readOnly={readOnly}
              onToggleRow={(id) => setExpandedRow(expandedRow === id ? null : id)}
                onPatch={patch}
                onToggleFlag={toggleFlag}
                onDelete={deleteEntry}
                onViewSource={onViewSource}
                showFlagReasonBanner
              />
            </>
          )
        )}
      </div>
    </section>
  );
}

// ── Tab button (used in the per-stream tab bar) ───────────────────────
function TabButton({ label, count, tone, active, onClick }: {
  label: string;
  count: number;
  tone: 'green' | 'red' | 'amber';
  active: boolean;
  onClick: () => void;
}) {
  // Each tab paints its bottom border + text in its tone colour when active.
  const toneActive: Record<typeof tone, string> = {
    green: 'border-green-600 text-green-800',
    red:   'border-red-600   text-red-800',
    amber: 'border-amber-600 text-amber-800',
  };
  const countBadgeTone: Record<typeof tone, string> = {
    green: active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600',
    red:   active ? 'bg-red-100   text-red-800'   : 'bg-gray-100 text-gray-600',
    amber: active ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600',
  };
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border-b-2 transition-colors ${
        active
          ? `bg-white ${toneActive[tone]}`
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'
      }`}
    >
      {label}
      <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium normal-case tracking-normal ${countBadgeTone[tone]}`}>
        {count}
      </span>
    </button>
  );
}

// Inline empty-state hint used inside each tab when no rows live there yet.
function EmptyTabHint({ type, onAdd, readOnly = false }: { type: 'income' | 'expense'; onAdd: () => void; readOnly?: boolean }) {
  const tone = type === 'income'
    ? 'text-green-700 hover:bg-green-50'
    : 'text-red-700 hover:bg-red-50';
  return (
    <div className="px-4 py-8 flex flex-col items-center gap-2">
      <p className="text-xs text-gray-500 italic">No {type} entries.</p>
      {!readOnly && (
        <button
          onClick={onAdd}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-current/20 ${tone}`}
        >
          <Plus size={12} /> Add {type} entry
        </button>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────
function groupByCategory(entries: EditorEntry[]): Array<[string, EditorEntry[]]> {
  const m = new Map<string, EditorEntry[]>();
  for (const e of entries) {
    const arr = m.get(e.category) ?? [];
    arr.push(e);
    m.set(e.category, arr);
  }
  return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
}

// ── Totals chip ────────────────────────────────────────────────────────
function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`font-medium tabular-nums ${tone}`}>{fmtMoney(value)}</div>
    </div>
  );
}


// ── Category sub-group (e.g. "Turnover", "Cost of Goods Bought") ───────
function CategoryGroup({
  category, rows, open, onToggle, onAdd, type, readOnly = false, children,
}: {
  category: string;
  type: 'income' | 'expense';
  rows: EditorEntry[];
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const total = rows.reduce((a, e) => a + (e.gross_amount || 0), 0);
  return (
    <div className="pl-2 border-l-2 border-gray-100">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-gray-50/70 transition-colors"
      >
        {open ? <ChevronDown size={10} className="text-gray-500" /> : <ChevronRight size={10} className="text-gray-500" />}
        <Layers size={10} className="text-gray-400" />
        <span className="font-medium text-gray-700">{category}</span>
        <span className="text-[10px] text-gray-400">· {rows.length}</span>
        <span className="ml-auto tabular-nums text-gray-700 font-medium">{fmtMoney(total)}</span>
        {!readOnly && (
          <Tooltip label={`Add ${type} entry to ${category}`}>
            <span
              role="button"
              aria-label={`Add ${type} entry to ${category}`}
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className="ml-1 p-0.5 rounded hover:bg-gray-200 text-gray-500"
            ><Plus size={10} /></span>
          </Tooltip>
        )}
      </button>
      {open && <div className="divide-y divide-gray-50">{children}</div>}
    </div>
  );
}

// ── Category body: list of rows in a category (or flagged section) ─────
function CategoryBody(props: {
  entries: EditorEntry[];
  stream: MtdItStream;
  properties: MtdItProperty[];
  trades: MtdItTrade[];
  fxRates: Record<string, number>;
  consolidated: boolean;
  expandedRow: string | null;
  showFlagReasonBanner?: boolean;
  readOnly?: boolean;
  onToggleRow: (id: string) => void;
  onPatch: (id: string, p: Partial<EditorEntry>) => void;
  onToggleFlag: (id: string) => void;
  onDelete: (id: string) => void;
  onViewSource: (fileName: string, pageNumber: number | null) => void;
}) {
  const { entries, stream, properties, trades, fxRates, consolidated, expandedRow, showFlagReasonBanner, readOnly = false, onToggleRow, onPatch, onToggleFlag, onDelete, onViewSource } = props;
  if (entries.length === 0) {
    return <p className="px-4 py-2 text-[11px] text-gray-400 italic">No entries.</p>;
  }
  return (
    <>
      {entries.map(e => (
        <EntryRow
          key={e._localId}
          entry={e}
          stream={stream}
          properties={properties}
          trades={trades}
          fxRates={fxRates}
          consolidated={consolidated}
          expanded={expandedRow === e._localId}
          showFlagReasonBanner={showFlagReasonBanner}
          readOnly={readOnly}
          onToggleExpand={() => onToggleRow(e._localId)}
          onPatch={p => onPatch(e._localId, p)}
          onToggleFlag={() => onToggleFlag(e._localId)}
          onDelete={() => onDelete(e._localId)}
          onViewSource={onViewSource}
        />
      ))}
    </>
  );
}

// ── Per-entry row ──────────────────────────────────────────────────────
function EntryRow(props: {
  entry: EditorEntry;
  stream: MtdItStream;
  properties: MtdItProperty[];
  trades: MtdItTrade[];
  fxRates: Record<string, number>;
  consolidated: boolean;
  expanded: boolean;
  showFlagReasonBanner?: boolean;
  readOnly?: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<EditorEntry>) => void;
  onToggleFlag: () => void;
  onDelete: () => void;
  onViewSource: (fileName: string, pageNumber: number | null) => void;
}) {
  const { entry: e, stream, properties, trades, fxRates, consolidated, expanded, showFlagReasonBanner, readOnly = false, onToggleExpand, onPatch, onToggleFlag, onDelete, onViewSource } = props;
  const flagged = isFlagged(e);

  const gbpEquiv = stream === 'foreign_rental' && e.currency !== 'GBP'
    ? (e.gross_amount * (e.fx_rate ?? fxRates[e.currency] ?? 0)) || null
    : null;

  return (
    <div className={`pl-3 pr-3 py-1.5 ${e._isNew ? 'bg-purple-50/40' : ''} ${flagged ? 'border-l-2 border-l-amber-400' : ''}`}>
      <div className="flex items-center gap-2">
        {/* Date */}
        <input
          type="date"
          value={e.entry_date ?? ''}
          onChange={ev => onPatch({ entry_date: ev.target.value || null })}
          disabled={readOnly}
          className="text-xs px-1.5 py-0.5 border border-gray-200 rounded bg-white w-[112px] shrink-0 disabled:bg-gray-50 disabled:text-gray-600"
        />

        {/* Allocated property (rental) / trade (sole) — shows what this entry is
            tagged to at a glance; the allocation is editable in the expanded
            details. Untagged rows read amber so they stand out. */}
        {(() => {
          const AllocIcon = STREAM_META[stream].Icon;
          const allocName = stream === 'sole'
            ? (trades.find(t => t.id === e.trade_id)?.name ?? null)
            : (properties.find(p => p.id === e.property_id)?.address ?? null);
          return (
            <Tooltip label={allocName
              ? `Allocated to: ${allocName}`
              : `Not allocated to a specific ${stream === 'sole' ? 'trade' : 'property'} — set it in the row details`}>
              <span className={`hidden md:inline-flex items-center gap-1 shrink-0 max-w-[132px] px-1.5 py-0.5 rounded text-[10px] ${allocName ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}>
                <AllocIcon size={10} className="shrink-0" />
                <span className="truncate">{allocName ?? 'Untagged'}</span>
              </span>
            </Tooltip>
          );
        })()}

        {/* Description (full-width) */}
        <input
          type="text"
          value={e.description ?? ''}
          onChange={ev => onPatch({ description: ev.target.value })}
          onFocus={() => { if (!expanded) onToggleExpand(); }}
          disabled={readOnly}
          placeholder="Description"
          className="flex-1 min-w-0 text-xs px-1.5 py-0.5 border border-gray-200 rounded bg-white disabled:bg-gray-50 disabled:text-gray-600"
        />

        {/* Supplier */}
        <input
          type="text"
          value={e.supplier ?? ''}
          onChange={ev => onPatch({ supplier: ev.target.value || null })}
          disabled={readOnly}
          placeholder="Supplier"
          aria-label="Supplier name"
          className="w-[120px] text-xs px-1.5 py-0.5 border border-gray-200 rounded bg-white shrink-0 disabled:bg-gray-50 disabled:text-gray-600"
        />

        {/* Invoice number */}
        <input
          type="text"
          value={e.invoice_number ?? ''}
          onChange={ev => onPatch({ invoice_number: ev.target.value || null })}
          disabled={readOnly}
          placeholder="Invoice no."
          aria-label="Invoice number"
          className="w-[104px] text-xs px-1.5 py-0.5 border border-gray-200 rounded bg-white shrink-0 disabled:bg-gray-50 disabled:text-gray-600"
        />

        {/* Amount */}
        <input
          type="number"
          step="0.01"
          value={e.gross_amount}
          onChange={ev => onPatch({ gross_amount: Number(ev.target.value) || 0 })}
          disabled={readOnly}
          className="w-[88px] text-xs px-1.5 py-0.5 border border-gray-200 rounded bg-white text-right tabular-nums shrink-0 disabled:bg-gray-50 disabled:text-gray-600"
          aria-label="Gross amount"
        />

        {/* Currency chip (foreign only) */}
        {stream === 'foreign_rental' && (
          <span className="text-[10px] font-mono uppercase shrink-0 px-1 py-0.5 rounded bg-gray-100 text-gray-600">{e.currency}</span>
        )}

        {/* View source — only visible when we have a saved source file */}
        {e.source_file_name && (
          <Tooltip label="View source document">
            <button
              onClick={() => onViewSource(e.source_file_name!, e.page_number)}
              aria-label="View source document"
              className="p-1 rounded text-gray-400 hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors shrink-0"
            ><Eye size={12} /></button>
          </Tooltip>
        )}

        {/* Open in Google Drive — set after a successful Save to records.
            Lets the user jump straight to the invoice without having to
            grep through their Drive folder. */}
        {e.drive_link && (
          <Tooltip label="Open the source document in Google Drive">
            <a
              href={e.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in Google Drive"
              className="p-1 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors shrink-0"
              onClick={ev => ev.stopPropagation()}
            ><ExternalLink size={12} /></a>
          </Tooltip>
        )}

        {/* Manual flag toggle — in read-only we still show a static flag marker
            on flagged rows (so the Flagged tab reads clearly), just not the
            interactive toggle. */}
        {readOnly ? (
          flagged && <span className="p-1 text-amber-600 shrink-0" aria-label="Flagged"><Flag size={12} /></span>
        ) : (
          <Tooltip label={flagged ? 'Clear flag' : 'Flag for review'}>
            <button
              onClick={onToggleFlag}
              aria-label={flagged ? 'Clear flag' : 'Flag entry for review'}
              className={`p-1 rounded transition-colors shrink-0 ${flagged ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-300 hover:text-amber-600 hover:bg-amber-50'}`}
            >
              {flagged ? <Flag size={12} /> : <FlagOff size={12} />}
            </button>
          </Tooltip>
        )}

        {/* Expand / collapse */}
        <Tooltip label={expanded ? 'Hide details' : 'Show details'}>
          <button
            onClick={onToggleExpand}
            aria-label={expanded ? 'Collapse row' : 'Expand row'}
            className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 shrink-0"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </Tooltip>

        {/* Delete — hidden in read-only */}
        {!readOnly && (
          <Tooltip label="Delete row">
            <button
              onClick={onDelete}
              aria-label="Delete row"
              className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 shrink-0"
            ><Trash2 size={12} /></button>
          </Tooltip>
        )}
      </div>

      {/* Flag reason banner — visible in the Flagged section so the user
          immediately sees WHY each row was flagged. */}
      {showFlagReasonBanner && flagged && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">
          <Flag size={11} className="shrink-0 mt-px" />
          <span className="flex-1">{e.flagged_reason}</span>
          {!readOnly && <button onClick={onToggleFlag} className="text-amber-700 hover:underline shrink-0">Clear flag</button>}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pl-1 space-y-2 animate-in fade-in duration-150">
          {/* A disabled fieldset makes every field below read-only in one shot
              (filed/approved quarters). The source-doc "View" button lives
              outside it, so it stays clickable. */}
          <fieldset disabled={readOnly} className="grid grid-cols-2 gap-2 m-0 p-0 border-0 min-w-0">
            <FieldRow label="Type">
              <select
                value={e.entry_type}
                onChange={ev => {
                  const next = ev.target.value as 'income' | 'expense';
                  // Reset category to the first valid one for the new type
                  const cats = categoriesForStream(stream, next);
                  onPatch({ entry_type: next, category: cats[0] });
                }}
                className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white"
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </FieldRow>

            {!consolidated && (
              <FieldRow label="Category">
                <select
                  value={e.category}
                  onChange={ev => onPatch({ category: ev.target.value })}
                  className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white"
                >
                  {categoriesForStream(stream, e.entry_type).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FieldRow>
            )}

            {(stream === 'uk_rental' || stream === 'foreign_rental') && (
              <FieldRow label="Property">
                <select
                  value={e.property_id ?? ''}
                  onChange={ev => onPatch({ property_id: ev.target.value || null })}
                  className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white"
                >
                  <option value="">— Untagged —</option>
                  {properties
                    .filter(p => p.property_type === (stream === 'uk_rental' ? 'uk' : 'foreign'))
                    .map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
                </select>
              </FieldRow>
            )}

            {stream === 'sole' && (
              <FieldRow label="Trade">
                <select
                  value={e.trade_id ?? ''}
                  onChange={ev => onPatch({ trade_id: ev.target.value || null })}
                  className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white"
                >
                  <option value="">— Untagged —</option>
                  {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </FieldRow>
            )}

            {(stream === 'uk_rental' || stream === 'foreign_rental') && (
              <FieldRow label="Share %">
                <input
                  type="number"
                  min={0} max={100} step={1}
                  value={e.share_pct}
                  onChange={ev => onPatch({ share_pct: Math.max(0, Math.min(100, Number(ev.target.value) || 0)) })}
                  className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white text-right tabular-nums"
                />
              </FieldRow>
            )}

            <FieldRow label="Net">
              <input
                type="number"
                step="0.01"
                value={e.net_amount ?? ''}
                onChange={ev => onPatch({ net_amount: ev.target.value === '' ? null : Number(ev.target.value) })}
                placeholder="—"
                className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white text-right tabular-nums"
              />
            </FieldRow>
            <FieldRow label="VAT">
              <input
                type="number"
                step="0.01"
                value={e.vat_amount ?? ''}
                onChange={ev => onPatch({ vat_amount: ev.target.value === '' ? null : Number(ev.target.value) })}
                placeholder="—"
                className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white text-right tabular-nums"
              />
            </FieldRow>

            {stream === 'foreign_rental' && (
              <>
                <FieldRow label="Currency">
                  <input
                    type="text"
                    value={e.currency}
                    maxLength={3}
                    onChange={ev => onPatch({ currency: ev.target.value.toUpperCase().slice(0, 3) })}
                    className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white font-mono uppercase"
                  />
                </FieldRow>
                <FieldRow label="FX rate (1 unit → GBP)">
                  <input
                    type="number"
                    step="0.0001"
                    value={e.fx_rate ?? fxRates[e.currency] ?? ''}
                    onChange={ev => onPatch({ fx_rate: ev.target.value === '' ? null : Number(ev.target.value) })}
                    placeholder={fxRates[e.currency] ? String(fxRates[e.currency]) : '—'}
                    className="w-full text-xs px-1.5 py-1 border border-gray-200 rounded bg-white text-right tabular-nums"
                  />
                </FieldRow>
              </>
            )}
          </fieldset>

          {/* Source file + flag info — read-only meta */}
          {(e.source_file_name || gbpEquiv !== null) && (
            <div className="space-y-1 pt-1 border-t border-gray-100">
              {e.source_file_name && (
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <FileText size={10} className="shrink-0" />
                  <span className="truncate">{e.source_file_name}{e.page_number ? ` · p.${e.page_number}` : ''}</span>
                  <button
                    onClick={() => onViewSource(e.source_file_name!, e.page_number)}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-[var(--accent)] hover:bg-[var(--accent-light)] rounded shrink-0"
                  >
                    <Eye size={10} /> View
                  </button>
                </div>
              )}
              {gbpEquiv !== null && (
                <div className="text-[10px] text-gray-500">
                  ≈ <span className="tabular-nums font-medium text-gray-700">{fmtMoney(gbpEquiv, 'GBP')}</span> at the supplied FX rate
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  );
}
