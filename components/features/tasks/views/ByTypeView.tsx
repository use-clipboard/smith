'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

interface Props {
  tasks: Task[];
  currentUserId: string;
  search: string; onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all' | 'open'; onStatusChange: (v: TaskStatus | 'all' | 'open') => void;
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

const BY_TYPE_COLUMNS: TaskColumn<SortField>[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 360, minWidth: 200, sortField: 'task'   },
  { id: 'client',    label: 'Client',    defaultWidth: 220, minWidth: 120, sortField: 'client' },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90,  sortField: 'status' },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90                          },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110, sortField: 'due'    },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80                           },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];

export default function ByTypeView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  // Group by template name (or "Ad Hoc" if no template), then sort within each group
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    dueFiltered.forEach(t => {
      const key = t.template_id
        ? (t.title.split(' – ')[0] ?? t.title)
        : 'Ad Hoc';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    map.forEach((arr, k) => {
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
      map.set(k, copy);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [dueFiltered, sort, clientNameById]);

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

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
            <ExportTasksButton tasks={dueFiltered} filename="tasks-by-type" />
            <ViewModeToggle />
          </div>
        </div>
      </div>

      <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={filtered.length} counts={dueCounts} className="mb-4" />

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks found.</p></div>
      ) : viewMode === 'list' ? (
        <TaskTable<SortField>
          viewKey="byType"
          columns={BY_TYPE_COLUMNS}
          sortField={sort.field}
          sortDir={sort.dir}
          onToggleSort={toggleSort}
        >
          {grouped.map(([key, typeTasks]) => {
            const isOpen = expanded.has(key) || typeTasks.length <= 3;
            const active = typeTasks.filter(t => t.status !== 'complete').length;
            return (
              <tbody key={key} className="border-b border-gray-100 last:border-0">
                <tr className="bg-gray-50/60">
                  <td colSpan={7} className="px-0 py-0">
                    <button onClick={() => toggle(key)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-2.5">
                        {isOpen
                          ? <ChevronDown  className="h-3.5 w-3.5 text-gray-400" />
                          : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                        <span className="font-semibold text-sm text-gray-900">{key}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{active} active · {typeTasks.length} total</span>
                      </div>
                    </button>
                  </td>
                </tr>
                {isOpen && typeTasks.map(t => <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
              </tbody>
            );
          })}
        </TaskTable>
      ) : (
        <div className="space-y-3">
        {grouped.map(([key, typeTasks]) => {
          const isOpen = expanded.has(key) || typeTasks.length <= 3;
          const active = typeTasks.filter(t => t.status !== 'complete').length;
          return (
            <div key={key} className="bg-white border border-gray-200 rounded-lg">
              <button onClick={() => toggle(key)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 rounded-t-lg border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-gray-900">{key}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {active} active · {typeTasks.length} total
                  </span>
                </div>
                {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              </button>
              {isOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4 border-t border-gray-100">
                  {typeTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
