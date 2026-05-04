'use client';

import { Calendar, Clock, User, Users, RefreshCw, Puzzle } from 'lucide-react';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { Task } from '@/types';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  currentUserId: string;
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(due: string | null, status: string) {
  if (!due || status === 'complete') return false;
  return new Date(due) < new Date();
}

function totalMinutes(entries: Task['time_entries']) {
  if (!entries?.length) return 0;
  return entries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
}

function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function TaskCard({ task, onClick, currentUserId }: TaskCardProps) {
  const steps = task.steps ?? [];
  const totalSteps = steps.length;
  const completedSteps = steps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const overdue = isOverdue(task.due_date, task.status);
  const timeLogged = totalMinutes(task.time_entries);

  // Unique assignees across all steps
  const assignees = Array.from(
    new Map(
      steps
        .filter(s => s.assignee)
        .map(s => [s.assignee!.id, s.assignee!])
    ).values()
  ).slice(0, 3);

  const myStep = steps.find(s => s.assignee_id === currentUserId && s.status !== 'complete' && s.status !== 'skipped');

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-indigo-400 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700">
              {task.title}
            </h3>
            {task.recurrence_type && task.recurrence_type !== 'once' && (
              <RefreshCw className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-gray-500">
            {task.client ? (
              <span className="font-medium text-gray-700">{task.client.name}</span>
            ) : (
              <span className="text-gray-400 italic">Internal</span>
            )}
          </p>
        </div>
        <TaskStatusBadge status={task.status} size="sm" />
      </div>

      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">{completedSteps}/{totalSteps} steps</span>
            <span className="text-xs text-gray-400">{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* My active step */}
      {myStep && (
        <div className="mb-3 bg-indigo-50 border border-indigo-100 rounded px-2.5 py-1.5">
          <p className="text-xs font-medium text-indigo-700">Your step: {myStep.title}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {task.due_date && (
            <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
              <Calendar className="h-3.5 w-3.5" />
              {overdue ? 'Overdue · ' : ''}{formatDate(task.due_date)}
            </span>
          )}
          {timeLogged > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="h-3.5 w-3.5" />
              {fmtDuration(timeLogged)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {assignees.length > 0 ? (
            <div className="flex -space-x-1.5">
              {assignees.map(a => (
                <div
                  key={a.id}
                  className="h-6 w-6 rounded-full bg-indigo-600 border-2 border-white flex items-center justify-center"
                  title={a.full_name ?? a.email}
                >
                  <span className="text-[10px] font-bold text-white">
                    {(a.full_name ?? a.email).charAt(0).toUpperCase()}
                  </span>
                </div>
              ))}
              {steps.some(s => s.is_client_step) && (
                <div className="h-6 w-6 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center" title="Client step">
                  <User className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-300">
              <Users className="h-3.5 w-3.5" />
              Unassigned
            </span>
          )}
          {steps.some(s => s.tool_module_id) && (
            <span title="Has tool integration"><Puzzle className="h-3.5 w-3.5 text-gray-300" /></span>
          )}
        </div>
      </div>
    </div>
  );
}
