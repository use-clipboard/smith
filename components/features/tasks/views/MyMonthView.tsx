'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskTable, { type TaskColumn } from '../TaskTable';
import ExportTasksButton from '../ExportTasksButton';

const MY_MONTH_COLUMNS: TaskColumn[] = [
  { id: 'task',      label: 'Task',      defaultWidth: 360, minWidth: 200 },
  { id: 'client',    label: 'Client',    defaultWidth: 220, minWidth: 120 },
  { id: 'status',    label: 'Status',    defaultWidth: 140, minWidth: 90  },
  { id: 'progress',  label: 'Progress',  defaultWidth: 140, minWidth: 90  },
  { id: 'due',       label: 'Due',       defaultWidth: 170, minWidth: 110 },
  { id: 'assignees', label: 'Assignees', defaultWidth: 130, minWidth: 80  },
  { id: 'actions',   label: 'Actions',   defaultWidth: 130, minWidth: 110, fixed: true, align: 'right' },
];
import type { Task, TaskStep } from '@/types';

interface TeamMember { id: string; full_name: string | null; email: string }

interface Props {
  tasks: Task[];
  currentUserId: string;
  onTaskClick: (task: Task) => void;
  onStepUpdate?: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  viewMode: 'grid' | 'list';
  isAdmin?: boolean;
  teamMembers?: TeamMember[];
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getMondayOnOrBefore(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatWeekRange(start: Date, end: Date, monthStart: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  // If end is in a different month to the month being viewed, cap display label
  const clampedEnd = end.getMonth() !== monthStart.getMonth()
    ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
    : end;
  return `${start.toLocaleDateString('en-GB', opts)} – ${clampedEnd.toLocaleDateString('en-GB', opts)}`;
}

export default function MyMonthView({ tasks, currentUserId, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, teamMembers = [], onDelete, onStopRecurrence }: Props) {
  const [monthOffset, setMonthOffset] = useState(0);
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const monthStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const monthEnd = useMemo(() => {
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [monthStart]);

  const monthLabel = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const relativeLabel = monthOffset === 0 ? 'This month'
                      : monthOffset === 1 ? 'Next month'
                      : monthOffset === -1 ? 'Last month'
                      : monthOffset > 0 ? `${monthOffset} months ahead`
                      : `${Math.abs(monthOffset)} months ago`;

  const myTasks = useMemo(() => tasks.filter(t => {
    if (!t.due_date) return false;
    const isMine = t.steps?.some(s => s.assignee_id === currentUserId);
    if (!isMine) return false;
    const due = new Date(t.due_date);
    return due >= monthStart && due <= monthEnd;
  }), [tasks, currentUserId, monthStart, monthEnd]);

  // Group into calendar weeks that intersect this month
  const weeks = useMemo(() => {
    const result: { weekStart: Date; weekEnd: Date; weekTasks: Task[] }[] = [];
    let cursor = getMondayOnOrBefore(monthStart);

    while (cursor <= monthEnd) {
      const weekEnd = addDays(cursor, 6);
      const weekTasks = myTasks
        .filter(t => {
          const due = new Date(t.due_date!);
          return due >= cursor && due <= weekEnd;
        })
        .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());

      if (weekTasks.length > 0) {
        result.push({ weekStart: new Date(cursor), weekEnd, weekTasks });
      }
      cursor = addDays(cursor, 7);
    }
    return result;
  }, [myTasks, monthStart, monthEnd]);

  return (
    <div>
      {/* Month navigator — sticky */}
      <div className="sticky top-0 z-20 bg-gray-50 pb-3">
        <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-2.5">
          <button
            onClick={() => setMonthOffset(m => m - 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-gray-500" />
          </button>

          <div className="text-center">
            <p className="text-sm font-semibold text-gray-800">{monthLabel}</p>
            <p className={`text-xs font-medium mt-0.5 ${monthOffset === 0 ? 'text-indigo-500' : 'text-gray-400'}`}>
              {relativeLabel}
              {monthOffset !== 0 && (
                <button
                  onClick={() => setMonthOffset(0)}
                  className="ml-2 text-indigo-500 hover:underline"
                >
                  · Back to this month
                </button>
              )}
            </p>
          </div>

          <button
            onClick={() => setMonthOffset(m => m + 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <div className="flex justify-end mt-2">
          <ExportTasksButton tasks={myTasks} filename="my-month" label={`Export ${myTasks.length > 0 ? `(${myTasks.length})` : ''}`} />
        </div>
      </div>

      {myTasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No tasks due this month.</p>
        </div>
      ) : viewMode === 'list' ? (
        <TaskTable viewKey="myMonth" columns={MY_MONTH_COLUMNS}>
          <tbody>
            {myTasks
              .slice()
              .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
              .map(t => (
                <TaskListRow key={t.id} task={t} currentUserId={currentUserId} onClick={() => onTaskClick(t)} onStepUpdate={onStepUpdate} onTaskUpdate={onTaskUpdate} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={onDelete} onStopRecurrence={onStopRecurrence} />
              ))}
          </tbody>
        </TaskTable>
      ) : (
        <div className="space-y-6">
          {weeks.map(({ weekStart, weekEnd, weekTasks }) => {
            const hasToday = weekTasks.some(t => isSameDay(new Date(t.due_date!), today));
            return (
              <div key={weekStart.toISOString()}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-sm font-semibold ${hasToday ? 'text-indigo-600' : 'text-gray-700'}`}>
                    {formatWeekRange(weekStart, weekEnd, monthStart)}
                  </span>
                  {hasToday && (
                    <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide">
                      This week
                    </span>
                  )}
                  <span className="text-xs text-gray-400">({weekTasks.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {weekTasks.map(t => (
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
