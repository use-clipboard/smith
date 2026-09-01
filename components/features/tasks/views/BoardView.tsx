'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import TaskCard from '../TaskCard';
import type { Task, TaskStatus } from '@/types';

// Kanban board — tasks grouped into status columns. Cards reuse the shared
// TaskCard so they look and behave exactly like the grid view. Drag a card into
// another column to change its status; clicking opens the detail panel.

interface Props {
  tasks: Task[];
  currentUserId: string;
  onTaskClick: (task: Task) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  isAdmin?: boolean;
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

const COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: 'not_started',       label: 'Not Started',       dot: '#94a3b8' },
  { status: 'in_progress',       label: 'In Progress',       dot: '#2563eb' },
  { status: 'records_here',      label: 'Records Here',      dot: '#7c3aed' },
  { status: 'review',            label: 'Review',            dot: '#0891b2' },
  { status: 'waiting_on_client', label: 'Waiting on Client', dot: '#d97706' },
  { status: 'complete',          label: 'Complete',          dot: '#16a34a' },
];

export default function BoardView({ tasks, currentUserId, onTaskClick, onTaskUpdate, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  // Optimistic move: the card jumps to the new column immediately and shows a
  // spinner while the PUT (and the parent's full refetch) completes — otherwise
  // the card only moves once every task has been refetched, which feels laggy.
  const [pending, setPending] = useState<Record<string, TaskStatus>>({}); // id → optimistic status
  const [moving, setMoving] = useState<Set<string>>(new Set());           // ids currently saving

  // Drop each optimistic override once the incoming props actually reflect it
  // (or the task disappears from view), so props stay the source of truth.
  useEffect(() => {
    setPending(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [id, st] of Object.entries(prev)) {
        const t = tasks.find(x => x.id === id);
        if (!t || t.status === st) { delete next[id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const effectiveStatus = (t: Task): TaskStatus => pending[t.id] ?? t.status;

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    COLUMNS.forEach(c => m.set(c.status, []));
    for (const t of tasks) {
      const st = pending[t.id] ?? t.status;
      if (!m.has(st)) m.set(st, []);
      m.get(st)!.push(t);
    }
    return m;
  }, [tasks, pending]);

  function handleDrop(status: TaskStatus) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      setOverCol(null);
      const id = e.dataTransfer.getData('text/task-id') || dragId;
      setDragId(null);
      if (!id) return;
      const t = tasks.find(x => x.id === id);
      if (!t || effectiveStatus(t) === status || !onTaskUpdate) return;
      // Move now, save in the background.
      setPending(p => ({ ...p, [id]: status }));
      setMoving(m => new Set(m).add(id));
      onTaskUpdate(id, { status })
        .catch(() => { setPending(p => { const n = { ...p }; delete n[id]; return n; }); }) // revert on failure
        .finally(() => { setMoving(m => { const n = new Set(m); n.delete(id); return n; }); });
    };
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max">
        {COLUMNS.map(col => {
          const items = byStatus.get(col.status) ?? [];
          const isOver = overCol === col.status;
          return (
            <div
              key={col.status}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overCol !== col.status) setOverCol(col.status); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(c => (c === col.status ? null : c)); }}
              onDrop={handleDrop(col.status)}
              className={`w-[300px] flex-shrink-0 border rounded-2xl flex flex-col max-h-[calc(100vh-320px)] transition-colors ${isOver ? 'border-indigo-300 bg-indigo-50/50 ring-2 ring-indigo-200' : 'bg-gray-50/70 border-gray-200'}`}
            >
              <div className="flex items-center gap-2 px-3.5 py-3 border-b border-gray-100 flex-shrink-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.dot }} />
                <span className="text-[13px] font-bold text-gray-800">{col.label}</span>
                <span className="ml-auto text-[11px] font-bold text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5 tabular-nums">{items.length}</span>
              </div>
              <div className="p-2.5 flex flex-col gap-2.5 overflow-y-auto">
                {items.length === 0
                  ? <p className="text-center text-xs text-gray-400 py-8">{isOver ? 'Drop to move here' : 'No tasks'}</p>
                  : items.map(t => {
                    const isMoving = moving.has(t.id);
                    return (
                      <div
                        key={t.id}
                        draggable={!isMoving}
                        onDragStart={e => { e.dataTransfer.setData('text/task-id', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
                        onDragEnd={() => { setDragId(null); setOverCol(null); }}
                        className={`relative transition-opacity ${isMoving ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'} ${dragId === t.id ? 'opacity-50' : ''} ${isMoving ? 'opacity-70' : ''}`}
                      >
                        <TaskCard task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                        {isMoving && (
                          <div className="absolute inset-0 rounded-2xl bg-white/40 backdrop-blur-[1px] grid place-items-center pointer-events-none">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 bg-white/90 border border-indigo-100 shadow-sm rounded-full px-2.5 py-1">
                              <Loader2 className="h-3 w-3 animate-spin" /> Moving…
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
