'use client';

import { useMemo, useState } from 'react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskFilters from '../TaskFilters';
import ExportTasksButton from '../ExportTasksButton';
import DueWindowChips from '../DueWindowChips';
import ViewModeToggle from '../ViewModeToggle';
import { type SortDir } from '../SortHeader';
import TaskTable, { type TaskColumn } from '../TaskTable';
import { type DueWindow, classifyTasks, applyDueFilter } from '../dueWindow';
import type { Task, TaskStatus, TaskStep } from '@/types';

interface TeamMember { id: string; full_name: string | null; email: string }

interface Props {
  tasks: Task[];
  currentUserId: string;
  teamMembers: TeamMember[];
  search: string; onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all' | 'open'; onStatusChange: (v: TaskStatus | 'all' | 'open') => void;
  clientFilter: string; onClientChange: (v: string) => void;
  assigneeFilter: string; onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];
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
type SortField = 'task' | 'client' | 'status' | 'due';

const BY_TEAM_COLUMNS: TaskColumn<SortField>[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 360, minWidth: 200, sortField: 'task'   },
  { id: 'client',    label: 'Client',    defaultWidth: 220, minWidth: 120, sortField: 'client' },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90,  sortField: 'status' },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90                          },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110, sortField: 'due'    },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80                           },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];

export default function ByTeamView({ tasks, currentUserId, teamMembers, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [dueFilter, setDueFilter] = useState<DueWindow>('all');
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'due', dir: 'asc' });

  const filtered = useMemo(() => tasks.filter(t => {
    if (search) {
      const needle = search.toLowerCase();
      const hay = `${t.title} ${t.client?.name ?? ''} ${t.client?.client_ref ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (statusFilter === 'open' ? t.status === 'complete' : (statusFilter !== 'all' && t.status !== statusFilter)) return false;
    if (clientFilter === 'internal' && !t.is_internal) return false;
    if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
    return true;
  }), [tasks, search, statusFilter, clientFilter]);

  const { classMap: dueClassMap, counts: dueCounts } = useMemo(() => classifyTasks(filtered), [filtered]);
  const dueFiltered = useMemo(() => applyDueFilter(filtered, dueClassMap, dueFilter), [filtered, dueClassMap, dueFilter]);

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  function sortTasks(arr: Task[]): Task[] {
    const copy = [...arr];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.field === 'due') {
        const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        cmp = ad - bd;
      } else if (sort.field === 'task') {
        cmp = a.title.localeCompare(b.title);
      } else if (sort.field === 'client') {
        const an = a.is_internal ? 'Internal' : (a.client_id ? clientNameById.get(a.client_id) ?? '' : '');
        const bn = b.is_internal ? 'Internal' : (b.client_id ? clientNameById.get(b.client_id) ?? '' : '');
        cmp = an.localeCompare(bn);
      } else if (sort.field === 'status') {
        cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }

  // Group tasks by team member — a task appears under each assignee that has a step
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    teamMembers.forEach(m => map.set(m.id, []));
    map.set('__unassigned__', []);

    dueFiltered.forEach(t => {
      const assigneeIds = new Set(t.steps?.filter(s => s.assignee_id).map(s => s.assignee_id!) ?? []);
      if (assigneeIds.size === 0) {
        map.get('__unassigned__')!.push(t);
      } else {
        assigneeIds.forEach(id => {
          if (map.has(id)) map.get(id)!.push(t);
        });
      }
    });

    // Apply current sort to each member's task list
    map.forEach((arr, k) => map.set(k, sortTasks(arr)));

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueFiltered, teamMembers, sort, clientNameById]);

  const activeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    grouped.forEach((memberTasks, id) => counts.set(id, memberTasks.filter(t => t.status !== 'complete').length));
    return counts;
  }, [grouped]);

  return (
    <div>
      <div className="sticky top-0 z-20 backdrop-blur-md pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TaskFilters
            search={search} onSearchChange={onSearchChange}
            statusFilter={statusFilter} onStatusChange={onStatusChange}
            clientFilter={clientFilter} onClientChange={onClientChange}
            assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
            clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
          />
          <div className="flex items-center gap-2">
            <ExportTasksButton tasks={dueFiltered} filename="tasks-by-team" />
            <ViewModeToggle />
          </div>
        </div>
      </div>

      <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={filtered.length} counts={dueCounts} className="mb-4" />

      {viewMode === 'list' ? (
        <TaskTable<SortField>
          viewKey="byTeam"
          columns={BY_TEAM_COLUMNS}
          sortField={sort.field}
          sortDir={sort.dir}
          onToggleSort={toggleSort}
        >
          {[...teamMembers, { id: '__unassigned__', full_name: 'Unassigned', email: '' }]
            .filter(member => !assigneeFilter || member.id === assigneeFilter)
            .map(member => {
              const memberTasks = grouped.get(member.id) ?? [];
              if (memberTasks.length === 0) return null;
              const initials = (member.full_name ?? member.email).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
              const activeCount = activeCounts.get(member.id) ?? 0;
              return (
                <tbody key={member.id} className="border-b border-gray-100 last:border-0">
                  <tr className="bg-gray-50/60">
                    <td colSpan={7} className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        <div className="h-6 w-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-white">{initials}</span>
                        </div>
                        <p className="font-semibold text-sm text-gray-900">{member.full_name ?? member.email}</p>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{activeCount} active · {memberTasks.length} total</span>
                      </div>
                    </td>
                  </tr>
                  {memberTasks.map(t => <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                </tbody>
              );
            })}
        </TaskTable>
      ) : (
        <div className="space-y-3">
          {[...teamMembers, { id: '__unassigned__', full_name: 'Unassigned', email: '' }]
            .filter(member => !assigneeFilter || member.id === assigneeFilter)
            .map(member => {
              const memberTasks = grouped.get(member.id) ?? [];
              if (memberTasks.length === 0) return null;
              const initials = (member.full_name ?? member.email).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
              const activeCount = activeCounts.get(member.id) ?? 0;
              return (
                <div key={member.id} className="bg-white border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 rounded-t-lg">
                    <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-white">{initials}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{member.full_name ?? member.email}</p>
                      <p className="text-xs text-gray-400">{activeCount} active · {memberTasks.length} total</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                    {memberTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
