'use client';

import { useMemo, useState } from 'react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskFilters from '../TaskFilters';
import { TaskStatusBadge } from '../TaskStatusBadge';
import ExportTasksButton from '../ExportTasksButton';
import DueWindowChips from '../DueWindowChips';
import ViewModeToggle from '../ViewModeToggle';
import { type SortDir } from '../SortHeader';
import TaskTable, { type TaskColumn } from '../TaskTable';
import { useIncrementalList } from '@/hooks/useIncrementalList';
import { type DueWindow, classifyTasks, applyDueFilter } from '../dueWindow';
import type { Task, TaskStatus, TaskStep } from '@/types';

interface Props {
  tasks: Task[];
  currentUserId: string;
  search: string; onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all'; onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string; onClientChange: (v: string) => void;
  assigneeFilter: string; onAssigneeChange: (v: string) => void;
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

type SortField = 'task' | 'client' | 'status' | 'due';

const ALL_TASKS_COLUMNS: TaskColumn<SortField>[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 360, minWidth: 200, sortField: 'task'   },
  { id: 'client',    label: 'Client',    defaultWidth: 220, minWidth: 120, sortField: 'client' },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90,  sortField: 'status' },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90                          },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110, sortField: 'due'    },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80                           },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];

export default function AllTasksView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [dueFilter, setDueFilter] = useState<DueWindow>('all');
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'due', dir: 'asc' });

  const filtered = useMemo(() => tasks.filter(t => {
    if (search) {
      const needle = search.toLowerCase();
      const hay = `${t.title} ${t.client?.name ?? ''} ${t.client?.client_ref ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (clientFilter === 'internal' && !t.is_internal) return false;
    if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
    if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
    return true;
  }), [tasks, search, statusFilter, clientFilter, assigneeFilter]);

  const { classMap: dueClassMap, counts: dueCounts } = useMemo(() => classifyTasks(filtered), [filtered]);
  const dueFiltered = useMemo(() => applyDueFilter(filtered, dueClassMap, dueFilter), [filtered, dueClassMap, dueFilter]);

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const sortedTasks = useMemo(() => {
    const arr = [...dueFiltered];
    arr.sort((a, b) => {
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
    return arr;
  }, [dueFiltered, sort, clientNameById]);

  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  // List view renders in incremental batches so a few-hundred-row list paints
  // fast and only grows the DOM as the user scrolls toward the end.
  const { visible: visibleRows, sentinelRef, hasMore } = useIncrementalList(sortedTasks);

  // Grid view still groups by status, with active sort applied within each group
  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    STATUS_ORDER.forEach(s => map.set(s, []));
    sortedTasks.forEach(t => { const b = map.get(t.status) ?? []; b.push(t); map.set(t.status, b); });
    return map;
  }, [sortedTasks]);

  return (
    <div>
      <div className="sticky top-0 z-30 backdrop-blur-md pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3">
          <TaskFilters
            search={search} onSearchChange={onSearchChange}
            statusFilter={statusFilter} onStatusChange={onStatusChange}
            clientFilter={clientFilter} onClientChange={onClientChange}
            assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
            clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
          />
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-[var(--text-primary)]">{sortedTasks.length} of {filtered.length} task{filtered.length !== 1 ? 's' : ''}</p>
            <ExportTasksButton tasks={sortedTasks} filename="all-tasks" />
            <ViewModeToggle />
          </div>
        </div>
        <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={filtered.length} counts={dueCounts} />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks found.</p></div>
      ) : sortedTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks match the current filters.</p></div>
      ) : viewMode === 'list' ? (
        /* ── List view ── */
        <TaskTable<SortField>
          viewKey="allTasks"
          columns={ALL_TASKS_COLUMNS}
          sortField={sort.field}
          sortDir={sort.dir}
          onToggleSort={toggleSort}
        >
          <tbody>
            {visibleRows.map(t => (
              <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
            ))}
            {hasMore && (
              <tr ref={sentinelRef} aria-hidden>
                <td colSpan={ALL_TASKS_COLUMNS.length} className="py-3 text-center text-[11px] text-gray-400">
                  Loading more…
                </td>
              </tr>
            )}
          </tbody>
        </TaskTable>
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
                  {bucket.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
