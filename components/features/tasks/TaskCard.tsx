'use client';

import { useState } from 'react';
import { Clock, User, Users, RefreshCw, Puzzle, Trash2, XCircle, Loader2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { TaskStatusBadge } from './TaskStatusBadge';
import DueDatePill from './DueDatePill';
import TaskDeadlineLinkBadge, { type TaskDeadlineLink } from './TaskDeadlineLinkBadge';
import { useTaskDeadlineLinks } from './TaskDeadlineLinksProvider';
import type { Task, RecurrenceType } from '@/types';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  currentUserId: string;
  isAdmin?: boolean;
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
  /** CH-deadline links attached to this task, if any. Drives the small
   *  🔗 indicator next to the title with a hover tooltip. */
  deadlineLinks?: TaskDeadlineLink[];
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function totalMinutes(entries: Task['time_entries']) {
  if (!entries?.length) return 0;
  return entries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
}

function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Weekly', 'bi-weekly': 'Bi-weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annually: 'Annually',
};

function recurrenceLabel(type: RecurrenceType | null, intervalDays: number | null): string {
  if (!type || type === 'once') return '';
  if (type === 'custom' && intervalDays) return `Every ${intervalDays}d`;
  return RECURRENCE_LABELS[type] ?? type;
}

function computeNextDue(dueDate: string | null, recType: RecurrenceType | null, intervalDays: number | null): string | null {
  if (!recType || recType === 'once') return null;
  const base = dueDate ? new Date(dueDate) : new Date();
  switch (recType) {
    case 'weekly':    base.setDate(base.getDate() + 7);          break;
    case 'bi-weekly': base.setDate(base.getDate() + 14);         break;
    case 'monthly':   base.setMonth(base.getMonth() + 1);        break;
    case 'quarterly': base.setMonth(base.getMonth() + 3);        break;
    case 'annually':  base.setFullYear(base.getFullYear() + 1);  break;
    case 'custom':    if (intervalDays) base.setDate(base.getDate() + intervalDays); break;
  }
  return base.toISOString().split('T')[0];
}

export default function TaskCard({ task, onClick, currentUserId, isAdmin = false, onDelete, onStopRecurrence, deadlineLinks }: TaskCardProps) {
  // Falls back to the provider when a parent doesn't pass links directly.
  // Keeping the prop optional means callers that already have the data
  // (avoiding an extra render cycle) can still pass it.
  const fetchedLinks = useTaskDeadlineLinks(task.id);
  const links = deadlineLinks ?? fetchedLinks;
  const [confirmDelete, setConfirmDelete]   = useState(false);
  const [deleting, setDeleting]             = useState(false);
  const [stoppingRec, setStoppingRec]       = useState(false);

  const steps        = task.steps ?? [];
  const totalSteps   = steps.length;
  const completedSteps = steps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
  const progressPct  = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const timeLogged   = totalMinutes(task.time_entries);

  const isRecurring  = task.recurrence_type && task.recurrence_type !== 'once';
  const nextDueDate  = isRecurring ? computeNextDue(task.due_date, task.recurrence_type, task.recurrence_interval_days) : null;
  const nextDueStr   = nextDueDate ? formatDate(nextDueDate) : null;

  const assignees = Array.from(
    new Map(steps.filter(s => s.assignee).map(s => [s.assignee!.id, s.assignee!])).values()
  ).slice(0, 3);

  const myStep = steps.find(s => s.assignee_id === currentUserId && s.status !== 'complete' && s.status !== 'skipped');

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onDelete) return;
    setDeleting(true);
    try { await onDelete(task.id); }
    finally { setDeleting(false); setConfirmDelete(false); }
  }

  async function handleStopRecurrence(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onStopRecurrence) return;
    setStoppingRec(true);
    try { await onStopRecurrence(task.id); }
    finally { setStoppingRec(false); }
  }

  return (
    <div
      onClick={!confirmDelete ? onClick : undefined}
      className={`relative bg-white border rounded-lg p-4 transition-all group
        ${confirmDelete ? 'border-red-300 bg-red-50/30 cursor-default' : 'border-gray-200 cursor-pointer hover:border-indigo-400 hover:shadow-sm'}`}
    >
      {/* Admin action buttons — top-right, hover-reveal */}
      {isAdmin && !confirmDelete && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          {isRecurring && onStopRecurrence && (
            <Tooltip label="Stop recurrence">
              <button
                onClick={handleStopRecurrence}
                disabled={stoppingRec}
                aria-label="Stop recurrence"
                className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 transition-colors"
              >
                {stoppingRec ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
              </button>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip label="Delete task">
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                aria-label="Delete task"
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-white/90 z-10 p-3">
          <span className="text-xs text-red-600 font-medium">Delete this task?</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium transition-colors"
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Yes, delete'}
          </button>
          <button
            onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
            className="px-3 py-1.5 text-xs border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700">
              {task.title}
            </h3>
            <TaskDeadlineLinkBadge links={links} />
            {isRecurring && (
              <Tooltip label={recurrenceLabel(task.recurrence_type, task.recurrence_interval_days)} className="flex-shrink-0">
                <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
              </Tooltip>
            )}
          </div>
          {task.client ? (
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className="text-xs font-medium text-gray-700 truncate">{task.client.name}</span>
              <span className="text-[10px] font-mono text-gray-400">{task.client.client_ref}</span>
              {task.client.status && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0 ${
                  task.client.status === 'active'   ? 'bg-green-100 text-green-700' :
                  task.client.status === 'hold'     ? 'bg-amber-100 text-amber-700' :
                                                      'bg-gray-100 text-gray-500'
                }`}>{task.client.status === 'hold' ? 'On Hold' : task.client.status}</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic mt-0.5">Internal</p>
          )}
        </div>
        <TaskStatusBadge status={task.status} size="sm" />
      </div>

      {/* Next repeat date — all users */}
      {isRecurring && nextDueStr && (
        <div className="flex items-center gap-1.5 mb-2.5 px-2.5 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100">
          <RefreshCw className="h-3 w-3 text-indigo-500 flex-shrink-0" />
          <span className="text-xs text-indigo-600">
            <span className="font-medium">{recurrenceLabel(task.recurrence_type, task.recurrence_interval_days)}</span>
            {' · '}Deadline on next cycle: <span className="font-semibold">{nextDueStr}</span>
          </span>
        </div>
      )}

      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">{completedSteps}/{totalSteps} steps</span>
            <span className="text-xs text-gray-400">{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progressPct}%` }} />
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
            <DueDatePill dueDate={task.due_date} status={task.status} size="sm" />
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
                <Tooltip key={a.id} label={a.full_name ?? a.email} side="top">
                  <div className="h-6 w-6 rounded-full bg-indigo-600 border-2 border-white flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">
                      {(a.full_name ?? a.email).charAt(0).toUpperCase()}
                    </span>
                  </div>
                </Tooltip>
              ))}
              {steps.some(s => s.is_client_step) && (
                <Tooltip label="Client step" side="top">
                  <div className="h-6 w-6 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center">
                    <User className="h-3 w-3 text-white" />
                  </div>
                </Tooltip>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-300">
              <Users className="h-3.5 w-3.5" />
              Unassigned
            </span>
          )}
          {steps.some(s => s.tool_module_id) && (
            <Tooltip label="Has tool integration" side="top">
              <span><Puzzle className="h-3.5 w-3.5 text-gray-300" /></span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
