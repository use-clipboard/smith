'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import { type SortDir } from '../SortHeader';
import TaskTable, { type TaskColumn } from '../TaskTable';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { Task, TaskStatus, TaskStep } from '@/types';

// The unified list — one view that groups the (already scoped + filtered) task
// set by a chosen dimension, reusing the shared TaskListRow / TaskCard / TaskTable
// so rows look and behave exactly as before. Replaces the old My / All / By
// Client / By Team / By Type views (Departments keeps its own richer view).

export type GroupBy = 'none' | 'due' | 'client' | 'type' | 'team' | 'status' | 'department';

interface Props {
  tasks: Task[];
  currentUserId: string;
  clients: { id: string; name: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  templates: { id: string; name: string; category?: string }[];
  groupBy: GroupBy;
  viewMode: 'grid' | 'list';
  isAdmin?: boolean;
  onTaskClick: (task: Task) => void;
  onStepUpdate?: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

type SortField = 'task' | 'client' | 'status' | 'due';

const COLUMNS: TaskColumn<SortField>[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 340, minWidth: 200, sortField: 'task'   },
  { id: 'client',    label: 'Client',    defaultWidth: 210, minWidth: 120, sortField: 'client' },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90,  sortField: 'status' },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90                          },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110, sortField: 'due'    },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80                           },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'waiting_on_client', 'records_here', 'review', 'not_started', 'complete'];
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'In Progress', waiting_on_client: 'Waiting on Client', records_here: 'Records Here',
  review: 'Review', not_started: 'Not Started', complete: 'Complete',
};

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

interface Grp { key: string; label: string; tasks: Task[]; order: number }

export default function GroupedTasksView({
  tasks, currentUserId, clients, teamMembers, templates, groupBy, viewMode,
  isAdmin = false, onTaskClick, onStepUpdate, onTaskUpdate, onDelete, onStopRecurrence,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'due', dir: 'asc' });
  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
  }
  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  const clientName = useMemo(() => { const m = new Map<string, string>(); clients.forEach(c => m.set(c.id, c.name)); return m; }, [clients]);
  const memberName = useMemo(() => { const m = new Map<string, string>(); teamMembers.forEach(t => m.set(t.id, t.full_name || t.email)); return m; }, [teamMembers]);
  const templateOf = useMemo(() => { const m = new Map<string, { name: string; category?: string }>(); templates.forEach(t => m.set(t.id, { name: t.name, category: t.category })); return m; }, [templates]);

  const sortedTasks = useMemo(() => {
    const arr = [...tasks];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sort.field === 'due') {
        cmp = (a.due_date ? new Date(a.due_date).getTime() : Infinity) - (b.due_date ? new Date(b.due_date).getTime() : Infinity);
      } else if (sort.field === 'task') cmp = a.title.localeCompare(b.title);
      else if (sort.field === 'client') {
        const an = a.is_internal ? 'Internal' : (a.client?.name ?? (a.client_id ? clientName.get(a.client_id) ?? '' : ''));
        const bn = b.is_internal ? 'Internal' : (b.client?.name ?? (b.client_id ? clientName.get(b.client_id) ?? '' : ''));
        cmp = an.localeCompare(bn);
      } else if (sort.field === 'status') cmp = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [tasks, sort, clientName]);

  const groups = useMemo<Grp[]>(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', tasks: sortedTasks, order: 0 }];
    const map = new Map<string, Grp>();
    const add = (key: string, label: string, order: number, t: Task) => {
      let g = map.get(key);
      if (!g) { g = { key, label, tasks: [], order }; map.set(key, g); }
      g.tasks.push(t);
    };
    const today = startOfToday();
    const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
    for (const t of sortedTasks) {
      if (groupBy === 'due') {
        let k = 'no_due', l = 'No due date', o = 4;
        if (t.due_date) {
          const d = new Date(t.due_date); d.setHours(0, 0, 0, 0);
          if (d < today) { k = 'overdue'; l = 'Overdue'; o = 0; }
          else if (d.getTime() === today.getTime()) { k = 'today'; l = 'Due today'; o = 1; }
          else if (d < weekEnd) { k = 'this_week'; l = 'This week'; o = 2; }
          else { k = 'later'; l = 'Later'; o = 3; }
        }
        add(k, l, o, t);
      } else if (groupBy === 'status') {
        add(t.status, STATUS_LABEL[t.status] ?? t.status, STATUS_ORDER.indexOf(t.status), t);
      } else if (groupBy === 'client') {
        if (t.is_internal) add('__internal__', 'Internal', -1, t);
        else { const k = t.client_id ?? '__none__'; add(k, t.client?.name ?? (t.client_id ? clientName.get(t.client_id) ?? 'Unknown client' : 'Unassigned'), 0, t); }
      } else if (groupBy === 'type') {
        const info = t.template_id ? templateOf.get(t.template_id) : undefined;
        add(t.template_id ?? '__adhoc__', info?.name ?? 'Ad hoc', t.template_id ? 0 : 1, t);
      } else if (groupBy === 'department') {
        const cat = t.template_id ? templateOf.get(t.template_id)?.category : undefined;
        add(cat ?? '__none__', cat ? (TEMPLATE_CATEGORY_LABELS[cat] ?? cat) : 'Uncategorised', cat ? 0 : 1, t);
      } else if (groupBy === 'team') {
        const ids = [...new Set((t.steps ?? []).filter(s => s.assignee_id).map(s => s.assignee_id!))];
        if (ids.length === 0) add('__unassigned__', 'Unassigned', 1, t);
        else ids.forEach(id => add(id, memberName.get(id) ?? 'Unknown', id === currentUserId ? -1 : 0, t));
      }
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [groupBy, sortedTasks, clientName, memberName, templateOf, currentUserId]);

  if (tasks.length === 0) {
    return <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks match the current filters.</p></div>;
  }

  // ── Grid view: collapsible sections of cards ──
  if (viewMode === 'grid') {
    return (
      <div className="space-y-5">
        {groups.map(g => {
          const isCollapsed = groupBy !== 'none' && collapsed.has(g.key);
          return (
            <div key={g.key}>
              {groupBy !== 'none' && (
                <button onClick={() => toggle(g.key)} className="flex items-center gap-2 mb-3 group">
                  {isCollapsed ? <ChevronRight size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  <span className="text-sm font-bold text-gray-800">{g.label}</span>
                  <span className="text-xs text-gray-400">({g.tasks.length})</span>
                </button>
              )}
              {!isCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.tasks.map(t => <TaskCard key={`${g.key}-${t.id}`} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} isAdmin={isAdmin} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── List view: one table, a tbody per group with a collapsible header row ──
  // `fill` makes the table own the only scrollbar (the page wrapper stops
  // scrolling for this mode), so the filters/KPI above stay fixed.
  return (
    <TaskTable<SortField> viewKey={`grouped.${groupBy}`} columns={COLUMNS} sortField={sort.field} sortDir={sort.dir} onToggleSort={toggleSort} fill>
      {groups.map(g => {
        const isCollapsed = groupBy !== 'none' && collapsed.has(g.key);
        return (
          <tbody key={g.key}>
            {groupBy !== 'none' && (
              <tr className="bg-gray-50/60">
                <td colSpan={COLUMNS.length} className="px-0 py-0">
                  <button onClick={() => toggle(g.key)} aria-expanded={!isCollapsed} className="w-full px-4 py-2 border-y border-gray-100 flex items-center justify-between hover:bg-gray-100 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      {isCollapsed ? <ChevronRight size={13} className="text-gray-400 group-hover:text-gray-600 flex-shrink-0" /> : <ChevronDown size={13} className="text-gray-400 group-hover:text-gray-600 flex-shrink-0" />}
                      <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate">{g.label}</p>
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0 ml-2">{g.tasks.length} task{g.tasks.length !== 1 ? 's' : ''}</p>
                  </button>
                </td>
              </tr>
            )}
            {!isCollapsed && g.tasks.map(t => (
              <TaskListRow key={`${g.key}-${t.id}`} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
            ))}
          </tbody>
        );
      })}
    </TaskTable>
  );
}
