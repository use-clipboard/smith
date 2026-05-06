'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Paperclip, AlertTriangle, Reply, UserCheck, CheckSquare, Search, Star, Trash2, X, Pin } from 'lucide-react';
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
  threadMeta?: Record<string, { hasAllocation: boolean; hasTaskLink: boolean }>;
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
}

export default function EmailList({
  threads, activeThreadId, loading, error, threadMeta, searchQuery, onSearch,
  onSelect, onRefresh, onStar, onDelete, hasNextPage, onLoadMore, loadingMore,
  pinnedIds, onPin,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);

  function handleSearchToggle() {
    if (searchOpen && searchQuery) { onSearch(''); }
    setSearchOpen(o => !o);
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
            <button
              onClick={handleSearchToggle}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Search emails"
            >
              <Search size={13} />
            </button>
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
      {searchQuery && (
        <div className="px-3 py-1.5 bg-[var(--accent-light)] border-b border-[var(--border)]">
          <span className="text-[11px] text-[var(--accent)] font-medium">Search: "{searchQuery}"</span>
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
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-sm text-[var(--text-muted)]">No emails here</p>
          </div>
        ) : (
          <>
            {threads.map(thread => {
              const isActive = thread.id === activeThreadId;
              const hasAttachments = thread.messages.some(m => m.hasAttachments || m.attachments.length > 0);
              const isReplied = thread.labelIds.includes('SENT');
              const meta = threadMeta?.[thread.id];
              return (
                <button
                  key={thread.id}
                  onClick={() => onSelect(thread)}
                  className={`w-full text-left px-4 py-3 border-b border-[var(--border)] transition-colors relative group
                    ${isActive
                      ? 'bg-[var(--accent-light)]'
                      : !thread.isRead
                        ? 'bg-[var(--accent-light)] hover:bg-[var(--accent-light)]'
                        : 'hover:bg-[var(--bg-nav-hover)]'
                    }`}
                >
                  {/* Unread indicator */}
                  {!thread.isRead && (
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
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
                  {/* Status indicators */}
                  {(isReplied || meta?.hasAllocation || meta?.hasTaskLink) && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {isReplied && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-muted)]" title="Replied">
                          <Reply size={9} /> Replied
                        </span>
                      )}
                      {meta?.hasAllocation && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400" title="Linked to client">
                          <UserCheck size={9} /> Client
                        </span>
                      )}
                      {meta?.hasTaskLink && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400" title="Linked to task">
                          <CheckSquare size={9} /> Task
                        </span>
                      )}
                    </div>
                  )}
                </button>
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
