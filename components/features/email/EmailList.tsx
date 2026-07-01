'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Loader2, RefreshCw, Paperclip, AlertTriangle, Reply, Forward,
  UserPlus, CheckSquare, Search, Star, Trash2, X, Pin,
  SlidersHorizontal, MailOpen, Square, Printer, Download, Tag,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import type { EmailThread } from '@/lib/gmail';

// Deterministic hue (0–359) from a label name so each Gmail label always gets
// the same colour without us having to fetch Gmail's per-label colour settings.
function labelHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

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
  /** Map of RFC Message-ID -> ISO date an individual email was forwarded/replied
   *  to. Keyed per email (not per thread) so a reply on one message in a
   *  conversation doesn't mark its siblings as replied. */
  forwardedMsgIds?: Map<string, string>;
  repliedMsgIds?: Map<string, string>;
  onBulkDelete?: (ids: string[]) => void;
  onBulkMarkRead?: (ids: string[]) => void;
  /** Forward each selected thread as its own email (one Send call per thread,
   *  attachments preserved). Returns success/failure totals for toast UX. */
  onBulkForward?: (ids: string[], to: string[], cc: string[], note: string) => Promise<{ success: number; failed: number } | void>;
  /** Allocate every selected thread to the same client(s). */
  onBulkAllocate?: (ids: string[]) => void;
  /** Open a print view (print / save as PDF) for the selected threads. */
  onBulkPrint?: (ids: string[]) => void;
  /** Download all attachments across the selected threads. */
  onBulkDownloadAttachments?: (ids: string[]) => void;
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
  /** The firm's user-created Gmail labels (id + name) so each row can show a
   *  little coloured tag chip for any of these labels applied to the thread. */
  userLabels?: { id: string; name: string }[];
}

export default function EmailList({
  threads, activeThreadId, loading, error, threadMeta, searchQuery, onSearch,
  onSelect, onRefresh, onStar, onDelete, onMarkRead, hasNextPage, onLoadMore, loadingMore,
  pinnedIds, onPin, forwardedMsgIds, repliedMsgIds, onBulkDelete, onBulkMarkRead, onBulkForward,
  onBulkAllocate, onBulkPrint, onBulkDownloadAttachments,
  unreadOnly, onUnreadOnlyChange,
  taskLinkedOnly, onTaskLinkedOnlyChange,
  allocatedOnly, onAllocatedOnlyChange,
  activeLabel, userLabels,
}: Props) {
  // Filter / sort state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);    // true = newest first (default)
  const filterRef = useRef<HTMLDivElement>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Anchor row for shift-range selection.
  const lastIndexRef = useRef<number>(-1);

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

  function toggleSelect(id: string, index: number, e: React.MouseEvent) {
    e.stopPropagation();
    // Shift-click the checkbox = select the whole range from the last-clicked
    // row (matches the row-body behaviour and Gmail). Needs a prior anchor.
    if (e.shiftKey && lastIndexRef.current >= 0) {
      selectRange(lastIndexRef.current, index);
      lastIndexRef.current = index;
      return;
    }
    lastIndexRef.current = index;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Add every row between two indices (inclusive) to the selection.
  function selectRange(a: number, b: number) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const ids = displayThreads.slice(lo, hi + 1).map(t => t.id);
    setSelectedIds(prev => new Set([...prev, ...ids]));
  }

  // Row click: shift = range-select from the anchor, ctrl/cmd = toggle this row,
  // plain click = open the thread.
  function handleRowClick(thread: EmailThread, index: number, e: React.MouseEvent) {
    if (e.shiftKey && lastIndexRef.current >= 0) {
      e.preventDefault();
      selectRange(lastIndexRef.current, index);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(thread.id)) next.delete(thread.id); else next.add(thread.id);
        return next;
      });
      lastIndexRef.current = index;
      return;
    }
    lastIndexRef.current = index;
    onSelect(thread);
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

  // Bulk-forward state: simple inline modal asking for recipient + optional
  // note. On submit we hit /api/email/bulk-forward (one HTTP call, server
  // fans out one send per thread) and surface a tiny success toast.
  const [bulkForwardOpen, setBulkForwardOpen]   = useState(false);
  const [forwardTo, setForwardTo]               = useState('');
  const [forwardCc, setForwardCc]               = useState('');
  const [forwardNote, setForwardNote]           = useState('');
  const [forwarding, setForwarding]             = useState(false);
  const [forwardError, setForwardError]         = useState<string | null>(null);
  const [forwardToast, setForwardToast]         = useState<{ success: number; failed: number } | null>(null);
  useEffect(() => {
    if (!forwardToast) return;
    const t = window.setTimeout(() => setForwardToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [forwardToast]);

  async function handleBulkForward() {
    setForwardError(null);
    const to = forwardTo.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const cc = forwardCc.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (to.length === 0) {
      setForwardError('Enter at least one recipient email.');
      return;
    }
    if (!onBulkForward) {
      setForwardError('Forwarding is not available.');
      return;
    }
    setForwarding(true);
    try {
      const ids = [...selectedIds];
      const out = await onBulkForward(ids, to, cc, forwardNote);
      if (out) setForwardToast(out);
      setBulkForwardOpen(false);
      setForwardTo('');
      setForwardCc('');
      setForwardNote('');
      clearSelection();
    } catch (e) {
      setForwardError(e instanceof Error ? e.message : 'Forward failed');
    } finally {
      setForwarding(false);
    }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] shrink-0">
        {/* Persistent global search — always visible so it's easy to find, and
            it searches the WHOLE mailbox (Inbox, Sent, Spam, Trash, all labels). */}
        <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-input)] bg-[var(--bg-subtle)] focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:border-transparent">
          <Search size={14} className="text-[var(--text-muted)] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search all mail — Inbox, Sent, Spam & folders…"
            aria-label="Search all mail"
            className="flex-1 text-xs bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          {searchQuery && (
            <button onClick={() => onSearch('')} aria-label="Clear search" className="p-0.5 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
              <X size={12} />
            </button>
          )}
        </div>

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
      </div>

      {/* Search banner — makes clear the search spans the whole mailbox */}
      {searchQuery && (
        <div className="px-3 py-1.5 bg-[var(--accent-light)] border-b border-[var(--border)] shrink-0 flex items-center gap-2">
          <Search size={11} className="text-[var(--accent)] shrink-0" />
          <span className="text-[11px] text-[var(--accent)] font-medium flex-1 truncate">
            Searching all mail for “{searchQuery}” · {threads.length} result{threads.length !== 1 ? 's' : ''}
          </span>
          <button onClick={() => onSearch('')} className="text-[11px] text-[var(--accent)] hover:underline shrink-0">Clear</button>
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
          {onBulkAllocate && (
            <Tooltip label="Allocate to client">
              <button
                onClick={() => onBulkAllocate([...selectedIds])}
                aria-label="Allocate selected to client"
                className="p-1.5 rounded-lg hover:bg-[var(--accent)]/10 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
              >
                <UserPlus size={13} />
              </button>
            </Tooltip>
          )}
          {onBulkForward && (
            <Tooltip label="Forward each as a separate email">
              <button
                onClick={() => setBulkForwardOpen(true)}
                aria-label="Forward selected"
                className="p-1.5 rounded-lg hover:bg-[var(--accent)]/10 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
              >
                <Forward size={13} />
              </button>
            </Tooltip>
          )}
          {onBulkPrint && (
            <Tooltip label="Print / save as PDF">
              <button
                onClick={() => onBulkPrint([...selectedIds])}
                aria-label="Print selected"
                className="p-1.5 rounded-lg hover:bg-[var(--accent)]/10 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
              >
                <Printer size={13} />
              </button>
            </Tooltip>
          )}
          {onBulkDownloadAttachments && (
            <Tooltip label="Download attachments">
              <button
                onClick={() => onBulkDownloadAttachments([...selectedIds])}
                aria-label="Download attachments from selected"
                className="p-1.5 rounded-lg hover:bg-[var(--accent)]/10 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
              >
                <Download size={13} />
              </button>
            </Tooltip>
          )}
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
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
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
                onClick={() => onUnreadOnlyChange(false)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Show all
              </button>
            )}
          </div>
        ) : (
          <>
            {displayThreads.map((thread, rowIndex) => {
              const isActive = thread.id === activeThreadId;
              const isSelected = selectedIds.has(thread.id);
              const hasAttachments = thread.messages.some(m => m.hasAttachments || m.attachments.length > 0);
              const meta = threadMeta?.[thread.id];
              const sentMessages = thread.messages.filter(m => m.labelIds?.includes('SENT'));
              // Per-email replied/forwarded: a row is replied/forwarded when one
              // of ITS messages' RFC Message-IDs is in the per-message maps
              // (populated from the server's reply-chain analysis + app sends).
              // In flat view a row is a single message; in grouped view any
              // message in the conversation counts. No thread-wide or subject
              // heuristics — those falsely flagged merged threads / newer emails.
              const rowRfcIds = thread.messages.map(m => m.messageId).filter(Boolean);
              const rowRfcId = thread.messages[0]?.messageId || '';
              const isReplied = (meta?.isReplied ?? false)
                || rowRfcIds.some(id => repliedMsgIds?.has(id));
              const isForwarded = (meta?.isForwarded ?? false)
                || rowRfcIds.some(id => forwardedMsgIds?.has(id));
              // Match both Gmail-style "Fwd:" and Outlook-style "FW:" forward prefixes.
              const FORWARD_PREFIX = /^(fwd|fw):/i;

              // Find the most recent reply / forward date to show "Replied 9 May".
              // In grouped view we have the SENT messages; in flat view the row
              // has only its own message, so fall back to the per-message map date.
              function pickLatestSent(predicate: (subject: string) => boolean): string | undefined {
                const matches = sentMessages.filter(m => predicate(m.subject ?? ''));
                if (matches.length === 0) return undefined;
                const latest = matches.reduce((acc, m) =>
                  (new Date(m.date).getTime() || 0) > (new Date(acc.date).getTime() || 0) ? m : acc
                );
                return latest.date || undefined;
              }
              const repliedAt   = isReplied   ? (pickLatestSent(s => !FORWARD_PREFIX.test(s)) || repliedMsgIds?.get(rowRfcId)   || undefined) : undefined;
              const forwardedAt = isForwarded ? (pickLatestSent(s =>  FORWARD_PREFIX.test(s)) || forwardedMsgIds?.get(rowRfcId) || undefined) : undefined;

              // User-created Gmail labels applied to this thread → little tag chips.
              const threadUserLabels = (userLabels ?? []).filter(l => thread.labelIds.includes(l.id));

              return (
                <div
                  key={thread.id}
                  draggable
                  onDragStart={e => {
                    // If this row is part of a multi-selection, drag them all;
                    // otherwise drag just this one.
                    const ids = (isSelected && selectedIds.size > 1) ? [...selectedIds] : [thread.id];
                    e.dataTransfer.setData('application/x-smith-emails', JSON.stringify(ids));
                    e.dataTransfer.setData('application/x-smith-email', thread.id);
                    e.dataTransfer.setData('text/plain', thread.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  className={`w-full text-left border-b border-[var(--border)] transition-all duration-150 relative group flex items-stretch
                    ${isSelected
                      ? 'bg-[var(--accent-light)]'
                      : isActive
                        // Active (open) row: indigo-tinted card so it's clearly distinct from the white unread rows.
                        ? 'bg-[rgba(79,70,229,0.13)] hover:bg-[rgba(79,70,229,0.17)] shadow-[0_2px_12px_rgba(99,102,241,0.18)] ring-1 ring-indigo-300/70 z-10'
                        : !thread.isRead
                          // Unread: subtle white "card" tint (the bold text + accent dot do the heavy lifting).
                          ? 'bg-white/55 hover:bg-white/70'
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
                      onClick={e => toggleSelect(thread.id, rowIndex, e)}
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
                    onClick={e => handleRowClick(thread, rowIndex, e)}
                    className="flex-1 text-left px-3 py-3 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      {!thread.isRead && (
                        <span aria-hidden className="mt-[7px] w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" />
                      )}
                      <span className={`text-sm truncate flex-1 ${isActive ? 'font-semibold text-[var(--accent)]' : !thread.isRead ? 'font-semibold text-[var(--text-primary)]' : 'font-normal text-[var(--text-secondary)]'}`}>
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
                    {(isReplied || isForwarded || (meta?.reactions?.length ?? 0) > 0 || threadUserLabels.length > 0) && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {/* Gmail label chips — little tag-shaped icon, full name on hover. */}
                        {threadUserLabels.map(l => {
                          const hue = labelHue(l.name);
                          return (
                            <Tooltip key={l.id} label={l.name} side="top">
                              <span
                                aria-label={l.name}
                                className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] shrink-0"
                                style={{ backgroundColor: `hsl(${hue} 70% 45% / 0.14)`, color: `hsl(${hue} 65% 38%)` }}
                              >
                                <Tag size={10} />
                              </span>
                            </Tooltip>
                          );
                        })}
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

      {/* Bulk-forward modal — recipient + optional note. Forwards each
          selected thread as its own separate email with attachments. */}
      {bulkForwardOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !forwarding && setBulkForwardOpen(false)}>
          <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">
                  Forward {selectedIds.size} email{selectedIds.size === 1 ? '' : 's'}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Each selected email is sent as its own forwarded message with all attachments.
                </p>
              </div>
              <button
                onClick={() => !forwarding && setBulkForwardOpen(false)}
                aria-label="Close"
                className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">To</label>
                <input
                  type="text"
                  value={forwardTo}
                  onChange={e => setForwardTo(e.target.value)}
                  placeholder="name@example.com (comma-separated for multiple)"
                  className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-page)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">CC (optional)</label>
                <input
                  type="text"
                  value={forwardCc}
                  onChange={e => setForwardCc(e.target.value)}
                  placeholder="cc@example.com"
                  className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-page)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Note (optional)</label>
                <textarea
                  value={forwardNote}
                  onChange={e => setForwardNote(e.target.value)}
                  placeholder="Prepended to each forwarded email."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-page)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none"
                />
              </div>
              {forwardError && (
                <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {forwardError}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2 bg-[var(--bg-page)]">
              <button
                onClick={() => !forwarding && setBulkForwardOpen(false)}
                disabled={forwarding}
                className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] rounded-lg disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkForward}
                disabled={forwarding}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-60"
              >
                {forwarding ? <Loader2 size={12} className="animate-spin" /> : <Forward size={12} />}
                Forward {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-forward toast */}
      {forwardToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg px-4 py-3 flex items-center gap-2 max-w-sm">
          <Forward size={16} className={forwardToast.failed > 0 ? 'text-amber-500' : 'text-emerald-500'} />
          <div className="text-sm text-[var(--text-primary)]">
            {forwardToast.success > 0 && (
              <>Forwarded <strong>{forwardToast.success}</strong> email{forwardToast.success === 1 ? '' : 's'}</>
            )}
            {forwardToast.failed > 0 && (
              <span className="text-amber-700"> · {forwardToast.failed} failed</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
