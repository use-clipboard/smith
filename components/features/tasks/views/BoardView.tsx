'use client';

import { useMemo, useState } from 'react';
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

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    COLUMNS.forEach(c => m.set(c.status, []));
    for (const t of tasks) {
      if (!m.has(t.status)) m.set(t.status, []);
      m.get(t.status)!.push(t);
    }
    return m;
  }, [tasks]);

  function handleDrop(status: TaskStatus) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      setOverCol(null);
      const id = e.dataTransfer.getData('text/task-id') || dragId;
      setDragId(null);
      if (!id) return;
      const t = tasks.find(x => x.id === id);
      if (t && t.status !== status) void onTaskUpdate?.(id, { status });
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
                  : items.map(t => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('text/task-id', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      className={`cursor-grab active:cursor-grabbing ${dragId === t.id ? 'opacity-50' : ''}`}
                    >
                      <TaskCard task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
