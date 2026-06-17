'use client';

import { useState, useRef, useEffect } from 'react';
import { RefreshCw, ChevronRight, Loader2, Trash2, XCircle, Users, UserCheck, Check, Link2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { TaskStatusBadge } from './TaskStatusBadge';
import DueDatePill from './DueDatePill';
import { sortStepsByWorkflow } from '@/utils/taskUtils';
import StepComments, { initials, avatarColour } from './StepComments';
import AssigneePicker, { type TeamMember } from './AssigneePicker';
import TaskDeadlineLinkBadge from './TaskDeadlineLinkBadge';
import { useTaskDeadlineLinks } from './TaskDeadlineLinksProvider';
import { useTaskClientStatusPolicy } from './TaskClientStatusPolicyProvider';
import type { Task, TaskStep, TaskStatus, StepStatus, RecurrenceType } from '@/types';

// Module-level set so expanded state survives parent re-renders / task prop updates
const expandedIds = new Set<string>();

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  task: Task;
  currentUserId: string;
  onClick: () => void;
  hideClient?: boolean;
  /** When true, the dedicated actions column at the far right is omitted —
   *  used by older callers that haven't migrated yet. */
  hideActions?: boolean;
  isAdmin?: boolean;
  teamMembers?: TeamMember[];
  onStepUpdate?: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'not_started',       label: 'Not Started' },
  { value: 'in_progress',       label: 'In Progress' },
  { value: 'waiting_on_client', label: 'Waiting on Client' },
  { value: 'records_here',      label: 'Records Here' },
  { value: 'review',            label: 'Review' },
  { value: 'complete',          label: 'Complete' },
];

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Weekly', 'bi-weekly': 'Bi-weekly', 'four-weekly': 'Four-weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annually: 'Annually',
};

const CH_DEADLINE_LABELS: Record<string, string> = {
  accounts_due:    'Accounts Due',
  cs_due:          'Confirmation Statement',
  officer_idv_due: 'Officer IDV',
  psc_idv_due:     'PSC IDV',
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
    case 'four-weekly': base.setDate(base.getDate() + 28);       break;
    case 'monthly':   base.setMonth(base.getMonth() + 1);        break;
    case 'quarterly': base.setMonth(base.getMonth() + 3);        break;
    case 'annually':  base.setFullYear(base.getFullYear() + 1);  break;
    case 'custom':    if (intervalDays) base.setDate(base.getDate() + intervalDays); break;
  }
  return base.toISOString().split('T')[0];
}

// ── Step hover tooltip ────────────────────────────────────────────────────────

function StepTooltip({ step }: { step: TaskStep }) {
  if (!step.description && !step.assignee && !step.due_date) return null;
  return (
    <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-3 pointer-events-none">
      <p className="text-xs font-semibold text-gray-800 mb-1">{step.title}</p>
      {step.description && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">{step.description}</p>
      )}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {step.assignee && (
          <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
            <span className={`h-3.5 w-3.5 rounded-full inline-flex items-center justify-center text-[8px] font-bold text-white ${avatarColour(step.assignee.id)}`}>
              {initials(step.assignee.full_name, step.assignee.email).slice(0,1)}
            </span>
            {step.assignee.full_name ?? step.assignee.email}
          </span>
        )}
        {step.due_date && (
          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            Due {new Date(step.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        {step.is_client_step && (
          <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">Client step</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TaskListRow({
  task, currentUserId, onClick, hideClient = false, hideActions = false,
  isAdmin = false, teamMembers = [],
  onStepUpdate, onTaskUpdate, onDelete, onStopRecurrence,
}: Props) {
  const deadlineLinks = useTaskDeadlineLinks(task.id);
  const { policy: clientStatusPolicy } = useTaskClientStatusPolicy();
  const clientStatus = (task.client as { status?: string | null } | null | undefined)?.status ?? null;
  const isClientOnHold   = clientStatus === 'hold';
  const isClientInactive = clientStatus === 'inactive';
  // Apply the grey-out style when the firm's policy asks for it and the
  // client is on hold. Inactive clients get the same de-emphasis.
  const dimRow = (isClientOnHold && clientStatusPolicy.on_hold.grey_out_rows) || isClientInactive;
  const [expanded, setExpanded]               = useState(() => expandedIds.has(task.id));
  const [updatingStep, setUpdatingStep]       = useState<string | null>(null);
  const [updatingTask, setUpdatingTask]       = useState(false);
  const [hoveredStepId, setHoveredStepId]     = useState<string | null>(null);
  // While a step row holds focus (e.g. the user is editing its note), we hide
  // the hover card so it doesn't cover the field they're typing in.
  const [focusedStepId, setFocusedStepId]     = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete]     = useState(false);
  const [deleting, setDeleting]               = useState(false);
  const [stoppingRec, setStoppingRec]         = useState(false);

  // Reassign mode state
  const [reassignMode, setReassignMode]       = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget]         = useState('');
  const [applying, setApplying]               = useState(false);

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allSteps    = task.steps ?? [];
  const edges       = task.edges ?? [];
  const sortedSteps = sortStepsByWorkflow(allSteps, edges);
  const workSteps   = sortedSteps.filter(s => s.step_type !== 'start');

  const totalSteps = workSteps.length;
  const doneSteps  = workSteps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
  const pct        = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const nextStep   = workSteps.find(s => s.status !== 'complete' && s.status !== 'skipped') ?? null;

  const assignees = allSteps
    .filter(s => s.assignee && !s.is_client_step)
    .map(s => s.assignee!)
    .filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i)
    .slice(0, 4);

  const isRecurring  = task.recurrence_type && task.recurrence_type !== 'once';
  const isChLinked   = deadlineLinks.length > 0;
  const nextDueDate  = isRecurring
    ? computeNextDue(task.due_date, task.recurrence_type, task.recurrence_interval_days)
    : null;
  const nextDueStr   = nextDueDate
    ? new Date(nextDueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  // Column span for the expanded-steps row — depends on which optional columns
  // the parent view is rendering. hideClient drops one column; hideActions
  // drops the new dedicated actions column at the far right.
  const colSpan        = (hideClient ? 5 : 6) + (hideActions ? 0 : 1);
  const canExpand      = !!onStepUpdate && workSteps.length > 0;
  const reassignable   = workSteps.filter(s => !s.is_client_step);
  const allRSelected   = reassignable.length > 0 && reassignable.every(s => selectedStepIds.has(s.id));
  const someRSelected  = selectedStepIds.size > 0 && !allRSelected;

  function exitReassign() {
    setReassignMode(false);
    setSelectedStepIds(new Set());
    setBatchTarget('');
  }

  // Delayed hover
  function handleStepMouseEnter(stepId: string) {
    hoverTimer.current = setTimeout(() => setHoveredStepId(stepId), 300);
  }
  function handleStepMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredStepId(null);
  }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleStepStatus(stepId: string, status: StepStatus) {
    if (!onStepUpdate) return;
    setUpdatingStep(stepId);
    try { await onStepUpdate(task.id, stepId, { status }); }
    finally { setUpdatingStep(null); }
  }

  async function handleTaskStatus(status: TaskStatus) {
    if (!onTaskUpdate) return;
    setUpdatingTask(true);
    try { await onTaskUpdate(task.id, { status }); }
    finally { setUpdatingTask(false); }
  }

  async function handleCompleteAll() {
    if (!onStepUpdate || !onTaskUpdate) return;
    setUpdatingTask(true);
    try {
      const incomplete = workSteps.filter(s => s.status !== 'complete' && s.status !== 'skipped');
      await Promise.all(incomplete.map(s => onStepUpdate(task.id, s.id, { status: 'complete' })));
      await onTaskUpdate(task.id, { status: 'complete' });
    } finally { setUpdatingTask(false); }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try { await onDelete(task.id); }
    finally { setDeleting(false); setConfirmDelete(false); }
  }

  async function handleStopRecurrence() {
    if (!onStopRecurrence) return;
    setStoppingRec(true);
    try { await onStopRecurrence(task.id); }
    finally { setStoppingRec(false); }
  }

  async function handleInlineAssign(stepId: string, memberId: string | null) {
    if (!onStepUpdate) return;
    setUpdatingStep(stepId);
    try { await onStepUpdate(task.id, stepId, { assignee_id: memberId } as Partial<TaskStep>); }
    finally { setUpdatingStep(null); }
  }

  async function handleApplyBatch() {
    if (!batchTarget || selectedStepIds.size === 0 || !onStepUpdate) return;
    setApplying(true);
    try {
      const newId = batchTarget === '__unassigned__' ? null : batchTarget;
      await Promise.all([...selectedStepIds].map(sid =>
        onStepUpdate(task.id, sid, { assignee_id: newId } as Partial<TaskStep>)
      ));
      exitReassign();
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
    setSelectedStepIds(allRSelected ? new Set() : new Set(reassignable.map(s => s.id)));
  }

  return (
    <>
      {/* ── Main task row ── */}
      <tr className={`group hover:bg-indigo-50/40 transition-colors border-b border-gray-100 last:border-0 ${confirmDelete ? 'bg-red-50/30' : ''} ${dimRow ? 'opacity-50 bg-gray-50/40' : ''}`}>

        {/* Task title + recurrence info */}
        <td className="px-4 py-3 min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            {canExpand && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  setExpanded(v => {
                    const next = !v;
                    next ? expandedIds.add(task.id) : expandedIds.delete(task.id);
                    if (!next) exitReassign();
                    return next;
                  });
                }}
                className={`flex-shrink-0 mt-0.5 p-0.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all ${expanded ? 'rotate-90 text-indigo-500' : ''}`}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {isRecurring && (
                  <Tooltip label={recurrenceLabel(task.recurrence_type, task.recurrence_interval_days)} className="flex-shrink-0">
                    <RefreshCw className="h-3 w-3 text-indigo-400" />
                  </Tooltip>
                )}
                <Tooltip label={task.title} className="min-w-0 flex-1">
                  <button onClick={onClick} className="text-sm font-medium text-gray-900 truncate text-left hover:text-indigo-700 transition-colors w-full">
                    {task.title}
                  </button>
                </Tooltip>
                <TaskDeadlineLinkBadge links={deadlineLinks} />
              </div>
              {/* Next repeat date — visible to all users */}
              {isRecurring && nextDueStr && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  <span className="text-indigo-500 font-medium">{recurrenceLabel(task.recurrence_type, task.recurrence_interval_days)}</span>
                  {' · '}Deadline on next cycle: <span className="font-medium text-indigo-600">{nextDueStr}</span>
                </p>
              )}
              {/* CH-linked meta line — only shown when not recurring (CH-linked tasks never have manual recurrence) */}
              {isChLinked && !isRecurring && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
                  <Link2 className="h-3 w-3 text-[var(--accent)]" />
                  <span className="text-[var(--accent)] font-medium">CH Secretarial</span>
                  {deadlineLinks[0] && (
                    <>
                      {' · '}
                      <span>{CH_DEADLINE_LABELS[deadlineLinks[0].deadline_type] ?? deadlineLinks[0].deadline_type}</span>
                      {deadlineLinks[0].offset_days !== 0 && (
                        <span className="text-gray-400"> ({deadlineLinks[0].offset_days > 0 ? '+' : ''}{deadlineLinks[0].offset_days}d)</span>
                      )}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        </td>

        {!hideClient && (
          <td className="px-4 py-3 max-w-[200px] cursor-pointer" onClick={onClick}>
            {task.client ? (
              <div className="min-w-0">
                <span className="text-sm text-gray-700 font-medium truncate block">{task.client.name}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-mono text-gray-400">{task.client.client_ref}</span>
                  {task.client.status && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0 ${
                      task.client.status === 'active' ? 'bg-green-100 text-green-700' :
                      task.client.status === 'hold'   ? 'bg-amber-100 text-amber-700' :
                                                        'bg-gray-100 text-gray-500'
                    }`}>{task.client.status === 'hold' ? 'On Hold' : task.client.status}</span>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-xs text-gray-400 italic">{task.is_internal ? 'Internal' : '—'}</span>
            )}
          </td>
        )}

        <td className="px-4 py-3 whitespace-nowrap cursor-pointer" onClick={onClick}>
          <TaskStatusBadge status={task.status} />
        </td>

        <td className="px-4 py-3 whitespace-nowrap cursor-pointer" onClick={onClick}>
          {totalSteps > 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
                <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-gray-400">{doneSteps}/{totalSteps}</span>
            </div>
          ) : <span className="text-xs text-gray-300">—</span>}
        </td>

        <td className="px-4 py-3 whitespace-nowrap cursor-pointer" onClick={onClick}>
          <DueDatePill dueDate={task.due_date} status={task.status} />
        </td>

        {/* Assignees — just the avatars now; all admin actions moved to the
            dedicated Actions column on the far right. */}
        <td className="px-4 py-3 cursor-pointer" onClick={onClick}>
          <div className="flex -space-x-1.5">
            {assignees.map(a => (
              <Tooltip key={a.id} label={a.full_name ?? a.email} side="top" className="flex-shrink-0">
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white ${a.id === currentUserId ? 'ring-indigo-400' : ''} ${avatarColour(a.id)}`}>
                  {initials(a.full_name, a.email)}
                </div>
              </Tooltip>
            ))}
            {assignees.length === 0 && <span className="text-xs text-gray-300">—</span>}
          </div>
        </td>

        {/* Dedicated Actions column — always visible (no hover-reveal). Holds
            set-recurrence, stop-recurrence and delete. Omitted entirely when
            the parent view passes hideActions. */}
        {!hideActions && (
          <td className="px-2 py-3 whitespace-nowrap">
            {confirmDelete ? (
              <div className="flex items-center gap-1 justify-end">
                <span className="text-[11px] text-red-600 font-medium whitespace-nowrap">Delete?</span>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="px-2 py-0.5 text-[11px] bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {deleting ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-0.5 text-[11px] border border-gray-200 text-gray-500 rounded hover:bg-gray-50 transition-colors"
                >
                  No
                </button>
              </div>
            ) : isAdmin ? (
              <div className="flex items-center gap-0.5 justify-end">
                {isRecurring && onStopRecurrence && (
                  <Tooltip label="Stop recurrence">
                    <button
                      onClick={e => { e.stopPropagation(); void handleStopRecurrence(); }}
                      disabled={stoppingRec}
                      aria-label="Stop recurrence"
                      className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 transition-colors"
                    >
                      {stoppingRec ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    </button>
                  </Tooltip>
                )}
                {!isRecurring && !isChLinked && onTaskUpdate && (
                  <Tooltip label="Set recurrence">
                    <select
                      value=""
                      onClick={e => e.stopPropagation()}
                      onChange={async e => {
                        e.stopPropagation();
                        const value = e.target.value;
                        if (!value) return;
                        let recurrence_type: RecurrenceType;
                        let recurrence_interval_days: number | null = null;
                        if (value === 'custom') {
                          const days = window.prompt('Repeat every how many days?', '30');
                          const parsed = days ? parseInt(days, 10) : NaN;
                          if (!parsed || parsed < 1) { e.target.value = ''; return; }
                          recurrence_type = 'custom';
                          recurrence_interval_days = parsed;
                        } else {
                          recurrence_type = value as RecurrenceType;
                        }
                        await onTaskUpdate(task.id, { recurrence_type, recurrence_interval_days });
                        e.target.value = '';
                      }}
                      aria-label="Set recurrence"
                      className="p-1 rounded-lg text-indigo-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors text-xs cursor-pointer bg-transparent border-0"
                    >
                      <option value="" disabled>↻</option>
                      <option value="weekly">Weekly</option>
                      <option value="bi-weekly">Bi-weekly</option>
                      <option value="four-weekly">Four-weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annually">Annually</option>
                      <option value="custom">Custom interval…</option>
                    </select>
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
            ) : (
              <span className="text-xs text-gray-300">—</span>
            )}
          </td>
        )}
      </tr>

      {/* ── Expanded step panel ── */}
      {expanded && canExpand && (
        <tr className="border-b border-gray-100">
          <td colSpan={colSpan} className="px-0 py-0 bg-gray-50/70">
            <div className="mx-4 mb-3 mt-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">

              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Steps</span>
                  <span className="text-xs text-gray-400">{doneSteps} of {totalSteps} done</span>
                  <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {updatingTask && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />}

                  {/* Reassign toggle (admin only) */}
                  {isAdmin && reassignable.length > 0 && !reassignMode && (
                    <button
                      onClick={() => setReassignMode(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-500 border border-gray-200 hover:bg-white hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Reassign
                    </button>
                  )}
                  {isAdmin && reassignMode && (
                    <button
                      onClick={exitReassign}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-400 border border-gray-200 hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                  )}

                  {onTaskUpdate && (
                    <select
                      value={task.status} disabled={updatingTask}
                      onChange={e => handleTaskStatus(e.target.value as TaskStatus)}
                      onClick={e => e.stopPropagation()}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white disabled:opacity-50"
                    >
                      {TASK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {/* Reassign sub-header */}
              {isAdmin && reassignMode && (
                <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
                  <button
                    onClick={toggleSelectAll}
                    className={`flex-shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                      ${allRSelected ? 'bg-indigo-500 border-indigo-500' : someRSelected ? 'bg-indigo-200 border-indigo-400' : 'border-gray-300 hover:border-indigo-400 bg-white'}`}
                  >
                    {allRSelected && <svg className="h-2.5 w-2.5 text-[var(--text-primary)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                    {someRSelected && !allRSelected && <div className="w-2 h-0.5 bg-indigo-600 rounded" />}
                  </button>
                  <span className="text-xs text-indigo-600 font-medium">
                    {selectedStepIds.size > 0 ? `${selectedStepIds.size} step${selectedStepIds.size !== 1 ? 's' : ''} selected` : 'Select steps to reassign'}
                  </span>
                </div>
              )}

              {/* Step rows */}
              <div className="divide-y divide-gray-50">
                {workSteps.map((s, idx) => {
                  const isDone      = s.status === 'complete' || s.status === 'skipped';
                  const isProgress  = s.status === 'in_progress';
                  const isWaiting   = s.status === 'waiting_on_client';
                  const isEndStep   = s.step_type === 'end';
                  const isNextUp    = s.id === nextStep?.id;
                  const isUpdating  = updatingStep === s.id || (isEndStep && updatingTask);
                  const isHovered   = hoveredStepId === s.id;
                  const isSelected  = selectedStepIds.has(s.id);
                  const canReassign = isAdmin && !s.is_client_step;

                  return (
                    <div
                      key={s.id}
                      className={`flex items-start gap-3 px-4 py-2.5 transition-colors
                        ${isDone ? 'bg-green-50/40' : isSelected ? 'bg-indigo-50/50' : isProgress ? 'bg-indigo-50/30' : isWaiting ? 'bg-amber-50/30' : isEndStep ? 'bg-indigo-50/20' : ''}
                        ${isNextUp && !isSelected ? 'border-l-2 border-indigo-400' : isSelected ? 'border-l-2 border-indigo-500' : 'border-l-2 border-transparent'}`}
                      onMouseEnter={() => !reassignMode && handleStepMouseEnter(s.id)}
                      onMouseLeave={handleStepMouseLeave}
                      onFocusCapture={() => setFocusedStepId(s.id)}
                      onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedStepId(prev => (prev === s.id ? null : prev)); }}
                    >
                      {/* Reassign checkbox */}
                      {reassignMode && (
                        <button
                          onClick={() => canReassign && toggleStep(s.id)}
                          disabled={!canReassign}
                          className={`flex-shrink-0 mt-1 h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                            ${isSelected ? 'bg-indigo-500 border-indigo-500' : canReassign ? 'border-gray-300 hover:border-indigo-400 cursor-pointer bg-white' : 'border-gray-200 opacity-25 cursor-default bg-white'}`}
                        >
                          {isSelected && <svg className="h-2.5 w-2.5 text-[var(--text-primary)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                        </button>
                      )}

                      {/* Complete checkbox */}
                      <Tooltip label={isEndStep && !isDone ? 'Complete task — marks all steps done' : isDone ? 'Mark as not started' : 'Mark as complete'} className="flex-shrink-0 mt-1">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (isEndStep && !isDone) handleCompleteAll();
                            else handleStepStatus(s.id, isDone ? 'not_started' : 'complete');
                          }}
                          disabled={isUpdating || reassignMode}
                          aria-label={isEndStep && !isDone ? 'Complete task' : isDone ? 'Mark as not started' : 'Mark as complete'}
                          className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all
                            ${isDone ? 'bg-green-500 border-green-500' : isEndStep ? 'border-indigo-400 bg-white hover:bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-400'}
                            ${isUpdating ? 'opacity-50 cursor-wait' : reassignMode ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {isUpdating ? <Loader2 className="h-3 w-3 text-[var(--text-primary)] animate-spin" /> :
                           isDone ? (
                            <svg className="h-3 w-3 text-[var(--text-primary)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="2,6 5,9 10,3" />
                            </svg>
                          ) : null}
                        </button>
                      </Tooltip>

                      {/* Step number */}
                      <span className="text-[10px] font-semibold text-gray-300 tabular-nums w-5 flex-shrink-0 mt-1.5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>

                      {/* Title + tooltip */}
                      <div className="relative flex-shrink-0 w-48">
                        <span className={`text-sm font-medium leading-snug block ${isDone ? 'line-through text-gray-400' : isEndStep ? 'text-indigo-700' : 'text-gray-800'}`}>
                          {s.title}
                        </span>
                        {isEndStep && !isDone && (
                          <p className="text-[10px] text-indigo-400 mt-0.5">Ticking this completes all steps &amp; closes the task</p>
                        )}
                        {isHovered && focusedStepId !== s.id && (s.description || s.assignee || s.due_date || s.is_client_step) && (
                          <StepTooltip step={s} />
                        )}
                      </div>

                      {/* Comments — fills the middle */}
                      <StepComments taskId={task.id} stepId={s.id} currentUserId={currentUserId} />

                      {/* Assignee: picker for admin (when not in reassign mode), static for staff */}
                      {canReassign && !reassignMode ? (
                        <div className="flex-shrink-0 mt-1">
                          <AssigneePicker
                            current={s.assignee ?? null}
                            teamMembers={teamMembers}
                            onSelect={memberId => void handleInlineAssign(s.id, memberId)}
                            disabled={isUpdating}
                            size="sm"
                          />
                        </div>
                      ) : s.assignee ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0 mt-1">
                          <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColour(s.assignee.id)}`}>
                            <span className="text-[9px] font-bold text-white leading-none">
                              {initials(s.assignee.full_name, s.assignee.email).slice(0,1)}
                            </span>
                          </div>
                          <span className="text-xs text-gray-400 hidden sm:block">
                            {s.assignee.full_name?.split(' ')[0] ?? s.assignee.email}
                          </span>
                        </div>
                      ) : null}

                      {/* Status pill */}
                      {!isDone && !reassignMode && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-1 ${
                          isProgress ? 'bg-indigo-100 text-indigo-600'
                          : isWaiting ? 'bg-amber-100 text-amber-600'
                          : isNextUp  ? 'bg-indigo-500 text-white'
                          : 'bg-gray-100 text-gray-400'
                        }`}>
                          {isProgress ? 'In Progress' : isWaiting ? 'Waiting' : isNextUp ? 'Next up' : 'Not Started'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Batch reassign bar */}
              {isAdmin && reassignMode && selectedStepIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 bg-indigo-600 border-t border-indigo-500">
                  <UserCheck className="h-4 w-4 text-indigo-200 flex-shrink-0" />
                  <span className="text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap">
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
                    {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                  </select>
                  <button
                    onClick={() => void handleApplyBatch()}
                    disabled={!batchTarget || applying}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Apply
                  </button>
                  <button onClick={exitReassign} className="text-indigo-300 hover:text-[var(--text-primary)] transition-colors text-xs">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
