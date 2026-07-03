'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookCopy, Plus, Search, Loader2, Lock, Archive as ArchiveIcon, FolderOpen, FolderClosed, Sparkles, Filter, SlidersHorizontal } from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { usePersistedColumns } from '@/lib/usePersistedColumns';
import NewBookModal from './NewBookModal';
import type { Book, BookTemplateType } from '@/types/bookkeeping';
import { BOOK_TEMPLATE_LABEL, BOOK_TEMPLATE_OPTIONS } from '@/types/bookkeeping';

// Tailwind doesn't support dynamic class names — static map per template
// so the JIT compiler emits the right utility classes at build time.
const TEMPLATE_BADGE_CLASSES: Record<BookTemplateType, string> = {
  ltd:            'bg-blue-50    text-blue-700    border-blue-200',
  llp:            'bg-indigo-50  text-indigo-700  border-indigo-200',
  partnership:    'bg-violet-50  text-violet-700  border-violet-200',
  sole_trader:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  trust:          'bg-amber-50   text-amber-700   border-amber-200',
  charity:        'bg-rose-50    text-rose-700    border-rose-200',
  basic:          'bg-slate-50   text-slate-700   border-slate-200',
};

// Client status → badge shown in the Client column and offered as a filter.
const CLIENT_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:   { label: 'Active',   cls: 'bg-green-100 text-green-700' },
  hold:     { label: 'On hold',  cls: 'bg-amber-100 text-amber-700' },
  inactive: { label: 'Inactive', cls: 'bg-gray-100 text-gray-500' },
};

// Toggleable table columns (the Book column is always shown). Persisted per user.
type ColKey = 'client' | 'template' | 'vat' | 'currency' | 'updated';
const COLUMNS: { key: ColKey; label: string; defaultVisible: boolean }[] = [
  { key: 'client',   label: 'Client',   defaultVisible: true },
  { key: 'template', label: 'Template', defaultVisible: true },
  { key: 'vat',      label: 'VAT',      defaultVisible: true },
  { key: 'currency', label: 'Currency', defaultVisible: true },
  { key: 'updated',  label: 'Updated',  defaultVisible: true },
];
const COLUMN_PREF_KEY = 'smith.bookkeeping.dashboard.columns';

type VatFilter = 'all' | 'yes' | 'no';
type StatusFilter = 'all' | 'active' | 'hold' | 'inactive';

type Tab = 'all' | 'allocated' | 'unallocated' | 'archived';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',         label: 'All' },
  { id: 'allocated',   label: 'Client books' },
  { id: 'unallocated', label: 'Unallocated' },
  { id: 'archived',    label: 'Archived' },
];

function formatDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface BookkeepingDashboardProps {
  /** Optional callback invoked when the user opens a book. If provided, the
   *  dashboard delegates navigation to the parent (used by the always-mounted
   *  BookkeepingTool wrapper to keep state alive). Falls back to a regular
   *  Next.js route push when omitted (direct URL access keeps working). */
  onOpenBook?: (bookId: string) => void;
}

export default function BookkeepingDashboard({ onOpenBook }: BookkeepingDashboardProps = {}) {
  const router = useRouter();
  const openBook = (bookId: string) => {
    if (onOpenBook) onOpenBook(bookId);
    else router.push(`/bookkeeping/${bookId}`);
  };
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [templateFilter, setTemplateFilter] = useState<BookTemplateType | 'all'>('all');
  const [vatFilter, setVatFilter] = useState<VatFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showColMenu, setShowColMenu] = useState(false);
  const [visibleCols, setVisibleCols] = usePersistedColumns(
    COLUMN_PREF_KEY,
    COLUMNS.map(c => c.key),
    COLUMNS.filter(c => c.defaultVisible).map(c => c.key),
  );
  const [modalOpen, setModalOpen] = useState(false);

  const colVisible = (k: ColKey) => visibleCols.has(k);
  const toggleCol = (k: ColKey) =>
    setVisibleCols(prev => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  const hasActiveFilters = templateFilter !== 'all' || vatFilter !== 'all' || statusFilter !== 'all';

  // ── Load books ──────────────────────────────────────────────────────────────
  const includeArchived = tab === 'archived';
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/bookkeeping/books?archived=${includeArchived ? 'true' : 'false'}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!cancelled) setBooks(d.books ?? []); })
      .catch(() => { if (!cancelled) setBooks([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [includeArchived]);

  function handleBookCreated(book: Book) {
    setModalOpen(false);
    // Drop the user straight into the new book — Phase 1 stub page for now
    openBook(book.id);
  }

  // ── Derived list ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return books.filter(b => {
      if (tab === 'allocated'   && !b.client_id) return false;
      if (tab === 'unallocated' && b.client_id)  return false;
      if (tab === 'archived'    && !b.archived)  return false;
      if (tab !== 'archived'    && b.archived)   return false;
      if (templateFilter !== 'all' && b.template_type !== templateFilter) return false;
      if (vatFilter === 'yes' && !b.vat_registered) return false;
      if (vatFilter === 'no'  &&  b.vat_registered) return false;
      if (statusFilter !== 'all' && (b.client?.status ?? '') !== statusFilter) return false;
      if (q) {
        const haystack = `${b.name} ${b.client?.name ?? ''} ${b.client?.client_ref ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [books, tab, templateFilter, vatFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const all   = books.filter(b => !b.archived).length;
    const alloc = books.filter(b => !b.archived && b.client_id).length;
    const unall = books.filter(b => !b.archived && !b.client_id).length;
    const arch  = books.filter(b =>  b.archived).length;
    return { all, allocated: alloc, unallocated: unall, archived: arch };
  }, [books]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <ToolLayout
      title="Bookkeeping"
      description="AI-powered bookkeeping."
      icon={BookCopy}
      iconColor="#4F46E5"
      wide
    >
      {/* Stats strip — at-a-glance counts. Active state shown by a thin
          coloured border + matching icon tile, no heavy ring shadow. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {([
          { id: 'all',         label: 'All books',    count: counts.all,         icon: BookCopy,      tone: 'indigo'  as const },
          { id: 'allocated',   label: 'Client books', count: counts.allocated,   icon: FolderClosed,  tone: 'emerald' as const },
          { id: 'unallocated', label: 'Unallocated',  count: counts.unallocated, icon: FolderOpen,    tone: 'amber'   as const },
          { id: 'archived',    label: 'Archived',     count: counts.archived,    icon: ArchiveIcon,   tone: 'slate'   as const },
        ] as const).map(s => {
          const Icon = s.icon;
          const active = tab === s.id;
          const tones: Record<typeof s.tone, { iconBg: string; iconText: string; activeBorder: string }> = {
            indigo:  { iconBg: 'bg-indigo-50',  iconText: 'text-indigo-600',  activeBorder: 'border-indigo-300'  },
            emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', activeBorder: 'border-emerald-300' },
            amber:   { iconBg: 'bg-amber-50',   iconText: 'text-amber-600',   activeBorder: 'border-amber-300'   },
            slate:   { iconBg: 'bg-slate-100',  iconText: 'text-slate-600',   activeBorder: 'border-slate-300'   },
          };
          const t = tones[s.tone];
          return (
            <button
              key={s.id}
              onClick={() => setTab(s.id as Tab)}
              className={`text-left rounded-xl border bg-white p-3 shadow-sm transition-colors ${
                active ? `${t.activeBorder}` : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg ${t.iconBg} ${t.iconText} flex items-center justify-center shrink-0`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{s.label}</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums leading-tight">{s.count}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar — search · Filter · Columns · New book */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search book or client…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm pl-7 pr-3 h-9 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 w-64"
          />
        </div>

        {/* Filter */}
        <Tooltip label="Filters">
          <button
            onClick={() => setShowFilters(v => !v)}
            aria-label="Toggle filters"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Filter size={13} />
            <span>Filter</span>
            {hasActiveFilters && <span className="text-[10px] font-bold">· on</span>}
          </button>
        </Tooltip>

        {/* Columns */}
        <div className="relative">
          <Tooltip label="Show / hide columns">
            <button
              onClick={() => setShowColMenu(v => !v)}
              aria-label="Show or hide columns"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border bg-white border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-semibold transition-colors"
            >
              <SlidersHorizontal size={13} />
              <span>Columns</span>
            </button>
          </Tooltip>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowColMenu(false)} />
              <div className="absolute left-0 mt-2 z-40 w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 px-2 py-1">Columns</p>
                {COLUMNS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={colVisible(c.key)} onChange={() => toggleCol(c.key)} className="rounded" />
                    <span className="text-sm text-gray-700">{c.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 transition-colors ml-auto"
        >
          <Plus size={14} />
          New book
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Template</label>
            <select
              value={templateFilter}
              onChange={e => setTemplateFilter(e.target.value as BookTemplateType | 'all')}
              className="text-sm border border-gray-200 rounded-lg px-3 h-9 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            >
              <option value="all">All templates</option>
              {BOOK_TEMPLATE_OPTIONS.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">VAT</label>
            <select
              value={vatFilter}
              onChange={e => setVatFilter(e.target.value as VatFilter)}
              className="text-sm border border-gray-200 rounded-lg px-3 h-9 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            >
              <option value="all">Any VAT status</option>
              <option value="yes">VAT registered</option>
              <option value="no">Not registered</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Client status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="text-sm border border-gray-200 rounded-lg px-3 h-9 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
            >
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="hold">On hold</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => { setTemplateFilter('all'); setVatFilter('all'); setStatusFilter('all'); }}
              className="text-xs text-gray-400 hover:text-gray-700 underline ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={16} className="animate-spin mr-2" />
          Loading books…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
          {books.length === 0 ? (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-indigo-50 text-indigo-600 mb-3">
                <Sparkles size={20} />
              </div>
              <p className="text-sm font-medium text-slate-900 mb-1">No books yet</p>
              <p className="text-xs text-slate-500">Click <span className="font-medium text-indigo-700">New book</span> to create the first one.</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">No books match the current filters.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-b from-gray-50 to-white text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Book</th>
                {colVisible('client')   && <th className="text-left px-4 py-3 font-semibold">Client</th>}
                {colVisible('template') && <th className="text-left px-4 py-3 font-semibold">Template</th>}
                {colVisible('vat')      && <th className="text-left px-4 py-3 font-semibold">VAT</th>}
                {colVisible('currency') && <th className="text-left px-4 py-3 font-semibold">Currency</th>}
                {colVisible('updated')  && <th className="text-left px-4 py-3 font-semibold">Updated</th>}
                <th className="text-right px-4 py-3 font-semibold">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <tr
                  key={b.id}
                  onClick={() => openBook(b.id)}
                  className="border-t border-gray-100 hover:bg-indigo-50/50 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 group-hover:text-indigo-700 transition-colors">{b.name}</span>
                      {b.admin_locked && (
                        <Tooltip label="Admin-locked — only admins can edit">
                          <Lock size={12} className="text-amber-600" />
                        </Tooltip>
                      )}
                      {b.archived && (
                        <Tooltip label="Archived">
                          <ArchiveIcon size={12} className="text-gray-400" />
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  {colVisible('client') && (
                    <td className="px-4 py-2.5 text-gray-700">
                      {b.client ? (
                        <div className="flex items-center gap-2">
                          <span>{b.client.name}{b.client.client_ref ? <span className="text-gray-400"> · {b.client.client_ref}</span> : null}</span>
                          {b.client.status && CLIENT_STATUS_BADGE[b.client.status] && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${CLIENT_STATUS_BADGE[b.client.status].cls}`}>
                              {CLIENT_STATUS_BADGE[b.client.status].label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">Unallocated</span>
                      )}
                    </td>
                  )}
                  {colVisible('template') && (
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${TEMPLATE_BADGE_CLASSES[b.template_type]}`}>
                        {BOOK_TEMPLATE_LABEL[b.template_type]}
                      </span>
                    </td>
                  )}
                  {colVisible('vat') && (
                    <td className="px-4 py-2.5">
                      {b.vat_registered
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">VAT</span>
                        : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                  )}
                  {colVisible('currency') && <td className="px-4 py-2.5 text-gray-600 text-xs">{b.base_currency}</td>}
                  {colVisible('updated')  && <td className="px-4 py-2.5 text-gray-500 text-xs">{formatDate(b.updated_at)}</td>}
                  <td className="px-4 py-2.5 text-right text-xs text-gray-300 group-hover:text-indigo-500 transition-colors">Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <NewBookModal
          onClose={() => setModalOpen(false)}
          onCreated={handleBookCreated}
        />
      )}
    </ToolLayout>
  );
}
