'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskFilters from '../TaskFilters';
import ExportTasksButton from '../ExportTasksButton';
import DueWindowChips from '../DueWindowChips';
import SortHeader, { type SortDir } from '../SortHeader';
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

const STATUS_COLOURS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  hold:     'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-500',
};

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'records_here', 'review', 'not_started', 'complete'];
type SortField = 'task' | 'status' | 'due';

function sortTasks(tasks: Task[], field: SortField, dir: SortDir): Task[] {
  const arr = [...tasks];
  arr.sort((a, b) => {
    let cmp = 0;
    if (field === 'due') {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
      cmp = ad - bd;
    } else if (field === 'task') {
      cmp = a.title.localeCompare(b.title);
    } else if (field === 'status') {
      cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return arr;
}

export default function ByClientView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [showHistoryFor, setShowHistoryFor] = useState<Set<string>>(new Set());
  const [dueFilter, setDueFilter] = useState<DueWindow>('all');
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'due', dir: 'asc' });

  const filtered = useMemo(() => tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
    return true;
  }), [tasks, search, statusFilter, assigneeFilter]);

  const { classMap: dueClassMap, counts: dueCounts } = useMemo(() => classifyTasks(filtered), [filtered]);
  const dueFiltered = useMemo(() => applyDueFilter(filtered, dueClassMap, dueFilter), [filtered, dueClassMap, dueFilter]);

  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, {
      label: string;
      client_ref?: string;
      client_status?: string | null;
      active: Task[];
      history: Task[];
    }>();
    dueFiltered.forEach(t => {
      const key = t.client_id ?? '__internal__';
      const label = t.client?.name ?? 'Internal / No Client';
      if (!map.has(key)) map.set(key, {
        label,
        client_ref:    t.client?.client_ref,
        client_status: t.client?.status,
        active:  [],
        history: [],
      });
      const bucket = map.get(key)!;
      if (t.status === 'complete') bucket.history.push(t);
      else bucket.active.push(t);
    });
    // Apply current sort to each bucket
    map.forEach(bucket => {
      bucket.active = sortTasks(bucket.active, sort.field, sort.dir);
      bucket.history = sortTasks(bucket.history, sort.field, sort.dir);
    });
    return Array.from(map.entries()).sort(([, a], [, b]) => a.label.localeCompare(b.label));
  }, [dueFiltered, sort]);

  function toggle(key: string) {
    setExpandedClients(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  function toggleHistory(key: string) {
    setShowHistoryFor(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  return (
    <div>
      {/* Filters — sticky at top of scroll container */}
      <div className="sticky top-0 z-30 bg-gray-50 pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TaskFilters
            search={search} onSearchChange={onSearchChange}
            statusFilter={statusFilter} onStatusChange={onStatusChange}
            clientFilter={clientFilter} onClientChange={onClientChange}
            assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
            clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
          />
          <ExportTasksButton tasks={dueFiltered} filename="tasks-by-client" />
        </div>
      </div>

      <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={filtered.length} counts={dueCounts} className="mb-4" />

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks found.</p></div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([key, { label, client_ref, client_status, active, history }]) => {
            const isExpanded = expandedClients.has(key) || active.length <= 3;
            const showHistory = showHistoryFor.has(key);

            return (
              <div key={key} className="bg-white border border-gray-200 rounded-lg">
                {/* Section header — sticky below the filters bar */}
                <button
                  onClick={() => toggle(key)}
                  className="sticky top-[50px] z-20 w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors rounded-lg border-b border-gray-100"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{label}</span>
                    {client_ref && (
                      <span className="text-xs font-mono text-gray-400">{client_ref}</span>
                    )}
                    {client_status && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                        STATUS_COLOURS[client_status] ?? 'bg-gray-100 text-gray-500'
                      }`}>
                        {client_status === 'hold' ? 'On Hold' : client_status}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {active.length} active{history.length > 0 ? `, ${history.length} complete` : ''}
                    </span>
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                </button>

                {isExpanded && (
                  <div>
                    {active.length === 0 ? (
                      <p className="text-xs text-gray-400 px-4 py-3">No active tasks.</p>
                    ) : viewMode === 'list' ? (
                      <table className="w-full text-left table-fixed">
                        {/* Column headers — sticky below section header (50px filters + 44px section header) */}
                        <thead className="sticky top-[94px] z-10">
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <SortHeader<SortField> field="task"   label="Task"   activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} />
                            <SortHeader<SortField> field="status" label="Status" activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="w-32" />
                            <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Progress</th>
                            <SortHeader<SortField> field="due"    label="Due"    activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="w-28" />
                            <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Assignees</th>
                          </tr>
                        </thead>
                        <tbody>
                          {active.map(t => (
                            <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} hideClient onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                        {active.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                      </div>
                    )}

                    {history.length > 0 && (
                      <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                        <button
                          onClick={() => toggleHistory(key)}
                          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
                        >
                          <History className="h-3.5 w-3.5" />
                          {showHistory ? 'Hide' : 'Show'} {history.length} completed task{history.length !== 1 ? 's' : ''}
                        </button>
                        {showHistory && (viewMode === 'list' ? (
                          <table className="w-full text-left mt-3">
                            <tbody>
                              {history.map(t => (
                                <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} hideClient onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                            {history.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                          </div>
                        ))}
                      </div>
                    )}
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
