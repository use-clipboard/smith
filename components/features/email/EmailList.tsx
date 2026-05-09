'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Loader2, RefreshCw, Paperclip, AlertTriangle, Reply, Forward,
  UserPlus, CheckSquare, Search, Star, Trash2, X, Pin,
  SlidersHorizontal, MailOpen, Square,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
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
  onMarkRead?: (threadId: string, markAsRead: boolean) => void;
  hasNextPage: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  pinnedIds?: Set<string>;
  onPin?: (threadId: string, pin: boolean) => void;
  /** Map of thread ID -> ISO date the user last forwarded/replied. */
  forwardedThreadIds?: Map<string, string>;
  repliedThreadIds?: Map<string, string>;
  onBulkDelete?: (ids: string[]) => void;
  onBulkMarkRead?: (ids: string[]) => void;
  /** Controlled: true = only unread emails are fetched server-side */
  unreadOnly: boolean;
  onUnreadOnlyChange: (v: boolean) => void;
  /** Controlled: true = only emails linked to a task are fetched server-side */
  taskLinkedOnly: boolean;
  onTaskLinkedOnlyChange: (v: boolean) => void;
  /** Controlled: true = only emails allocated to a client are fetched server-side */
  allocatedOnly: boolean;
  onAllocatedOnlyChange: (v: boolean) => void;
  /** Active Gmail label — used to flip the "from" column to recipients in SENT */
  activeLabel?: string;
}

export default function EmailList({
  threads, activeThreadId, loading, error, threadMeta, searchQuery, onSearch,
  onSelect, onRefresh, onStar, onDelete, onMarkRead, hasNextPage, onLoadMore, loadingMore,
  pinnedIds, onPin, forwardedThreadIds, repliedThreadIds, onBulkDelete, onBulkMarkRead,
  unreadOnly, onUnreadOnlyChange,
  taskLinkedOnly, onTaskLinkedOnlyChange,
  allocatedOnly, onAllocatedOnlyChange,
  activeLabel,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);

  // Filter / sort state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);    // true = newest first (default)
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

  // Sort only — unread filter is applied server-side (whole inbox), not just loaded batch
  const displayThreads = sortDesc ? threads : [...threads].reverse();

  const anyFilterActive = unreadOnly || taskLinkedOnly || allocatedOnly || !sortDesc;

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
            <Tooltip label="Search emails">
              <button
                onClick={handleSearchToggle}
                aria-label="Search emails"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Search size={13} />
              </button>
            </Tooltip>

            {/* Filter / sort */}
            <div className="relative" ref={filterRef}>
              <Tooltip label="Filter & sort">
                <button
                  onClick={() => setFilterOpen(o => !o)}
                  aria-label="Filter & sort"
                  className={`p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors relative
                    ${filterOpen || anyFilterActive
                      ? 'text-[var(--accent)] bg-[var(--accent-light)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                >
                  <SlidersHorizontal size={13} />
                  {anyFilterActive && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              </Tooltip>

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
                    onClick={() => { onUnreadOnlyChange(!unreadOnly); setFilterOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--bg-nav-hover)] transition-colors
                      ${unreadOnly ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    <span className="flex flex-col items-start">
                      Unread only
                      <span className="text-[10px] text-[var(--text-muted)] font-normal">Searches entire inbox</span>
                    </span>
                    {unreadOnly && <span className="text-[var(--accent)] text-[10px]">✓</span>}
                  </button>
                  <button
                    onClick={() => { onTaskLinkedOnlyChange(!taskLinkedOnly); setFilterOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--bg-nav-hover)] transition-colors
                      ${taskLinkedOnly ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    <span className="flex flex-col items-start">
                      Linked to a task
                      <span className="text-[10px] text-[var(--text-muted)] font-normal">Searches entire inbox</span>
                    </span>
                    {taskLinkedOnly && <span className="text-[var(--accent)] text-[10px]">✓</span>}
                  </button>
                  <button
                    onClick={() => { onAllocatedOnlyChange(!allocatedOnly); setFilterOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--bg-nav-hover)] transition-colors
                      ${allocatedOnly ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    <span className="flex flex-col items-start">
                      Allocated to a client
                      <span className="text-[10px] text-[var(--text-muted)] font-normal">Searches entire inbox</span>
                    </span>
                    {allocatedOnly && <span className="text-[var(--accent)] text-[10px]">✓</span>}
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
                        onClick={() => { setSortDesc(true); onUnreadOnlyChange(false); setFilterOpen(false); }}
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
            <Tooltip label="Refresh">
              <button
                onClick={onRefresh}
                disabled={loading}
                aria-label="Refresh"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </Tooltip>
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
          <Tooltip label="Mark as read">
            <button
              onClick={handleBulkMarkRead}
              aria-label="Mark as read"
              className="p-1.5 rounded-lg hover:bg-[var(--accent)]/10 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <MailOpen size={13} />
            </button>
          </Tooltip>
          <Tooltip label="Delete selected">
            <button
              onClick={handleBulkDelete}
              aria-label="Delete selected"
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
          <Tooltip label="Clear selection">
            <button
              onClick={clearSelection}
              aria-label="Clear selection"
              className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* Thread list — small padding on all sides so the active row's drop-shadow
          has breathing room and isn't clipped at the panel edges (incl. top/bottom). */}
      <div className="flex-1 overflow-y-auto p-2">
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
              // Match both Gmail-style "Fwd:" and Outlook-style "FW:" forward prefixes.
              const FORWARD_PREFIX = /^(fwd|fw):/i;
              const isForwarded = (meta?.isForwarded ?? false)
                || (forwardedThreadIds?.has(realThreadId) ?? false)
                || sentMessages.some(m => FORWARD_PREFIX.test(m.subject));

              // Find the most recent reply / forward in this thread so we can show "Replied 9 May" etc.
              // Falls back to undefined when the thread isn't loaded with messages yet (e.g. when
              // isReplied came from persisted localStorage); in that case we just show the bare chip.
              function pickLatestSent(predicate: (subject: string) => boolean): string | undefined {
                const matches = sentMessages.filter(m => predicate(m.subject ?? ''));
                if (matches.length === 0) return undefined;
                const latest = matches.reduce((acc, m) =>
                  (new Date(m.date).getTime() || 0) > (new Date(acc.date).getTime() || 0) ? m : acc
                );
                return latest.date || undefined;
              }
              // Prefer the date from a real SENT message in the thread; fall back
              // to the persisted timestamp captured when the user sent through the app
              // (covers the window before the next inbox poll picks up the reply).
              const repliedAt   = isReplied   ? (pickLatestSent(s => !FORWARD_PREFIX.test(s)) || repliedThreadIds?.get(realThreadId)   || undefined) : undefined;
              const forwardedAt = isForwarded ? (pickLatestSent(s =>  FORWARD_PREFIX.test(s)) || forwardedThreadIds?.get(realThreadId) || undefined) : undefined;

              return (
                <div
                  key={thread.id}
                  className={`w-full text-left border-b border-[var(--border)] transition-all duration-150 relative group flex items-stretch
                    ${isSelected
                      ? 'bg-[var(--accent-light)]'
                      : isActive
                        // Active row: elevated card look — soft indigo-tinted shadow,
                        // subtle ring, and z-10 so the shadow isn't clipped by neighbours.
                        ? 'bg-[var(--bg-card-solid)] hover:bg-[var(--bg-card-solid)] shadow-[0_4px_16px_rgba(99,102,241,0.25)] ring-1 ring-indigo-300/60 dark:ring-indigo-500/40 z-10'
                        : !thread.isRead
                          ? 'bg-indigo-100 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
                          : 'hover:bg-[var(--bg-nav-hover)]'
                    }`}
                >
                  {/* Status edge bars — green on the left edge when allocated to a client, blue on the right edge when task-linked. Stack both when both apply. The active-row indication is now the lift/glow on the row itself, no left bar. */}
                  {meta?.hasAllocation && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-1 pointer-events-none bg-emerald-500"
                    />
                  )}
                  {meta?.hasTaskLink && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 right-0 w-1 pointer-events-none bg-blue-500"
                    />
                  )}
                  {/* Checkbox column */}
                  <Tooltip label={isSelected ? 'Deselect' : 'Select'} side="right" className="shrink-0">
                    <button
                      onClick={e => toggleSelect(thread.id, e)}
                      aria-label={isSelected ? 'Deselect' : 'Select'}
                      className={`flex items-center pl-2 pr-1 transition-opacity
                        ${isSelected || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      {isSelected
                        ? <CheckSquare size={14} className="text-[var(--accent)]" />
                        : <Square size={14} className="text-[var(--text-muted)]" />
                      }
                    </button>
                  </Tooltip>

                  {/* Main clickable area */}
                  <button
                    onClick={() => onSelect(thread)}
                    className="flex-1 text-left px-3 py-3 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-sm truncate flex-1 ${!thread.isRead ? 'font-semibold text-[var(--text-primary)]' : 'font-normal text-[var(--text-secondary)]'}`}>
                        {(() => {
                          // In Sent, the user is always the sender — show the
                          // recipient instead so each row is meaningful.
                          if (activeLabel === 'SENT') {
                            const sentMsg = thread.messages.find(m => m.labelIds?.includes('SENT')) ?? thread.messages[0];
                            const recipients = sentMsg?.to ?? [];
                            if (recipients.length === 0) return '(no recipient)';
                            const primary = recipients[0].name || recipients[0].email;
                            return recipients.length > 1
                              ? <>To: {primary} <span className="text-xs text-[var(--text-muted)] font-normal">+{recipients.length - 1}</span></>
                              : <>To: {primary}</>;
                          }
                          return thread.from.name || thread.from.email;
                        })()}
                        {thread.messageCount > 1 && (
                          <span className="ml-1.5 text-xs text-[var(--text-muted)] font-normal">({thread.messageCount})</span>
                        )}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {pinnedIds?.has(thread.id) && <Pin size={11} className="text-[var(--accent)] fill-[var(--accent)] group-hover:hidden" />}
                        {thread.labelIds.includes('STARRED') && <Star size={11} className="text-amber-400 fill-amber-400 group-hover:hidden" />}
                        {hasAttachments && <Paperclip size={11} className="text-[var(--text-muted)] group-hover:hidden" />}
                        {meta?.hasAllocation && (
                          <UserPlus size={11} className="text-emerald-500 dark:text-emerald-400 group-hover:hidden" />
                        )}
                        {meta?.hasTaskLink && (
                          <CheckSquare size={11} className="text-blue-500 dark:text-blue-400 group-hover:hidden" />
                        )}
                        {/* Date — hidden on hover */}
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:hidden">{formatDate(thread.date)}</span>
                        {/* Hover actions */}
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          {onPin && (
                            <Tooltip label={pinnedIds?.has(thread.id) ? 'Unpin' : 'Pin to top'}>
                              <button
                                onClick={e => { e.stopPropagation(); onPin(thread.id, !pinnedIds?.has(thread.id)); }}
                                aria-label={pinnedIds?.has(thread.id) ? 'Unpin' : 'Pin to top'}
                                className="p-1 rounded hover:bg-[var(--bg-nav-hover)]"
                              >
                                <Pin size={13} className={pinnedIds?.has(thread.id) ? 'text-[var(--accent)] fill-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'} />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip label={thread.labelIds.includes('STARRED') ? 'Unstar' : 'Star'}>
                            <button
                              onClick={e => { e.stopPropagation(); onStar(thread.id, !thread.labelIds.includes('STARRED')); }}
                              aria-label={thread.labelIds.includes('STARRED') ? 'Unstar' : 'Star'}
                              className="p-1 rounded hover:bg-[var(--bg-nav-hover)]"
                            >
                              <Star size={13} className={thread.labelIds.includes('STARRED') ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400'} />
                            </button>
                          </Tooltip>
                          {onMarkRead && (
                            <Tooltip label={thread.isRead ? 'Mark as unread' : 'Mark as read'}>
                              <button
                                onClick={e => { e.stopPropagation(); onMarkRead(thread.id, !thread.isRead); }}
                                aria-label={thread.isRead ? 'Mark as unread' : 'Mark as read'}
                                className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--accent)]"
                              >
                                <MailOpen size={13} />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip label="Delete">
                            <button
                              onClick={e => { e.stopPropagation(); onDelete(thread.id); }}
                              aria-label="Delete"
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-500"
                            >
                              <Trash2 size={13} />
                            </button>
                          </Tooltip>
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
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]">
                            <Reply size={9} /> Replied{repliedAt && ` · ${formatDate(repliedAt)}`}
                          </span>
                        )}
                        {isForwarded && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]">
                            <Forward size={9} /> Forwarded{forwardedAt && ` · ${formatDate(forwardedAt)}`}
                          </span>
                        )}
                        {meta?.reactions && meta.reactions.length > 0 && (
                          <Tooltip label="You reacted" side="top">
                            <span className="inline-flex items-center gap-0.5">
                              {meta.reactions.map(e => (
                                <span key={e} className="text-sm leading-none">{e}</span>
                              ))}
                            </span>
                          </Tooltip>
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
