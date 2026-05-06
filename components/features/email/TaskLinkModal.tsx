'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Check, Search, CheckSquare, AlertCircle } from 'lucide-react';
import type { EmailThread as EmailThreadType } from '@/lib/gmail';

export interface Task {
  id: string;
  title: string;
  status: string;
  client?: { name: string } | null;
}

interface TaskLink {
  task_id: string;
  tasks: { id: string; title: string; status: string } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  thread?: EmailThreadType | null;
  existingLinks?: TaskLink[];
  /** Called in thread mode after successful API save */
  onLinked?: (taskId: string) => void;
  /** Called in compose mode — no API call, just returns selection */
  onSelect?: (task: Task) => void;
  /** Pre-populate selection (compose mode) */
  preSelectedTaskId?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  waiting_on_client: 'Waiting',
  review: 'Review',
  complete: 'Complete',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

const STATUS_COLOURS: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  on_hold: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function TaskLinkModal({
  open, onClose, thread, existingLinks = [], onLinked, onSelect, preSelectedTaskId,
}: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isComposeMode = !!onSelect;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedTaskId(preSelectedTaskId ?? null);
    setError(null);
    setLoading(true);
    fetch('/api/tasks?limit=50&status=not_started,in_progress,waiting_on_client,review')
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then((data: { tasks?: Task[] }) => setTasks(data.tasks ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, preSelectedTaskId]);

  const alreadyLinked = new Set(existingLinks.map(l => l.task_id));

  const filtered = tasks.filter(t => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      (t.client?.name ?? '').toLowerCase().includes(q)
    );
  });

  async function handleLink() {
    if (!selectedTaskId) return;

    // Compose mode — return selection without calling API
    if (isComposeMode) {
      const task = tasks.find(t => t.id === selectedTaskId);
      if (task) onSelect!(task);
      onClose();
      return;
    }

    // Thread mode — save to API
    if (!thread) return;
    setLinking(true);
    setError(null);
    try {
      const res = await fetch('/api/email/task-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
          taskId: selectedTaskId,
          subject: thread.subject,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      onLinked?.(selectedTaskId);
      onClose();
    } catch {
      setError('Failed to link task. Please try again.');
    } finally {
      setLinking(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-lg bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border)] flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <CheckSquare size={15} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Link to Task</h3>
              <p className="text-xs text-[var(--text-muted)] truncate max-w-xs">
                {thread?.subject ?? 'Select a task to link this email to'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-nav-hover)]">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Already linked (thread mode only) */}
        {!isComposeMode && existingLinks.length > 0 && (
          <div className="px-5 pt-3 pb-1 shrink-0">
            <p className="text-[11px] font-medium text-[var(--text-muted)]">
              Already linked:{' '}
              {existingLinks.map((l, i) => (
                <span key={l.task_id} className="text-[var(--text-secondary)]">
                  {l.tasks?.title ?? 'Task'}{i < existingLinks.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          </div>
        )}

        {/* Search */}
        <div className="px-5 py-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="input-base pl-8 text-sm"
            />
          </div>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 bg-[var(--bg-page)]">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-[var(--text-muted)]" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">No active tasks found</p>
          ) : (
            <div className="space-y-1">
              {filtered.map(t => {
                const isSel = selectedTaskId === t.id;
                const isDone = !isComposeMode && alreadyLinked.has(t.id);
                const statusKey = t.status as string;
                return (
                  <button
                    key={t.id}
                    onClick={() => !isDone && setSelectedTaskId(isSel ? null : t.id)}
                    disabled={isDone}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left
                      ${isDone ? 'opacity-50 cursor-default border-transparent' :
                        isSel ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' :
                        'border-transparent hover:bg-[var(--bg-nav-hover)]'}`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors
                      ${isDone ? 'bg-emerald-100 border-emerald-300' :
                        isSel ? 'bg-blue-600 border-blue-600' :
                        'border-[var(--border-input)]'}`}>
                      {(isSel || isDone) && <Check size={11} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.title}</p>
                      {t.client?.name && (
                        <p className="text-xs text-[var(--text-muted)] truncate">{t.client.name}</p>
                      )}
                    </div>
                    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLOURS[statusKey] ?? STATUS_COLOURS.not_started}`}>
                      {isDone ? 'Linked' : STATUS_LABELS[statusKey] ?? statusKey}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] shrink-0 flex items-center justify-between gap-3 bg-[var(--bg-nav-hover)] rounded-b-xl">
          <div>
            {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={handleLink}
              disabled={!selectedTaskId || linking}
              className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {linking ? <Loader2 size={13} className="animate-spin" /> : <CheckSquare size={13} />}
              {linking ? 'Linking…' : 'Link Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
