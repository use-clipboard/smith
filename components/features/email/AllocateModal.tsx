'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Check, Search, UserPlus, AlertCircle } from 'lucide-react';
import type { EmailThread as EmailThreadType } from '@/lib/gmail';

export interface Client {
  id: string;
  name: string;
  client_ref: string;
  contact_email: string | null;
  risk_rating: string | null;
}

interface Allocation {
  client_id: string;
  clients: { id: string; name: string; client_ref: string } | null;
  users: { full_name: string } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  thread?: EmailThreadType | null;
  /** Bulk mode: allocate all of these threads to the chosen client(s) at once. */
  bulkThreads?: EmailThreadType[] | null;
  existingAllocations?: Allocation[];
  /** Called in thread mode after successful API save */
  onAllocated?: (clientIds: string[]) => void;
  /** Called in compose mode — no API call, just returns selection */
  onSelect?: (clients: Client[]) => void;
  /** Emails to use for suggestions when no thread is provided */
  suggestEmails?: string[];
  /** Pre-populate selection (compose mode) */
  preSelectedIds?: string[];
}

const STATUS_COLOURS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  hold:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function AllocateModal({
  open, onClose, thread, bulkThreads, existingAllocations = [], onAllocated, onSelect, suggestEmails, preSelectedIds,
}: Props) {
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedObjects, setSelectedObjects] = useState<Map<string, Client>>(new Map());
  const [suggested, setSuggested] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isComposeMode = !!onSelect;

  // Server-side search with debounce
  const doSearch = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}`);
      const data = res.ok ? await res.json() as { clients?: Client[] } : { clients: [] };
      setSearchResults(data.clients ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSearchResults([]);
    setSelectedObjects(new Map());
    setError(null);

    fetch('/api/clients')
      .then(r => r.ok ? r.json() : { clients: [] })
      .then((data: { clients?: Client[] }) => {
        const clients = data.clients ?? [];
        setAllClients(clients);

        // Build email set from thread messages or suggestEmails prop
        const emailsToMatch = new Set<string>();
        const collectFrom = (msgs: EmailThreadType['messages']) => {
          msgs.forEach(m => {
            if (m.from.email) emailsToMatch.add(m.from.email.toLowerCase());
            m.to.forEach(a => a.email && emailsToMatch.add(a.email.toLowerCase()));
            m.cc.forEach(a => a.email && emailsToMatch.add(a.email.toLowerCase()));
          });
        };
        if (thread) {
          collectFrom(thread.messages);
        } else if (bulkThreads && bulkThreads.length) {
          bulkThreads.forEach(th => collectFrom(th.messages));
        } else if (suggestEmails) {
          suggestEmails.forEach(e => emailsToMatch.add(e.toLowerCase()));
        }

        const suggestions = clients.filter(c =>
          c.contact_email && emailsToMatch.has(c.contact_email.toLowerCase())
        );
        setSuggested(suggestions);

        const alreadyAllocated = new Set(existingAllocations.map(a => a.client_id));
        const autoSelect = new Set<string>([
          // In compose mode, start from preSelectedIds; in thread mode, auto-select suggestions
          ...(isComposeMode
            ? (preSelectedIds ?? [])
            : suggestions.map(c => c.id).filter(id => !alreadyAllocated.has(id))
          ),
        ]);
        // In thread mode, also re-select suggestions not yet allocated
        if (!isComposeMode) {
          suggestions.forEach(c => { if (!alreadyAllocated.has(c.id)) autoSelect.add(c.id); });
        }
        setSelected(autoSelect);
        // Pre-populate selectedObjects for any auto-selected clients
        const autoObjects = new Map<string, Client>();
        clients.filter(c => autoSelect.has(c.id)).forEach(c => autoObjects.set(c.id, c));
        setSelectedObjects(autoObjects);
      })
      .catch(() => {});

    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, thread, bulkThreads, suggestEmails]);

  const alreadyAllocated = new Set(existingAllocations.map(a => a.client_id));

  // Use server search results when query is active, otherwise show all loaded clients
  const displayList = query.trim() ? searchResults : allClients;

  function toggleClient(id: string) {
    const clientObj = displayList.find(c => c.id === id) ?? allClients.find(c => c.id === id);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedObjects(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else if (clientObj) next.set(id, clientObj);
      return next;
    });
  }

  async function handleAllocate() {
    if (selected.size === 0) return;

    // Compose mode — return selection without calling API
    if (isComposeMode) {
      const selectedClients = Array.from(selected)
        .map(id => selectedObjects.get(id) ?? allClients.find(c => c.id === id))
        .filter((c): c is Client => !!c);
      onSelect!(selectedClients);
      onClose();
      return;
    }

    // Bulk mode — allocate every selected thread to the chosen client(s).
    if (bulkThreads && bulkThreads.length) {
      setSaving(true);
      setError(null);
      try {
        await Promise.all(bulkThreads.map(th => {
          const lastMsg = th.messages[th.messages.length - 1];
          return fetch('/api/email/allocate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              threadId: th.gmailThreadId ?? th.id,
              messageId: lastMsg?.id,
              subject: th.subject,
              snippet: th.snippet,
              date: lastMsg?.date ?? '',
              fromName: lastMsg?.from?.name ?? '',
              fromEmail: lastMsg?.from?.email ?? '',
              clientIds: Array.from(selected),
            }),
          });
        }));
        onAllocated?.(Array.from(selected));
        onClose();
      } catch {
        setError('Failed to allocate. Please try again.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Thread mode — save to API
    if (!thread) return;
    setSaving(true);
    setError(null);
    try {
      const lastMsg = thread.messages[thread.messages.length - 1];
      const res = await fetch('/api/email/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.gmailThreadId ?? thread.id,
          // Tag the allocation against the latest message in the thread so
          // each new arrival gets its own timeline note instead of being
          // swallowed by the thread-level dedupe.
          messageId: lastMsg?.id,
          subject: thread.subject,
          snippet: thread.snippet,
          date: lastMsg?.date ?? '',
          fromName: lastMsg?.from.name ?? '',
          fromEmail: lastMsg?.from.email ?? '',
          clientIds: Array.from(selected),
        }),
      });
      if (!res.ok) throw new Error('Failed');
      onAllocated?.(Array.from(selected));
      onClose();
    } catch {
      setError('Failed to allocate. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-lg bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border)] flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[var(--accent-light)] flex items-center justify-center">
              <UserPlus size={15} className="text-[var(--accent)]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Allocate to Client</h3>
              <p className="text-xs text-[var(--text-muted)] truncate max-w-xs">
                {thread?.subject
                  ?? (bulkThreads && bulkThreads.length
                    ? `Allocate ${bulkThreads.length} email${bulkThreads.length !== 1 ? 's' : ''} to the same client(s)`
                    : 'Select clients to allocate this email to')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-nav-hover)]">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Suggested */}
        {suggested.length > 0 && (
          <div className="px-5 pt-3 pb-2 shrink-0">
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Suggested (email match)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggested.map(c => {
                const isSel = selected.has(c.id);
                const isDone = !isComposeMode && alreadyAllocated.has(c.id);
                const statusKey = (c.risk_rating ?? 'active').toLowerCase();
                return (
                  <button
                    key={c.id}
                    onClick={() => !isDone && toggleClient(c.id)}
                    disabled={isDone}
                    className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-lg border text-xs font-medium transition-colors
                      ${isDone ? 'opacity-50 cursor-default border-[var(--border)] text-[var(--text-muted)]' :
                        isSel ? 'bg-[var(--accent)] border-[var(--accent)] text-white' :
                        'border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-light)]'}`}
                  >
                    {(isDone || isSel) && <Check size={11} />}
                    {c.name}
                    {c.client_ref && <span className="opacity-70 font-normal">{c.client_ref}</span>}
                    {!isDone && c.risk_rating && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${
                        isSel ? 'bg-white/20 text-white' : STATUS_COLOURS[statusKey] ?? STATUS_COLOURS.active
                      }`}>
                        {c.risk_rating}
                      </span>
                    )}
                    {isDone && <span className="opacity-70 font-normal">· already added</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Already allocated (thread mode only) */}
        {!isComposeMode && existingAllocations.length > 0 && (
          <div className="px-5 pb-2 shrink-0">
            <p className="text-[11px] font-medium text-[var(--text-muted)]">
              Already on timeline:{' '}
              {existingAllocations.map((a, i) => (
                <span key={a.client_id} className="text-[var(--text-secondary)]">
                  {a.clients?.name ?? 'Client'}{i < existingAllocations.length - 1 ? ', ' : ''}
                </span>
              ))}
              {existingAllocations[0]?.users?.full_name && (
                <span> — added by {existingAllocations[0].users.full_name}</span>
              )}
            </p>
          </div>
        )}

        {/* Search */}
        <div className="px-5 pb-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, code, or email…"
              className="input-base pl-8 text-sm"
            />
          </div>
        </div>

        {/* Client list */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 bg-[var(--bg-page)]">
          {searching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : displayList.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">
              {query.trim() ? 'No clients found' : 'No clients'}
            </p>
          ) : (
            <div className="space-y-1">
              {displayList.map(c => {
                const isSel = selected.has(c.id);
                const isDone = !isComposeMode && alreadyAllocated.has(c.id);
                const statusKey = (c.risk_rating ?? 'active').toLowerCase();
                return (
                  <button
                    key={c.id}
                    onClick={() => !isDone && toggleClient(c.id)}
                    disabled={isDone}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left
                      ${isDone ? 'opacity-50 cursor-default border-transparent' :
                        isSel ? 'bg-[var(--accent-light)] border-[var(--accent)]/30' :
                        'border-transparent hover:bg-[var(--bg-nav-hover)]'}`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors
                      ${isDone ? 'bg-emerald-100 border-emerald-300 dark:bg-emerald-900/30' :
                        isSel ? 'bg-[var(--accent)] border-[var(--accent)]' :
                        'border-[var(--border-input)]'}`}>
                      {(isSel || isDone) && <Check size={11} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                      {c.contact_email && (
                        <p className="text-xs text-[var(--text-muted)] truncate">{c.contact_email}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {c.client_ref && <span className="text-[11px] text-[var(--text-muted)]">{c.client_ref}</span>}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLOURS[statusKey] ?? STATUS_COLOURS.active}`}>
                        {isDone ? 'Added' : statusKey}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] shrink-0 flex items-center justify-between gap-3 bg-[var(--bg-nav-hover)] rounded-b-xl">
          <div>
            {selected.size > 0 && (
              <p className="text-xs text-[var(--text-muted)]">{selected.size} client{selected.size !== 1 ? 's' : ''} selected</p>
            )}
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{error}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={handleAllocate}
              disabled={selected.size === 0 || saving}
              className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? 'Allocating…' : 'Allocate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
