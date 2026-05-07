'use client';

import { useMemo } from 'react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskFilters from '../TaskFilters';
import { TaskStatusBadge } from '../TaskStatusBadge';
import ExportTasksButton from '../ExportTasksButton';
import type { Task, TaskStatus, TaskStep } from '@/types';

interface Props {
  tasks: Task[];
  currentUserId: string;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all';
  onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string;
  onClientChange: (v: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  onClearFilters: () => void;
  onTaskClick: (task: Task) => void;
  onStepUpdate?: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  viewMode: 'grid' | 'list';
  isAdmin?: boolean;
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'records_here', 'review', 'not_started', 'complete'];

export default function MyTasksView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const myTasks = useMemo(() => {
    return tasks.filter(t => {
      const isMine = t.created_by === currentUserId || t.steps?.some(s => s.assignee_id === currentUserId);
      if (!isMine) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (clientFilter === 'internal' && !t.is_internal) return false;
      if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
      if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
      return true;
    });
  }, [tasks, currentUserId, search, statusFilter, clientFilter, assigneeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    STATUS_ORDER.forEach(s => map.set(s, []));
    myTasks.forEach(t => {
      const bucket = map.get(t.status) ?? [];
      bucket.push(t);
      map.set(t.status, bucket);
    });
    return map;
  }, [myTasks]);

  return (
    <div>
      <div className="sticky top-0 z-20 bg-gray-50 flex items-center justify-between flex-wrap gap-2 pb-4">
        <TaskFilters
          search={search} onSearchChange={onSearchChange}
          statusFilter={statusFilter} onStatusChange={onStatusChange}
          clientFilter={clientFilter} onClientChange={onClientChange}
          assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
          clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
        />
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-400">{myTasks.length} task{myTasks.length !== 1 ? 's' : ''}</p>
          <ExportTasksButton tasks={myTasks} filename="my-tasks" />
        </div>
      </div>

      {myTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No tasks assigned to you.</p>
        </div>
      ) : viewMode === 'list' ? (
        /* ── List view ── */
        <div className="bg-white border border-gray-200 rounded-xl">
          <table className="w-full text-left">
            <thead className="sticky top-[50px] z-10">
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-tl-xl">Task</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progress</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Due</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-tr-xl">Assignees</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_ORDER.map(status => {
                const bucket = grouped.get(status) ?? [];
                return bucket.map(t => (
                  <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                ));
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Grid view ── */
        <div className="space-y-4">
          {STATUS_ORDER.map(status => {
            const bucket = grouped.get(status) ?? [];
            if (bucket.length === 0) return null;
            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3">
                  <TaskStatusBadge status={status} />
                  <span className="text-xs text-gray-400">({bucket.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bucket.map(t => (
                    <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
