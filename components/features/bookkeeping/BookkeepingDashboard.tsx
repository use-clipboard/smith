'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookCopy, Plus, Search, Loader2, Lock, Archive as ArchiveIcon, FolderOpen, FolderClosed, Sparkles } from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
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
  const [modalOpen, setModalOpen] = useState(false);

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
      if (q) {
        const haystack = `${b.name} ${b.client?.name ?? ''} ${b.client?.client_ref ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [books, tab, templateFilter, search]);

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
      headerRight={
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 transition-colors"
        >
          <Plus size={14} />
          New book
        </button>
      }
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

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search book or client…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm pl-7 pr-3 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 w-64"
          />
        </div>

        <select
          value={templateFilter}
          onChange={e => setTemplateFilter(e.target.value as BookTemplateType | 'all')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
        >
          <option value="all">All templates</option>
          {BOOK_TEMPLATE_OPTIONS.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

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
                <th className="text-left px-4 py-3 font-semibold">Client</th>
                <th className="text-left px-4 py-3 font-semibold">Template</th>
                <th className="text-left px-4 py-3 font-semibold">VAT</th>
                <th className="text-left px-4 py-3 font-semibold">Currency</th>
                <th className="text-left px-4 py-3 font-semibold">Updated</th>
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
                  <td className="px-4 py-2.5 text-gray-700">
                    {b.client
                      ? <span>{b.client.name}{b.client.client_ref ? <span className="text-gray-400"> · {b.client.client_ref}</span> : null}</span>
                      : <span className="text-gray-400 italic">Unallocated</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${TEMPLATE_BADGE_CLASSES[b.template_type]}`}>
                      {BOOK_TEMPLATE_LABEL[b.template_type]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {b.vat_registered
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">VAT</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">{b.base_currency}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{formatDate(b.updated_at)}</td>
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
