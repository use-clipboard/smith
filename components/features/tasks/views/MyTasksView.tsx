'use client';

import { useMemo } from 'react';
import TaskCard from '../TaskCard';
import TaskFilters from '../TaskFilters';
import { TaskStatusBadge } from '../TaskStatusBadge';
import type { Task, TaskStatus } from '@/types';

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
}

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'review', 'not_started', 'complete'];

export default function MyTasksView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick }: Props) {
  const myTasks = useMemo(() => {
    return tasks.filter(t => {
      const isMine = t.created_by === currentUserId || t.steps?.some(s => s.assignee_id === currentUserId);
      if (!isMine) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (clientFilter === 'internal' && !t.is_internal) return false;
      if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
      return true;
    });
  }, [tasks, currentUserId, search, statusFilter, clientFilter]);

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
    <div className="space-y-4">
      <TaskFilters
        search={search} onSearchChange={onSearchChange}
        statusFilter={statusFilter} onStatusChange={onStatusChange}
        clientFilter={clientFilter} onClientChange={onClientChange}
        assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
        clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
      />

      {myTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No tasks assigned to you.</p>
        </div>
      ) : (
        STATUS_ORDER.map(status => {
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
                  <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
