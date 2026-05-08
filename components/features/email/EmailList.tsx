'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Loader2, RefreshCw, Paperclip, AlertTriangle, Reply, Forward,
  UserPlus, CheckSquare, Search, Star, Trash2, X, Pin,
  SlidersHorizontal, MailOpen, Square,
} from 'lucide-react';
import type { EmailThread } from '@/lib/gmail';

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (isThisYear) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

interface Props {
  threads: EmailThread[];
  activeThreadId: string | null;
  loading: boolean;
  error?: string | null;
  threadMeta?: Record<string, { hasAllocation: boolean; hasTaskLink: boolean; isReplied?: boolean; isForwarded?: boolean; reactions?: string[] }>;
  searchQuery: string;
  onSearch: (q: string) => void;
  onSelect: (thread: EmailThread) => void;
  onRefresh: () => void;
  onStar: (threadId: string, starred: boolean) => void;
  onDelete: (threadId: string) => void;
  hasNextPage: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  pinnedIds?: Set<string>;
  onPin?: (threadId: string, pin: boolean) => void;
  forwardedThreadIds?: Set<string>;
  repliedThreadIds?: Set<string>;
  onBulkDelete?: (ids: string[]) => void;
  onBulkMarkRead?: (ids: string[]) => void;
}

export default function EmailList({
  threads, activeThreadId, loading, error, threadMeta, searchQuery, onSearch,
  onSelect, onRefresh, onStar, onDelete, hasNextPage, onLoadMore, loadingMore,
  pinnedIds, onPin, forwardedThreadIds, repliedThreadIds, onBulkDelete, onBulkMarkRead,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);

  // Filter / sort state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);    // true = newest first (default)
  const [unreadOnly, setUnreadOnly] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  // Derived: apply unread filter and sort order to threads
  const displayThreads = (() => {
    let list = threads;
    if (unreadOnly) list = list.filter(t => !t.isRead);
    if (!sortDesc) list = [...list].reverse();
    return list;
  })();

  const anyFilterActive = unreadOnly || !sortDesc;

  function handleSearchToggle() {
    if (searchOpen && searchQuery) onSearch('');
    setSearchOpen(o => !o);
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(displayThreads.map(t => t.id)));
    setFilterOpen(false);
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function handleBulkDelete() {
    const ids = [...selectedIds];
    if (onBulkDelete) {
      onBulkDelete(ids);
    } else {
      ids.forEach(id => onDelete(id));
    }
    clearSelection();
  }

  function handleBulkMarkRead() {
    const ids = [...selectedIds];
    onBulkMarkRead?.(ids);
    clearSelection();
  }

  return (
    <div className="flex flex-col h-full">

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] shrink-0">
        {searchOpen ? (
          <div className="flex-1 flex items-center gap-1.5">
            <Search size={12} className="text-[var(--text-muted)] shrink-0" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search emails…"
              className="flex-1 text-xs bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <button onClick={handleSearchToggle} className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <span className="text-xs text-[var(--text-muted)] flex-1">
              {threads.length > 0 ? `${threads.length} conversation${threads.length !== 1 ? 's' : ''}` : ''}
            </span>

            {/* Search */}
            <button
              onClick={handleSearchToggle}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Search emails"
            >
              <Search size={13} />
            </button>

            {/* Filter / sort */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setFilterOpen(o => !o)}
                className={`p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors relative
                  ${filterOpen || anyFilterActive
                    ? 'text-[var(--accent)] bg-[var(--accent-light)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                title="Filter & sort"
              >
                <SlidersHorizontal size={13} />
                {anyFilterActive && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                )}
              </button>

              {filterOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg z-50 py-1.5 text-xs">

                  {/* Sort */}
                  <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Sort
                  </div>
                  <button
                    onClick={() => setSortDesc(true)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--bg-nav-hover)] transition-colors
                      ${sortDesc ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    Newest first
                    {sortDesc && <span className="text-[var(--accent)] text-[10px]">✓</span>}
                  </button>
                  <button
                    onClick={() => setSortDesc(false)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--bg-nav-hover)] transition-colors
                      ${!sortDesc ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    Oldest first
                    {!sortDesc && <span className="text-[var(--accent)] text-[10px]">✓</span>}
                  </button>

                  <div className="mx-3 my-1 border-t border-[var(--border)]" />

                  {/* Filter */}
                  <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Filter
                  </div>
                  <button
                    onClick={() => setUnreadOnly(o => !o)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--bg-nav-hover)] transition-colors
                      ${unreadOnly ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    Unread only
                    {unreadOnly && <span className="text-[var(--accent)] text-[10px]">✓</span>}
                  </button>

                  <div className="mx-3 my-1 border-t border-[var(--border)]" />

                  {/* Selection */}
                  <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Selection
                  </div>
                  <button
                    onClick={selectAll}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-nav-hover)] transition-colors text-[var(--text-secondary)]"
                  >
                    <CheckSquare size={12} className="shrink-0" />
                    Select all in view
                    <span className="ml-auto text-[var(--text-muted)] text-[10px]">{displayThreads.length}</span>
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => { clearSelection(); setFilterOpen(false); }}
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-nav-hover)] transition-colors text-[var(--text-secondary)]"
                    >
                      <Square size={12} className="shrink-0" />
                      Deselect all
                      <span className="ml-auto text-[var(--text-muted)] text-[10px]">{selectedIds.size}</span>
                    </button>
                  )}

                  {/* Reset */}
                  {anyFilterActive && (
                    <>
                      <div className="mx-3 my-1 border-t border-[var(--border)]" />
                      <button
                        onClick={() => { setSortDesc(true); setUnreadOnly(false); setFilterOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-nav-hover)] transition-colors"
                      >
                        Reset filters
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Refresh */}
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        )}
      </div>

      {/* Search banner */}
      {searchQuery && (
        <div className="px-3 py-1.5 bg-[var(--accent-light)] border-b border-[var(--border)] shrink-0">
          <span className="text-[11px] text-[var(--accent)] font-medium">Search: "{searchQuery}"</span>
        </div>
      )}

      {/* Bulk-action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent-light)] border-b border-[var(--border)] shrink-0">
          <span className="text-xs font-medium text-[var(--accent)] flex-1">
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleBulkMarkRead}
            title="Mark as read"
            className="p-1.5 rounded-lg hover:bg-[var(--accent)]/10 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          >
            <MailOpen size={13} />
          </button>
          <button
            onClick={handleBulkDelete}
            title="Delete selected"
            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={clearSelection}
            title="Clear selection"
            className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4 gap-3">
            <AlertTriangle size={20} className="text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Could not load emails</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{error}</p>
            </div>
            <button onClick={onRefresh} className="btn-secondary text-xs flex items-center gap-1.5">
              <RefreshCw size={11} /> Try again
            </button>
            <a href="/settings?tab=email-triage" className="text-xs text-[var(--accent)] hover:underline">
              Check Gmail connection
            </a>
          </div>
        ) : loading && threads.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : displayThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4 gap-1">
            <p className="text-sm text-[var(--text-muted)]">
              {unreadOnly && threads.length > 0 ? 'No unread emails' : 'No emails here'}
            </p>
            {unreadOnly && threads.length > 0 && (
              <button
                onClick={() => setUnreadOnly(false)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Show all
              </button>
            )}
          </div>
        ) : (
          <>
            {displayThreads.map(thread => {
              const isActive = thread.id === activeThreadId;
              const isSelected = selectedIds.has(thread.id);
              const hasAttachments = thread.messages.some(m => m.hasAttachments || m.attachments.length > 0);
              const meta = threadMeta?.[thread.id];
              const sentMessages = thread.messages.filter(m => m.labelIds?.includes('SENT'));
              const hasInboundMsg = thread.messages.some(m => !m.labelIds?.includes('SENT'));
              // In non-threaded mode thread.id is a message ID; forwarded/replied sets track by real thread ID
              const realThreadId = thread.gmailThreadId ?? thread.id;
              // Primary source: threadMeta (set when thread is opened in this session) and
              // repliedThreadIds (persisted to localStorage — updated both when replying through
              // the app AND when openThread detects a SENT reply in the full thread).
              // Threaded-mode fallback: thread has both received and sent messages (reply),
              // or a sent message whose subject starts with "Re:" / "Fwd:" respectively.
              const isReplied = (meta?.isReplied ?? false)
                || (repliedThreadIds?.has(realThreadId) ?? false)
                || (hasInboundMsg && sentMessages.some(m => /^re:/i.test(m.subject)));
              const isForwarded = (meta?.isForwarded ?? false)
                || (forwardedThreadIds?.has(realThreadId) ?? false)
                || sentMessages.some(m => /^fwd:/i.test(m.subject));

              return (
                <div
                  key={thread.id}
                  className={`w-full text-left border-b border-[var(--border)] transition-colors relative group flex items-stretch
                    ${isSelected
                      ? 'bg-[var(--accent-light)]'
                      : isActive
                        ? 'bg-[var(--accent-light)]'
                        : !thread.isRead
                          ? 'bg-[var(--accent-light)] hover:bg-[var(--accent-light)]'
                          : 'hover:bg-[var(--bg-nav-hover)]'
                    }`}
                >
                  {/* Checkbox column */}
                  <button
                    onClick={e => toggleSelect(thread.id, e)}
                    className={`shrink-0 flex items-center pl-2 pr-1 transition-opacity
                      ${isSelected || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title={isSelected ? 'Deselect' : 'Select'}
                  >
                    {isSelected
                      ? <CheckSquare size={14} className="text-[var(--accent)]" />
                      : <Square size={14} className="text-[var(--text-muted)]" />
                    }
                  </button>

                  {/* Main clickable area */}
                  <button
                    onClick={() => onSelect(thread)}
                    className="flex-1 text-left px-3 py-3 min-w-0"
                  >
                    {/* Unread indicator dot */}
                    {!thread.isRead && (
                      <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                    )}

                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-sm truncate flex-1 ${!thread.isRead ? 'font-semibold text-[var(--text-primary)]' : 'font-normal text-[var(--text-secondary)]'}`}>
                        {thread.from.name || thread.from.email}
                        {thread.messageCount > 1 && (
                          <span className="ml-1.5 text-xs text-[var(--text-muted)] font-normal">({thread.messageCount})</span>
                        )}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {pinnedIds?.has(thread.id) && <Pin size={11} className="text-[var(--accent)] fill-[var(--accent)] group-hover:hidden" />}
                        {thread.labelIds.includes('STARRED') && <Star size={11} className="text-amber-400 fill-amber-400 group-hover:hidden" />}
                        {hasAttachments && <Paperclip size={11} className="text-[var(--text-muted)] group-hover:hidden" />}
                        {meta?.hasAllocation && (
                          <UserPlus size={11} className="text-emerald-500 dark:text-emerald-400 group-hover:hidden" title="Allocated to client" />
                        )}
                        {meta?.hasTaskLink && (
                          <CheckSquare size={11} className="text-blue-500 dark:text-blue-400 group-hover:hidden" title="Linked to task" />
                        )}
                        {/* Date — hidden on hover */}
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:hidden">{formatDate(thread.date)}</span>
                        {/* Hover actions */}
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          {onPin && (
                            <button
                              onClick={e => { e.stopPropagation(); onPin(thread.id, !pinnedIds?.has(thread.id)); }}
                              title={pinnedIds?.has(thread.id) ? 'Unpin' : 'Pin to top'}
                              className="p-1 rounded hover:bg-[var(--bg-nav-hover)]"
                            >
                              <Pin size={13} className={pinnedIds?.has(thread.id) ? 'text-[var(--accent)] fill-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'} />
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); onStar(thread.id, !thread.labelIds.includes('STARRED')); }}
                            title={thread.labelIds.includes('STARRED') ? 'Unstar' : 'Star'}
                            className="p-1 rounded hover:bg-[var(--bg-nav-hover)]"
                          >
                            <Star size={13} className={thread.labelIds.includes('STARRED') ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400'} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); onDelete(thread.id); }}
                            title="Delete"
                            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-500"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <p className={`text-xs mt-0.5 truncate ${!thread.isRead ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {thread.subject}
                    </p>
                    <p className="text-xs mt-0.5 truncate text-[var(--text-muted)]">
                      {thread.snippet}
                    </p>

                    {/* Status chips */}
                    {(isReplied || isForwarded || (meta?.reactions?.length ?? 0) > 0) && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {isReplied && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]" title="Replied">
                            <Reply size={9} /> Replied
                          </span>
                        )}
                        {isForwarded && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]" title="Forwarded">
                            <Forward size={9} /> Forwarded
                          </span>
                        )}
                        {meta?.reactions && meta.reactions.length > 0 && (
                          <span className="inline-flex items-center gap-0.5" title="You reacted">
                            {meta.reactions.map(e => (
                              <span key={e} className="text-sm leading-none">{e}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}

            {hasNextPage && (
              <div className="flex justify-center py-3">
                <button
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  {loadingMore ? <Loader2 size={11} className="animate-spin" /> : null}
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
