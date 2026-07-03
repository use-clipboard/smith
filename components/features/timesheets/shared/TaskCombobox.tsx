'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check, CheckSquare, X } from 'lucide-react';

export interface PickedTask {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
}

interface Props {
  value: string | null;
  /** Display label when a task is linked but the list hasn't loaded yet. */
  label?: string;
  onChange: (task: PickedTask | null) => void;
}

interface TaskDto {
  id: string;
  title: string;
  client_id?: string | null;
  client?: { name?: string } | null;
}

/** Searchable picker over the firm's tasks. Lets a Timesheets entry/timer link
 *  to a specific task; selecting one lets the caller auto-fill the client. */
export default function TaskCombobox({ value, label, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<PickedTask[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazy-load the task list the first time the picker opens.
  useEffect(() => {
    if (!open || tasks) return;
    let cancelled = false;
    fetch('/api/tasks')
      .then(r => (r.ok ? r.json() : { tasks: [] }))
      .then(d => {
        if (cancelled) return;
        const list = ((d.tasks ?? []) as TaskDto[]).map(t => ({
          id: t.id, title: t.title, clientId: t.client_id ?? null, clientName: t.client?.name ?? '',
        }));
        setTasks(list);
      })
      .catch(() => { if (!cancelled) setTasks([]); });
    return () => { cancelled = true; };
  }, [open, tasks]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => { document.removeEventListener('mousedown', onDoc); window.clearTimeout(t); };
  }, [open]);

  const selected = value ? (tasks?.find(t => t.id === value) ?? null) : null;
  const displayText = selected?.title || (value ? (label || 'Linked task') : null);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? tasks.filter(t => t.title.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q))
      : tasks;
    return list.slice(0, 60);
  }, [tasks, query]);

  const pick = (t: PickedTask | null) => { onChange(t); setOpen(false); setQuery(''); };

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="input-base flex items-center justify-between gap-2 text-left">
        <span className={`flex min-w-0 items-center gap-1.5 ${displayText ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
          {displayText && <CheckSquare size={13} className="shrink-0 text-[var(--accent)]" />}
          <span className="truncate">{displayText ?? 'Link a task (optional)'}</span>
        </span>
        {value ? (
          <X size={14} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={e => { e.stopPropagation(); pick(null); }} />
        ) : (
          <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-[0_12px_40px_rgba(31,38,88,0.18)]">
          <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2">
            <Search size={14} className="text-[var(--text-muted)]" />
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks…"
              className="w-full bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" />
          </div>
          <div className="max-h-60 overflow-y-auto scrollbar-thin py-1">
            {tasks === null && <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">Loading tasks…</p>}
            {tasks !== null && filtered.map(t => (
              <button key={t.id} type="button" onClick={() => pick(t)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.04]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{t.title}</p>
                  {t.clientName && <p className="truncate text-[10.5px] text-[var(--text-muted)]">{t.clientName}</p>}
                </div>
                {value === t.id && <Check size={14} className="ml-auto shrink-0 text-[var(--accent)]" />}
              </button>
            ))}
            {tasks !== null && filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">No tasks match “{query}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
