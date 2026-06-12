'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskListRow from '../TaskListRow';
import TaskTable, { type TaskColumn } from '../TaskTable';
import ExportTasksButton from '../ExportTasksButton';
import ViewModeToggle from '../ViewModeToggle';

const MY_WEEK_COLUMNS: TaskColumn[] = [
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

function getMondayOfWeek(offset: number): Date {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const start = monday.toLocaleDateString('en-GB', opts);
  const end   = sunday.toLocaleDateString('en-GB', { ...opts, year: 'numeric' });
  return `${start} – ${end}`;
}

function formatDayHeading(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MyWeekView({ tasks, currentUserId, onTaskClick, onStepUpdate, onTaskUpdate, viewMode, isAdmin = false, teamMembers = [], onDelete, onStopRecurrence }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const monday = useMemo(() => getMondayOfWeek(weekOffset), [weekOffset]);
  const sundayEnd = useMemo(() => {
    const d = addDays(monday, 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [monday]);

  const myTasks = useMemo(() => tasks.filter(t => {
    if (!t.due_date) return false;
    const isMine = t.steps?.some(s => s.assignee_id === currentUserId);
    if (!isMine) return false;
    const due = new Date(t.due_date);
    return due >= monday && due <= sundayEnd;
  }), [tasks, currentUserId, monday, sundayEnd]);

  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const day = addDays(monday, i);
      return {
        day,
        label: DAY_NAMES[i],
        dayTasks: myTasks
          .filter(t => isSameDay(new Date(t.due_date!), day))
          .sort((a, b) => (a.title > b.title ? 1 : -1)),
      };
    }),
  [myTasks, monday]);

  const weekLabel = weekOffset === 0 ? 'This week'
                  : weekOffset === 1 ? 'Next week'
                  : weekOffset === -1 ? 'Last week'
                  : weekOffset > 0 ? `${weekOffset} weeks ahead`
                  : `${Math.abs(weekOffset)} weeks ago`;

  return (
    <div>
      {/* Week navigator — sticky */}
      <div className="sticky top-0 z-20 backdrop-blur-md pb-3">
        <div className="flex justify-end gap-2 mb-2">
          <ExportTasksButton tasks={myTasks} filename="my-week" label={`Export ${myTasks.length > 0 ? `(${myTasks.length})` : ''}`} />
          <ViewModeToggle />
        </div>
        <div className="flex items-center justify-between bg-white/[0.78] backdrop-blur-md border border-[var(--border)] shadow-md rounded-xl px-4 py-2.5">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-gray-500" />
          </button>

          <div className="text-center">
            <p className="text-sm font-semibold text-gray-800">{formatWeekRange(monday)}</p>
            <p className={`text-xs font-medium mt-0.5 ${weekOffset === 0 ? 'text-indigo-500' : 'text-gray-400'}`}>
              {weekLabel}
              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="ml-2 text-indigo-500 hover:underline"
                >
                  · Back to this week
                </button>
              )}
            </p>
          </div>

          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-gray-500" />
          </button>
        </div>
      </div>

      {myTasks.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm font-bold text-[var(--text-primary)]">No tasks due this week.</p>
        </div>
      ) : viewMode === 'list' ? (
        <TaskTable viewKey="myWeek" columns={MY_WEEK_COLUMNS}>
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
        <div className="space-y-5">
          {days.filter(d => d.dayTasks.length > 0).map(({ day, label, dayTasks }) => {
            const isToday = isSameDay(day, today);
            const isPast  = day < today && !isToday;
            return (
              <div key={label}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-sm font-semibold ${isToday ? 'text-indigo-600' : isPast ? 'text-gray-400' : 'text-gray-700'}`}>
                    {formatDayHeading(day)}
                  </span>
                  {isToday && (
                    <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide">
                      Today
                    </span>
                  )}
                  <span className="text-xs text-gray-400">({dayTasks.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {dayTasks.map(t => (
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
