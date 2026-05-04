'use client';

import { useMemo } from 'react';
import TaskCard from '../TaskCard';
import TaskFilters from '../TaskFilters';
import { TaskStatusBadge } from '../TaskStatusBadge';
import type { Task, TaskStatus } from '@/types';

interface TeamMember { id: string; full_name: string | null; email: string }

interface Props {
  tasks: Task[];
  currentUserId: string;
  teamMembers: TeamMember[];
  search: string; onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all'; onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string; onClientChange: (v: string) => void;
  assigneeFilter: string; onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];
  onClearFilters: () => void;
  onTaskClick: (task: Task) => void;
}

export default function ByTeamView({ tasks, currentUserId, teamMembers, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, onClearFilters, onTaskClick }: Props) {
  const filtered = useMemo(() => tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (clientFilter === 'internal' && !t.is_internal) return false;
    if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
    return true;
  }), [tasks, search, statusFilter, clientFilter]);

  // Group tasks by team member — a task appears under each assignee that has a step
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    teamMembers.forEach(m => map.set(m.id, []));
    map.set('__unassigned__', []);

    filtered.forEach(t => {
      const assigneeIds = new Set(t.steps?.filter(s => s.assignee_id).map(s => s.assignee_id!) ?? []);
      if (assigneeIds.size === 0) {
        map.get('__unassigned__')!.push(t);
      } else {
        assigneeIds.forEach(id => {
          if (map.has(id)) map.get(id)!.push(t);
        });
      }
    });

    return map;
  }, [filtered, teamMembers]);

  const activeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    grouped.forEach((tasks, id) => counts.set(id, tasks.filter(t => t.status !== 'complete').length));
    return counts;
  }, [grouped]);

  return (
    <div className="space-y-4">
      <TaskFilters
        search={search} onSearchChange={onSearchChange}
        statusFilter={statusFilter} onStatusChange={onStatusChange}
        clientFilter={clientFilter} onClientChange={onClientChange}
        assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
        clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
      />

      {[...teamMembers, { id: '__unassigned__', full_name: 'Unassigned', email: '' }].map(member => {
        const memberTasks = grouped.get(member.id) ?? [];
        if (memberTasks.length === 0) return null;
        const initials = (member.full_name ?? member.email).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const activeCount = activeCounts.get(member.id) ?? 0;

        return (
          <div key={member.id} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-white">{initials}</span>
              </div>
              <div>
                <p className="font-semibold text-sm text-gray-900">{member.full_name ?? member.email}</p>
                <p className="text-xs text-gray-400">{activeCount} active · {memberTasks.length} total</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {memberTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
