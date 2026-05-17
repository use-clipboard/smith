'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'records_here', 'review', 'not_started', 'complete'];
type SortField = 'task' | 'client' | 'status' | 'due';

export default function ByTypeView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, onDelete, onStopRecurrence }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dueFilter, setDueFilter] = useState<DueWindow>('all');
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'due', dir: 'asc' });

  const filtered = useMemo(() => tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
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
      <div className="sticky top-0 z-20 bg-gray-50 pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TaskFilters
            search={search} onSearchChange={onSearchChange}
            statusFilter={statusFilter} onStatusChange={onStatusChange}
            clientFilter={clientFilter} onClientChange={onClientChange}
            assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
            clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
          />
          <ExportTasksButton tasks={dueFiltered} filename="tasks-by-type" />
        </div>
      </div>

      <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={filtered.length} counts={dueCounts} className="mb-4" />

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks found.</p></div>
      ) : (
        <div className="space-y-3">
        {grouped.map(([key, typeTasks]) => {
          const isOpen = expanded.has(key) || typeTasks.length <= 3;
          const active = typeTasks.filter(t => t.status !== 'complete').length;
          return (
            <div key={key} className="bg-white border border-gray-200 rounded-lg">
              <button onClick={() => toggle(key)} className="sticky top-[50px] z-20 w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 rounded-t-lg border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-gray-900">{key}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {active} active · {typeTasks.length} total
                  </span>
                </div>
                {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              </button>

              {isOpen && (
                <div className="border-t border-gray-100">
                  {viewMode === 'list' ? (
                    <table className="w-full text-left table-fixed">
                      <thead className="sticky top-[94px] z-10">
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <SortHeader<SortField> field="task"   label="Task"   activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} />
                          <SortHeader<SortField> field="client" label="Client" activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="w-48" />
                          <SortHeader<SortField> field="status" label="Status" activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="w-32" />
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Progress</th>
                          <SortHeader<SortField> field="due"    label="Due"    activeField={sort.field} activeDir={sort.dir} onToggle={toggleSort} thClassName="w-48" />
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Assignees</th>
                        </tr>
                      </thead>
                      <tbody>
                        {typeTasks.map(t => <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                      </tbody>
                    </table>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                      {typeTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
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
