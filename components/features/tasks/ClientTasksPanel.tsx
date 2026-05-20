'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Loader2, ChevronRight, Trash2, XCircle,
  UserCheck, Check, Users,
} from 'lucide-react';
import DueDatePill from './DueDatePill';
import { TaskStatusBadge } from './TaskStatusBadge';
import Tooltip from '@/components/ui/Tooltip';
import { sortStepsByWorkflow } from '@/utils/taskUtils';
import StepComments, { initials, avatarColour } from './StepComments';
import AssigneePicker from './AssigneePicker';
import type { Task, TaskStep, TaskStatus, StepStatus, RecurrenceType } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember { id: string; full_name: string | null; email: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'not_started',       label: 'Not Started' },
  { value: 'in_progress',       label: 'In Progress' },
  { value: 'waiting_on_client', label: 'Waiting on Client' },
  { value: 'records_here',      label: 'Records Here' },
  { value: 'review',            label: 'Review' },
  { value: 'complete',          label: 'Complete' },
];

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  'four-weekly': 'Four-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

function recurrenceLabel(type: RecurrenceType | null, intervalDays: number | null): string {
  if (!type || type === 'once') return '';
  if (type === 'custom' && intervalDays) return `Every ${intervalDays} day${intervalDays !== 1 ? 's' : ''}`;
  return RECURRENCE_LABELS[type] ?? type;
}

function computeNextDue(
  dueDate: string | null,
  recType: RecurrenceType | null,
  intervalDays: number | null,
): string | null {
  if (!recType || recType === 'once') return null;
  const base = dueDate ? new Date(dueDate) : new Date();
  switch (recType) {
    case 'weekly':    base.setDate(base.getDate() + 7);           break;
    case 'bi-weekly': base.setDate(base.getDate() + 14);          break;
    case 'four-weekly': base.setDate(base.getDate() + 28);        break;
    case 'monthly':   base.setMonth(base.getMonth() + 1);         break;
    case 'quarterly': base.setMonth(base.getMonth() + 3);         break;
    case 'annually':  base.setFullYear(base.getFullYear() + 1);   break;
    case 'custom':    if (intervalDays) base.setDate(base.getDate() + intervalDays); break;
  }
  return base.toISOString().split('T')[0];
}

// Module-level set so expanded state persists across re-renders
const expandedTaskIds = new Set<string>();

// ── Per-row component ─────────────────────────────────────────────────────────

interface RowProps {
  task: Task;
  currentUserId: string;
  isAdmin: boolean;
  teamMembers: TeamMember[];
  onStepUpdate: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onStopRecurrence: (taskId: string) => Promise<void>;
}

function ClientTaskRow({
  task, currentUserId, isAdmin, teamMembers,
  onStepUpdate, onTaskUpdate, onDelete, onStopRecurrence,
}: RowProps) {
  const [expanded, setExpanded]   = useState(() => expandedTaskIds.has(task.id));
  const [reassignMode, setReassignMode] = useState(false);
  const [updatingStep, setUpdatingStep] = useState<string | null>(null);
  const [updatingTask, setUpdatingTask] = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [stoppingRecurrence, setStoppingRecurrence] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reallocation state (only used when reassignMode = true)
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget] = useState<string>('');
  const [applying, setApplying]   = useState(false);

  const allSteps    = task.steps ?? [];
  const edges       = task.edges ?? [];
  const sortedSteps = sortStepsByWorkflow(allSteps, edges);
  const workSteps   = sortedSteps.filter(s => s.step_type !== 'start');
  const totalSteps  = workSteps.length;
  const doneSteps   = workSteps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
  const pct         = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const nextStep    = workSteps.find(s => s.status !== 'complete' && s.status !== 'skipped') ?? null;

  const isRecurring = task.recurrence_type && task.recurrence_type !== 'once';
  const nextDueDate = isRecurring
    ? computeNextDue(task.due_date, task.recurrence_type, task.recurrence_interval_days)
    : null;

  // Unique assignees across all non-client steps (for the collapsed row avatars)
  const assignees = allSteps
    .filter(s => s.assignee && !s.is_client_step)
    .map(s => s.assignee!)
    .filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i)
    .slice(0, 4);

  const nextDueStr = nextDueDate
    ? new Date(nextDueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  // Only non-client steps can be reassigned
  const reassignableSteps = workSteps.filter(s => !s.is_client_step);
  const allSelected = reassignableSteps.length > 0 && reassignableSteps.every(s => selectedStepIds.has(s.id));
  const someSelected = selectedStepIds.size > 0 && !allSelected;

  function exitReassignMode() {
    setReassignMode(false);
    setSelectedStepIds(new Set());
    setBatchTarget('');
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleStepStatus(stepId: string, status: StepStatus) {
    setUpdatingStep(stepId);
    try { await onStepUpdate(task.id, stepId, { status }); }
    finally { setUpdatingStep(null); }
  }

  async function handleCompleteAll() {
    setUpdatingTask(true);
    try {
      const incomplete = workSteps.filter(s => s.status !== 'complete' && s.status !== 'skipped');
      await Promise.all(incomplete.map(s => onStepUpdate(task.id, s.id, { status: 'complete' })));
      await onTaskUpdate(task.id, { status: 'complete' });
    } finally { setUpdatingTask(false); }
  }

  async function handleTaskStatus(status: TaskStatus) {
    setUpdatingTask(true);
    try { await onTaskUpdate(task.id, { status }); }
    finally { setUpdatingTask(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(task.id); }
    finally { setDeleting(false); setConfirmDelete(false); }
  }

  async function handleStopRecurrence() {
    setStoppingRecurrence(true);
    try { await onStopRecurrence(task.id); }
    finally { setStoppingRecurrence(false); }
  }

  async function handleInlineAssign(stepId: string, memberId: string | null) {
    setUpdatingStep(stepId);
    try {
      await onStepUpdate(task.id, stepId, { assignee_id: memberId } as Partial<TaskStep>);
    } finally { setUpdatingStep(null); }
  }

  async function handleApplyBatch() {
    if (!batchTarget || selectedStepIds.size === 0) return;
    setApplying(true);
    try {
      const newAssigneeId = batchTarget === '__unassigned__' ? null : batchTarget;
      await Promise.all(
        [...selectedStepIds].map(stepId =>
          onStepUpdate(task.id, stepId, { assignee_id: newAssigneeId } as Partial<TaskStep>)
        )
      );
      exitReassignMode();
    } finally { setApplying(false); }
  }

  function toggleStep(stepId: string) {
    setSelectedStepIds(prev => {
      const next = new Set(prev);
      next.has(stepId) ? next.delete(stepId) : next.add(stepId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedStepIds(new Set());
    } else {
      setSelectedStepIds(new Set(reassignableSteps.map(s => s.id)));
    }
  }

  return (
    <div className="border-b border-[var(--border)] last:border-0">

      {/* ── Main task row ── */}
      <div className={`flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--bg-nav-hover)] transition-colors group ${expanded ? 'bg-indigo-50/30' : ''}`}>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => {
            const next = !v;
            next ? expandedTaskIds.add(task.id) : expandedTaskIds.delete(task.id);
            if (!next) exitReassignMode();
            return next;
          })}
          disabled={workSteps.length === 0}
          className={`flex-shrink-0 p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-all disabled:opacity-20 ${expanded ? 'text-[var(--accent)] bg-[var(--accent-light)] rotate-90' : ''}`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Recurrence badge */}
        {isRecurring && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100 flex-shrink-0">
            <RefreshCw className="h-2.5 w-2.5" />
            {recurrenceLabel(task.recurrence_type, task.recurrence_interval_days)}
          </span>
        )}

        {/* Title block */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{task.title}</p>
          {isRecurring && nextDueStr && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Deadline on next cycle: <span className="font-medium text-indigo-600">{nextDueStr}</span>
            </p>
          )}
        </div>

        {/* Progress */}
        {totalSteps > 0 && (
          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-[var(--text-muted)] tabular-nums w-10">{doneSteps}/{totalSteps}</span>
          </div>
        )}

        {/* Status badge */}
        <div className="hidden sm:block flex-shrink-0">
          <TaskStatusBadge status={task.status} />
        </div>

        {/* Assignee avatars */}
        <div className="flex -space-x-1.5 flex-shrink-0">
          {assignees.map(a => (
            <Tooltip key={a.id} label={a.full_name ?? a.email} side="top" className="flex-shrink-0">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white
                  ${a.id === currentUserId ? 'ring-indigo-400' : ''} ${avatarColour(a.id)}`}
              >
                {initials(a.full_name, a.email)}
              </div>
            </Tooltip>
          ))}
          {assignees.length === 0 && (
            <Tooltip label="Unassigned" side="top" className="flex-shrink-0">
              <div className="h-6 w-6 rounded-full bg-gray-100 ring-2 ring-white" />
            </Tooltip>
          )}
        </div>

        {/* Due date pill — colour-coded by proximity. Reused across
            every task list / view so the visual language is consistent. */}
        <DueDatePill dueDate={task.due_date} status={task.status} />

        {/* Admin actions — appear on hover */}
        {isAdmin && !confirmDelete && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {isRecurring && (
              <Tooltip label="Stop recurrence — this task will no longer repeat">
                <button
                  onClick={() => void handleStopRecurrence()}
                  disabled={stoppingRecurrence}
                  aria-label="Stop recurrence"
                  className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 transition-colors"
                >
                  {stoppingRecurrence
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <XCircle className="h-3.5 w-3.5" />}
                </button>
              </Tooltip>
            )}
            <Tooltip label="Delete task">
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete task"
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        )}

        {/* Delete confirmation */}
        {isAdmin && confirmDelete && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs text-red-600 font-medium whitespace-nowrap">Delete task?</span>
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="px-2.5 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Yes, delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2.5 py-1 text-xs border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ── Expanded steps panel ── */}
      {expanded && workSteps.length > 0 && (
        <div className="px-4 pb-5 pt-1">
          <div className="ml-8 rounded-xl border border-[var(--border)] bg-white shadow-sm overflow-hidden">

            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
              <div className="flex items-center gap-4">
                {/* Progress text + bar */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                      {doneSteps} of {totalSteps} steps complete
                    </span>
                    {pct === 100 && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold border border-emerald-200">
                        All done ✓
                      </span>
                    )}
                  </div>
                  <div className="w-36 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Right side controls */}
              <div className="flex items-center gap-2">
                {updatingTask && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />}

                {/* Reassign button (admin only) */}
                {isAdmin && reassignableSteps.length > 0 && !reassignMode && (
                  <button
                    onClick={() => setReassignMode(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] border border-[var(--border)] hover:bg-white hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Reassign
                  </button>
                )}

                {/* Cancel reassign mode */}
                {isAdmin && reassignMode && (
                  <button
                    onClick={exitReassignMode}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] border border-[var(--border)] hover:bg-white transition-colors"
                  >
                    Cancel
                  </button>
                )}

                {/* Status dropdown */}
                <select
                  value={task.status}
                  disabled={updatingTask}
                  onChange={e => void handleTaskStatus(e.target.value as TaskStatus)}
                  className="text-xs border border-[var(--border)] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white text-[var(--text-secondary)] font-medium disabled:opacity-50"
                >
                  {TASK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Reassign sub-header (shown in reassign mode) */}
            {isAdmin && reassignMode && (
              <div className="flex items-center gap-3 px-5 py-2.5 bg-indigo-50 border-b border-indigo-100">
                {/* Select-all checkbox */}
                <Tooltip label={allSelected ? 'Deselect all' : 'Select all steps'} className="flex-shrink-0">
                  <button
                    onClick={toggleSelectAll}
                    aria-label={allSelected ? 'Deselect all' : 'Select all steps'}
                    className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                      ${allSelected
                      ? 'bg-indigo-500 border-indigo-500'
                      : someSelected
                        ? 'bg-indigo-200 border-indigo-400'
                        : 'border-gray-300 hover:border-indigo-400 bg-white'}`}
                >
                  {allSelected && (
                    <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  )}
                  {someSelected && !allSelected && (
                    <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                  )}
                  </button>
                </Tooltip>
                <span className="text-xs text-indigo-600 font-medium">
                  {selectedStepIds.size > 0
                    ? `${selectedStepIds.size} step${selectedStepIds.size !== 1 ? 's' : ''} selected`
                    : 'Select steps to reassign'}
                </span>
              </div>
            )}

            {/* Step rows */}
            <div className="divide-y divide-[var(--border)]">
              {workSteps.map((s, idx) => {
                const isDone      = s.status === 'complete' || s.status === 'skipped';
                const isEndStep   = s.step_type === 'end';
                const isNextUp    = s.id === nextStep?.id;
                const isUpdating  = updatingStep === s.id || (isEndStep && updatingTask);
                const isSelected  = selectedStepIds.has(s.id);
                const canReassign = isAdmin && !s.is_client_step;

                return (
                  <div
                    key={s.id}
                    className={`flex items-start gap-4 px-5 py-3.5 transition-colors
                      ${isDone ? 'bg-emerald-50/30' : isSelected ? 'bg-indigo-50/60' : isNextUp ? 'bg-blue-50/20' : 'hover:bg-gray-50/50'}`}
                  >
                    {/* Reassign mode: checkbox */}
                    {reassignMode && (
                      <Tooltip label={canReassign ? 'Select for reassignment' : 'Client steps cannot be reassigned'} className="flex-shrink-0 mt-0.5">
                        <button
                          onClick={() => canReassign && toggleStep(s.id)}
                          disabled={!canReassign}
                          aria-label={canReassign ? 'Select for reassignment' : 'Client steps cannot be reassigned'}
                          className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                            ${isSelected
                              ? 'bg-indigo-500 border-indigo-500'
                              : canReassign
                                ? 'border-gray-300 hover:border-indigo-400 cursor-pointer bg-white'
                                : 'border-gray-200 opacity-25 cursor-default bg-white'}`}
                        >
                          {isSelected && (
                            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="2,6 5,9 10,3" />
                            </svg>
                          )}
                        </button>
                      </Tooltip>
                    )}

                    {/* Complete toggle */}
                    <Tooltip label={
                      reassignMode ? 'Exit reassign mode to toggle steps'
                        : isEndStep && !isDone ? 'Complete task — marks all steps done'
                        : isDone ? 'Mark as not started'
                        : 'Mark as complete'
                    } className="flex-shrink-0 mt-0.5">
                    <button
                      onClick={() => {
                        if (isEndStep && !isDone) void handleCompleteAll();
                        else void handleStepStatus(s.id, isDone ? 'not_started' : 'complete');
                      }}
                      disabled={isUpdating || reassignMode}
                      aria-label="Toggle step complete"
                      className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all
                        ${isDone
                          ? 'bg-emerald-500 border-emerald-500'
                          : isEndStep
                            ? 'border-indigo-300 bg-white hover:bg-indigo-50 hover:border-indigo-400'
                            : 'border-gray-300 bg-white hover:border-indigo-400'}
                        ${isUpdating ? 'opacity-50 cursor-wait' : reassignMode ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {isUpdating
                        ? <Loader2 className="h-3 w-3 text-gray-400 animate-spin" />
                        : isDone
                          ? (
                            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="2,6 5,9 10,3" />
                            </svg>
                          )
                          : null}
                    </button>
                    </Tooltip>

                    {/* Step number */}
                    <span className="text-[11px] font-semibold text-gray-300 tabular-nums flex-shrink-0 w-5 text-right mt-0.5">
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    {/* Step title + description tooltip + notes */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.description ? (
                          <Tooltip label={s.description} side="top">
                            <span className={`text-sm leading-snug cursor-help ${isDone ? 'line-through text-gray-400' : isEndStep ? 'font-semibold text-indigo-700' : 'font-medium text-[var(--text-primary)]'}`}>
                              {s.title}
                            </span>
                          </Tooltip>
                        ) : (
                          <span className={`text-sm leading-snug ${isDone ? 'line-through text-gray-400' : isEndStep ? 'font-semibold text-indigo-700' : 'font-medium text-[var(--text-primary)]'}`}>
                            {s.title}
                          </span>
                        )}
                        {isEndStep && !isDone && (
                          <span className="text-[10px] text-indigo-400 italic">Completes all steps</span>
                        )}
                      </div>
                      {/* Step notes */}
                      <div className="mt-1">
                        <StepComments
                          taskId={task.id}
                          stepId={s.id}
                          currentUserId={currentUserId}
                          compact
                        />
                      </div>
                    </div>

                    {/* Client badge */}
                    {s.is_client_step && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 flex-shrink-0 border border-amber-200 font-medium mt-0.5">
                        Client
                      </span>
                    )}

                    {/* Assignee avatar / picker — aligned to top of row */}
                    <div className="flex-shrink-0 mt-0.5">
                      {canReassign ? (
                        <AssigneePicker
                          current={s.assignee ?? null}
                          teamMembers={teamMembers}
                          onSelect={memberId => void handleInlineAssign(s.id, memberId)}
                          disabled={isUpdating || reassignMode}
                          size="sm"
                        />
                      ) : s.assignee ? (
                        <Tooltip label={s.assignee.full_name ?? s.assignee.email} side="top">
                          <div
                            className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white ${avatarColour(s.assignee.id)}`}
                          >
                            {initials(s.assignee.full_name, s.assignee.email)}
                          </div>
                        </Tooltip>
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-gray-100 ring-2 ring-white" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Batch reassign bar (shown at bottom when steps selected) ── */}
            {isAdmin && reassignMode && selectedStepIds.size > 0 && (
              <div className="flex items-center gap-3 px-5 py-3 bg-indigo-600 border-t border-indigo-500">
                <UserCheck className="h-4 w-4 text-indigo-200 flex-shrink-0" />
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  Reassign {selectedStepIds.size} step{selectedStepIds.size !== 1 ? 's' : ''}
                </span>
                <div className="flex-1" />
                <select
                  value={batchTarget}
                  onChange={e => setBatchTarget(e.target.value)}
                  className="text-xs rounded-lg px-2.5 py-1.5 border-0 bg-indigo-500 text-white focus:outline-none focus:ring-2 focus:ring-white/40 min-w-[150px]"
                >
                  <option value="" disabled>Choose person…</option>
                  <option value="__unassigned__">— Unassign —</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.full_name ?? m.email}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleApplyBatch()}
                  disabled={!batchTarget || applying}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
}

export default function ClientTasksPanel({ clientId }: Props) {
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading]       = useState(true);
  const [currentUserId, setCurrentUserId]   = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'staff'>('staff');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [tasksRes, meRes, teamRes] = await Promise.all([
          fetch(`/api/tasks?client_id=${clientId}`),
          fetch('/api/users/me'),
          fetch('/api/users/team'),
        ]);
        if (tasksRes.ok) {
          const d = await tasksRes.json();
          setTasks(d.tasks ?? []);
        }
        if (meRes.ok) {
          const d = await meRes.json();
          setCurrentUserId(d.userId ?? '');
          setCurrentUserRole(d.userRole === 'admin' ? 'admin' : 'staff');
        }
        if (teamRes.ok) {
          const d = await teamRes.json();
          setTeamMembers(d.members ?? []);
        }
      } finally { setLoading(false); }
    }
    void load();
  }, [clientId]);

  const handleStepUpdate = useCallback(async (taskId: string, stepId: string, updates: Partial<TaskStep>) => {
    const r = await fetch(`/api/tasks/${taskId}/steps/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update step');
    const updated = await fetch(`/api/tasks/${taskId}`);
    if (updated.ok) {
      const d = await updated.json();
      setTasks(prev => prev.map(t => t.id === taskId ? (d.task as Task) : t));
    }
  }, []);

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update task');
    const updated = await fetch(`/api/tasks/${taskId}`);
    if (updated.ok) {
      const d = await updated.json();
      setTasks(prev => prev.map(t => t.id === taskId ? (d.task as Task) : t));
    }
  }, []);

  const handleDelete = useCallback(async (taskId: string) => {
    const r = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete task');
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const handleStopRecurrence = useCallback(async (taskId: string) => {
    await handleTaskUpdate(taskId, { recurrence_type: null } as Partial<Task>);
  }, [handleTaskUpdate]);

  function sortByDue(arr: Task[]): Task[] {
    return [...arr].sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }

  const recurringTasks = sortByDue(tasks.filter(t => t.recurrence_type && t.recurrence_type !== 'once'));
  const oneOffTasks    = sortByDue(tasks.filter(t => !t.recurrence_type || t.recurrence_type === 'once'));
  const isAdmin        = currentUserRole === 'admin';

  const commonRowProps = {
    currentUserId,
    isAdmin,
    teamMembers,
    onStepUpdate: handleStepUpdate,
    onTaskUpdate: handleTaskUpdate,
    onDelete: handleDelete,
    onStopRecurrence: handleStopRecurrence,
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)] mx-auto mb-2" />
        <p className="text-sm text-[var(--text-muted)]">Loading tasks…</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="py-16 text-center text-[var(--text-muted)]">
        <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
          <RefreshCw className="h-5 w-5 opacity-30" />
        </div>
        <p className="text-sm font-medium">No tasks for this client</p>
        <p className="text-xs mt-1 opacity-60">Tasks assigned to this client will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Recurring tasks */}
      {recurringTasks.length > 0 && (
        <div className="glass-solid rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)]">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-indigo-100">
              <RefreshCw className="h-3 w-3 text-indigo-600" />
            </div>
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Recurring Tasks
            </h3>
            <span className="ml-auto text-xs font-medium text-[var(--text-muted)]">
              {recurringTasks.length} task{recurringTasks.length !== 1 ? 's' : ''}
            </span>
          </div>
          {recurringTasks.map(t => (
            <ClientTaskRow key={t.id} task={t} {...commonRowProps} />
          ))}
        </div>
      )}

      {/* One-off tasks */}
      {oneOffTasks.length > 0 && (
        <div className="glass-solid rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)]">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gray-100">
              <Check className="h-3 w-3 text-gray-500" />
            </div>
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              One-off Tasks
            </h3>
            <span className="ml-auto text-xs font-medium text-[var(--text-muted)]">
              {oneOffTasks.length} task{oneOffTasks.length !== 1 ? 's' : ''}
            </span>
          </div>
          {oneOffTasks.map(t => (
            <ClientTaskRow key={t.id} task={t} {...commonRowProps} />
          ))}
        </div>
      )}
    </div>
  );
}
