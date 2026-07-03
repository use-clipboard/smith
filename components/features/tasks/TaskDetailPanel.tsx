'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Clock, RefreshCw, User, ChevronDown, CheckCircle2,
  Play, Pause, Plus, Trash2, ExternalLink, Loader2, AlertCircle, Puzzle,
  XCircle, Users, UserCheck, Check, GripVertical, Sparkles, Pencil,
} from 'lucide-react';
import { TaskStatusBadge, StepStatusBadge } from './TaskStatusBadge';
import DueDatePill from './DueDatePill';
import Tooltip from '@/components/ui/Tooltip';
import { sortStepsByWorkflow } from '@/utils/taskUtils';
import { TaskViewFlowChart } from './TaskFlowChart';
import StepComments, { initials, avatarColour } from './StepComments';
import AssigneePicker, { type TeamMember } from './AssigneePicker';
import TemplateBuilder from './TemplateBuilder';
import { MODULES } from '@/config/modules.config';
import type { Task, TaskStatus, StepStatus, TaskStep, RecurrenceType } from '@/types';

interface Props {
  task: Task;
  currentUserId: string;
  onClose: () => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onStepUpdate: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onLogTime: (taskId: string, entry: { step_id?: string; started_at: string; ended_at: string; notes?: string }) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  isAdmin?: boolean;
  teamMembers?: TeamMember[];
  onStopRecurrence?: (taskId: string) => Promise<void>;
  /** Triggers the parent to re-fetch the single task so step-list edits show
   *  in the panel without closing it. Optional; falls back to a full reload. */
  onTaskRefetch?: (taskId: string) => Promise<void>;
}

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Weekly', 'bi-weekly': 'Bi-weekly', 'four-weekly': 'Four-weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annually: 'Annually',
};
function recurrenceLabel(type: RecurrenceType | null, intervalDays: number | null): string {
  if (!type || type === 'once') return '';
  if (type === 'custom' && intervalDays) return `Every ${intervalDays} days`;
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
function formatShortDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Tab = 'workflow' | 'time' | 'details';

const STEP_STATUS_OPTIONS: { value: StepStatus; label: string }[] = [
  { value: 'not_started',       label: 'Not Started' },
  { value: 'in_progress',       label: 'In Progress' },
  { value: 'waiting_on_client', label: 'Waiting on Client' },
  { value: 'complete',          label: 'Complete' },
  { value: 'skipped',           label: 'Skip' },
];

const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'not_started',       label: 'Not Started' },
  { value: 'in_progress',       label: 'In Progress' },
  { value: 'waiting_on_client', label: 'Waiting on Client' },
  { value: 'records_here',      label: 'Records Here' },
  { value: 'review',            label: 'Review' },
  { value: 'complete',          label: 'Complete' },
];


function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDuration(mins: number | null) {
  if (!mins) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function totalTime(task: Task) {
  return (task.time_entries ?? []).reduce((s, e) => s + (e.duration_minutes ?? 0), 0);
}

/** ISO string carrying the LOCAL wall-clock time + offset (e.g.
 *  "2026-07-03T14:30:00+01:00"), rather than toISOString()'s UTC. Lets the
 *  server read the correct local date/HH:mm while timestamptz columns still
 *  parse the absolute instant correctly. */
function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = tz >= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ── Time tracker sub-component ────────────────────────────────────────────────
function TimeTracker({ task, steps, onLogTime }: {
  task: Task;
  steps: TaskStep[];
  onLogTime: (entry: { step_id?: string; started_at: string; ended_at: string; notes?: string }) => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedStepId, setSelectedStepId] = useState('');
  const [notes, setNotes] = useState('');
  const [manualHours, setManualHours] = useState('');
  const [manualMins, setManualMins] = useState('');
  const [saving, setSaving] = useState(false);

  // Live timer
  const tick = useCallback(() => {
    if (startedAt) setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
  }, [startedAt]);

  useState(() => {
    if (!running) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  });

  async function handleStop() {
    if (!startedAt) return;
    const ended = new Date();
    setSaving(true);
    try {
      await onLogTime({
        step_id: selectedStepId || undefined,
        started_at: toLocalIso(startedAt),
        ended_at: toLocalIso(ended),
        notes: notes || undefined,
      });
      setRunning(false);
      setStartedAt(null);
      setElapsed(0);
      setNotes('');
    } finally {
      setSaving(false);
    }
  }

  async function handleManualLog() {
    const h = parseInt(manualHours) || 0;
    const m = parseInt(manualMins) || 0;
    if (h === 0 && m === 0) return;
    setSaving(true);
    try {
      const now = new Date();
      const started = new Date(now.getTime() - (h * 60 + m) * 60000);
      await onLogTime({
        step_id: selectedStepId || undefined,
        started_at: toLocalIso(started),
        ended_at: toLocalIso(now),
        notes: notes || undefined,
      });
      setManualHours('');
      setManualMins('');
      setNotes('');
    } finally {
      setSaving(false);
    }
  }

  const fmtElapsed = `${String(Math.floor(elapsed / 3600)).padStart(2,'0')}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2,'0')}:${String(elapsed % 60).padStart(2,'0')}`;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Total logged</p>
          <p className="text-lg font-bold text-gray-900">{formatDuration(totalTime(task))}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Entries</p>
          <p className="text-lg font-bold text-gray-900">{task.time_entries?.length ?? 0}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500 mb-0.5">Est. total</p>
          <p className="text-lg font-bold text-gray-900">
            {formatDuration(steps.reduce((s, st) => s + (st.email_reminder_config as unknown as null ?? 0), 0) as unknown as null)}
          </p>
        </div>
      </div>

      {/* Timer controls */}
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Log Time</p>

        <div className="flex gap-2 mb-3">
          <select value={selectedStepId} onChange={e => setSelectedStepId(e.target.value)} className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
            <option value="">Task (no specific step)</option>
            {steps.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>

        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 mb-3 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />

        {/* Live timer */}
        <div className="flex items-center gap-3 mb-3">
          <div className="text-2xl font-mono font-bold text-gray-700 tabular-nums">{fmtElapsed}</div>
          {!running ? (
            <button onClick={() => { setRunning(true); setStartedAt(new Date()); setElapsed(0); }} className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-indigo-700">
              <Play className="h-3.5 w-3.5" /> Start Timer
            </button>
          ) : (
            <button onClick={handleStop} disabled={saving} className="flex items-center gap-1.5 bg-red-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-red-600 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
              Stop & Save
            </button>
          )}
        </div>

        {/* Manual entry */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Or log manually:</span>
          <input type="number" min="0" placeholder="h" value={manualHours} onChange={e => setManualHours(e.target.value)} className="w-14 text-sm border border-gray-200 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <span className="text-xs text-gray-400">h</span>
          <input type="number" min="0" max="59" placeholder="m" value={manualMins} onChange={e => setManualMins(e.target.value)} className="w-14 text-sm border border-gray-200 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <span className="text-xs text-gray-400">m</span>
          <button onClick={handleManualLog} disabled={saving || (!manualHours && !manualMins)} className="text-sm bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded disabled:opacity-40">Log</button>
        </div>
      </div>

      {/* Entries list */}
      {task.time_entries && task.time_entries.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">History</p>
          <div className="space-y-1.5">
            {task.time_entries.map(e => (
              <div key={e.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                <div>
                  <p className="text-sm text-gray-700">{formatDuration(e.duration_minutes)}</p>
                  {e.notes && <p className="text-xs text-gray-400">{e.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">{e.user?.full_name ?? e.user?.email ?? 'Unknown'}</p>
                  <p className="text-xs text-gray-300">{new Date(e.started_at).toLocaleDateString('en-GB')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TaskDetailPanel({ task, currentUserId, onClose, onUpdate, onStepUpdate, onLogTime, onDelete, isAdmin = false, teamMembers = [], onStopRecurrence, onTaskRefetch }: Props) {
  const [activeTab, setActiveTab]             = useState<Tab>('workflow');
  const [selectedStepId, setSelectedStepId]   = useState<string | null>(null);
  const [updatingStep, setUpdatingStep]       = useState<string | null>(null);
  const [updatingTask, setUpdatingTask]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [stoppingRec, setStoppingRec]         = useState(false);

  // Step reassignment state
  const [reassignMode, setReassignMode]       = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget]         = useState('');
  const [applying, setApplying]               = useState(false);

  // Per-task step customisation
  const [addingStep, setAddingStep]           = useState(false);
  const [newStepTitle, setNewStepTitle]       = useState('');
  // Visual workflow editor (admin only) — opens TemplateBuilder in edit-task mode
  const [showWorkflowEditor, setShowWorkflowEditor] = useState(false);
  const [submittingNewStep, setSubmittingNewStep] = useState(false);
  const [deletingStepId, setDeletingStepId]   = useState<string | null>(null);
  // Drag-to-reorder
  const [draggingStepId, setDraggingStepId]   = useState<string | null>(null);
  const [dragOverStepId, setDragOverStepId]   = useState<string | null>(null);
  const [reordering, setReordering]           = useState(false);

  function exitReassign() {
    setReassignMode(false);
    setSelectedStepIds(new Set());
    setBatchTarget('');
  }

  // The list endpoint (GET /api/tasks) sends a TRIMMED steps payload — enough
  // to render cards and this panel's checklist/flowchart, but without the heavy
  // per-step config JSON (email reminders, client instructions, triggers). The
  // workflow editor needs the full objects, so we hydrate the full task once on
  // open via onTaskRefetch. A step is "trimmed" if it lacks a full-only key.
  const firstStep = task.steps?.[0];
  const stepsTrimmed = firstStep ? !('client_instructions' in firstStep) : false;
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (stepsTrimmed && onTaskRefetch && hydratedFor.current !== task.id) {
      hydratedFor.current = task.id;
      void onTaskRefetch(task.id);
    }
  }, [task.id, stepsTrimmed, onTaskRefetch]);

  const edges = task.edges ?? [];
  const steps = sortStepsByWorkflow(task.steps ?? [], edges);
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? null;

  async function handleStepStatus(stepId: string, status: StepStatus) {
    setUpdatingStep(stepId);
    try { await onStepUpdate(task.id, stepId, { status }); }
    finally { setUpdatingStep(null); }
  }

  async function handleTaskStatus(status: TaskStatus) {
    setUpdatingTask(true);
    try { await onUpdate(task.id, { status }); }
    finally { setUpdatingTask(false); }
  }

  // Ticking the 'end' step marks every incomplete step complete and closes the task
  async function handleCompleteAll() {
    setUpdatingTask(true);
    try {
      const incomplete = (task.steps ?? []).filter(
        s => s.step_type !== 'start' && s.status !== 'complete' && s.status !== 'skipped'
      );
      await Promise.all(incomplete.map(s => onStepUpdate(task.id, s.id, { status: 'complete' })));
      await onUpdate(task.id, { status: 'complete' });
    } finally {
      setUpdatingTask(false);
    }
  }

  async function handleStopRecurrence() {
    if (!onStopRecurrence) return;
    setStoppingRec(true);
    try { await onStopRecurrence(task.id); }
    finally { setStoppingRec(false); }
  }

  async function handleSetRecurrence(value: string) {
    if (!value) return;
    let recurrence_type: RecurrenceType;
    let recurrence_interval_days: number | null = null;
    if (value === 'custom') {
      const days = window.prompt('Repeat every how many days?', '30');
      const parsed = days ? parseInt(days, 10) : NaN;
      if (!parsed || parsed < 1) return;
      recurrence_type = 'custom';
      recurrence_interval_days = parsed;
    } else {
      recurrence_type = value as RecurrenceType;
    }
    setUpdatingTask(true);
    try { await onUpdate(task.id, { recurrence_type, recurrence_interval_days }); }
    finally { setUpdatingTask(false); }
  }

  async function handleInlineAssign(stepId: string, memberId: string | null) {
    setUpdatingStep(stepId);
    try { await onStepUpdate(task.id, stepId, { assignee_id: memberId } as Partial<TaskStep>); }
    finally { setUpdatingStep(null); }
  }

  async function handleAddStep() {
    const title = newStepTitle.trim();
    if (!title) return;
    setSubmittingNewStep(true);
    try {
      const r = await fetch(`/api/tasks/${task.id}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_key: `custom_${Date.now().toString(36)}`,
          title,
          // Place after the current last step in flat ordering
          position_y: (Math.max(0, ...(task.steps ?? []).map(s => s.position_y ?? 0)) + 100),
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(data.error ?? 'Failed to add step');
        return;
      }
      setNewStepTitle('');
      setAddingStep(false);
      await onTaskRefetch?.(task.id);
    } finally { setSubmittingNewStep(false); }
  }

  async function handleDeleteStep(stepId: string) {
    if (!confirm('Delete this step? This only affects this client\'s task — the template is unchanged.')) return;
    setDeletingStepId(stepId);
    try {
      const r = await fetch(`/api/tasks/${task.id}/steps/${stepId}`, { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(data.error ?? 'Failed to delete step');
        return;
      }
      await onTaskRefetch?.(task.id);
    } finally { setDeletingStepId(null); }
  }

  async function commitReorder(orderedStepIds: string[]) {
    setReordering(true);
    try {
      await fetch(`/api/tasks/${task.id}/steps/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedStepIds }),
      });
      await onTaskRefetch?.(task.id);
    } finally { setReordering(false); }
  }

  function handleStepDragStart(e: React.DragEvent, stepId: string) {
    setDraggingStepId(stepId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleStepDragOver(e: React.DragEvent, overId: string) {
    if (!draggingStepId || draggingStepId === overId) return;
    e.preventDefault();
    setDragOverStepId(overId);
  }
  function handleStepDrop(overId: string) {
    if (!draggingStepId || draggingStepId === overId) { setDraggingStepId(null); setDragOverStepId(null); return; }
    const ids = workSteps.map(s => s.id);
    const fromIdx = ids.indexOf(draggingStepId);
    const overIdx = ids.indexOf(overId);
    if (fromIdx < 0 || overIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(overIdx, 0, draggingStepId);
    setDraggingStepId(null);
    setDragOverStepId(null);
    void commitReorder(ids);
  }

  async function handleApplyBatch() {
    if (!batchTarget || selectedStepIds.size === 0) return;
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
    setSelectedStepIds(prev => { const n = new Set(prev); n.has(stepId) ? n.delete(stepId) : n.add(stepId); return n; });
  }

  // 'start' steps are workflow entry markers, not actionable work items — exclude from counts and the checklist.
  // Sort by position_y so per-task drag-to-reorder is honoured here; 'end' always goes last.
  const workSteps = steps
    .filter(s => s.step_type !== 'start')
    .sort((a, b) => {
      if (a.step_type === 'end' && b.step_type !== 'end') return 1;
      if (a.step_type !== 'end' && b.step_type === 'end') return -1;
      return (a.position_y ?? 0) - (b.position_y ?? 0);
    });
  const completedCount = workSteps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
  const progressPct = workSteps.length > 0 ? Math.round((completedCount / workSteps.length) * 100) : 0;

  // The "next up" step is the first work step that isn't complete or skipped
  const nextStep = workSteps.find(s => s.status !== 'complete' && s.status !== 'skipped') ?? null;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-5xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 truncate">{task.title}</h2>
              {task.recurrence_type && task.recurrence_type !== 'once' && (() => {
                const nextDue = computeNextDue(task.due_date, task.recurrence_type, task.recurrence_interval_days);
                return (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2.5 py-0.5 rounded-full font-medium">
                    <RefreshCw className="h-3 w-3" />
                    {recurrenceLabel(task.recurrence_type, task.recurrence_interval_days)}
                    {nextDue && <span className="text-indigo-400 font-normal">· Deadline on next cycle: {formatShortDate(nextDue)}</span>}
                  </span>
                );
              })()}
              {/* "Customised" badge — any step without template_step_id means this task diverges from its template */}
              {task.template_id && (task.steps ?? []).some(s => !s.template_step_id) && (
                <Tooltip label="This task has steps that aren't in its template. Edits to the template won't overwrite them.">
                  <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                    <Sparkles className="h-2.5 w-2.5" /> Customised
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {task.client ? (
                <span className="text-sm text-gray-600 font-medium">{task.client.name}</span>
              ) : (
                <span className="text-sm text-gray-400 italic">Internal</span>
              )}
              {task.due_date && (
                <DueDatePill dueDate={task.due_date} status={task.status} size="sm" />
              )}
              {workSteps.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {completedCount}/{workSteps.length} steps
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            {/* Stop recurrence — admin only */}
            {isAdmin && task.recurrence_type && task.recurrence_type !== 'once' && onStopRecurrence && (
              <Tooltip label="Stop recurrence — this task will no longer repeat">
              <button
                onClick={() => void handleStopRecurrence()}
                disabled={stoppingRec}
                aria-label="Stop recurrence"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                {stoppingRec ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Stop Repeat
              </button>
              </Tooltip>
            )}
            {/* Set recurrence — admin only, shown when task currently has no recurrence */}
            {isAdmin && (!task.recurrence_type || task.recurrence_type === 'once') && (
              <Tooltip label="Set a recurrence — this task will repeat on the chosen schedule">
                <select
                  value=""
                  onChange={e => void handleSetRecurrence(e.target.value)}
                  disabled={updatingTask}
                  aria-label="Set recurrence"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <option value="" disabled>↻ Set recurrence…</option>
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-weekly (fortnightly)</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                  <option value="custom">Custom interval…</option>
                </select>
              </Tooltip>
            )}
            <select
              value={task.status}
              onChange={e => handleTaskStatus(e.target.value as TaskStatus)}
              disabled={updatingTask}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              {TASK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {workSteps.length > 0 && (
          <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-xs text-gray-400 tabular-nums w-10 text-right">{progressPct}%</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 flex-shrink-0 items-center">
          {([['workflow', 'Workflow'], ['time', 'Time'], ['details', 'Details']] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
          {/* Edit workflow — admin only, on Workflow tab. Disabled until the
              full step config has hydrated, so the editor never opens with the
              trimmed list payload (which would risk wiping step config on save). */}
          {isAdmin && activeTab === 'workflow' && (
            <Tooltip label={stepsTrimmed ? 'Loading workflow…' : 'Edit this task’s workflow'} className="ml-auto">
              <button
                onClick={() => setShowWorkflowEditor(true)}
                disabled={stepsTrimmed}
                aria-label="Edit workflow"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg my-1.5 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {stepsTrimmed ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />} Edit workflow
              </button>
            </Tooltip>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {activeTab === 'workflow' && (
            <>
              {/* Flowchart */}
              <div className="flex-1 min-w-0" style={{ height: '100%' }}>
                {steps.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400">
                    <p className="text-sm">No steps defined for this task.</p>
                  </div>
                ) : (
                  <TaskViewFlowChart
                    steps={steps}
                    edges={edges}
                    selectedStepId={selectedStepId}
                    nextStepId={nextStep?.id ?? null}
                    onStepClick={setSelectedStepId}
                    onStepStatusChange={handleStepStatus}
                  />
                )}
              </div>

              {/* Step detail sidebar */}
              <div className="w-72 border-l border-gray-200 flex flex-col overflow-hidden flex-shrink-0">
                {selectedStep ? (
                  <div className="p-4 overflow-y-auto flex-1">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-sm text-gray-900">Step Detail</h4>
                      <button onClick={() => setSelectedStepId(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <p className="text-sm font-medium text-gray-800 mb-1">{selectedStep.title}</p>
                    {selectedStep.description && <p className="text-xs text-gray-500 mb-3">{selectedStep.description}</p>}

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Status</p>
                        <select
                          value={selectedStep.status}
                          onChange={e => handleStepStatus(selectedStep.id, e.target.value as StepStatus)}
                          disabled={updatingStep === selectedStep.id}
                          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                        >
                          {STEP_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      {selectedStep.assignee && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Assignee</p>
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-indigo-600 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-white">
                                {(selectedStep.assignee.full_name ?? selectedStep.assignee.email).charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm text-gray-700">{selectedStep.assignee.full_name ?? selectedStep.assignee.email}</span>
                          </div>
                        </div>
                      )}

                      {selectedStep.is_client_step && (
                        <div className="flex items-center gap-2 bg-amber-50 rounded px-2 py-1.5">
                          <User className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-xs text-amber-700 font-medium">Client Step</span>
                        </div>
                      )}

                      {selectedStep.tool_module_id && (() => {
                        const mod = MODULES.find(m => m.id === selectedStep.tool_module_id);
                        return (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Tool</p>
                            {mod ? (
                              <div className="flex items-center gap-2 bg-indigo-50 rounded px-2 py-1.5">
                                <Puzzle className="h-3.5 w-3.5 text-indigo-600" />
                                <span className="text-xs text-indigo-700 font-medium">{mod.name}</span>
                                {mod.route && (
                                  <Tooltip label="Open tool" className="ml-auto">
                                    <a href={mod.route} aria-label="Open tool" className="text-indigo-600 hover:text-indigo-800">
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  </Tooltip>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5 text-gray-400">
                                <AlertCircle className="h-3.5 w-3.5" />
                                <span className="text-xs">Tool no longer available</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {selectedStep.due_date && (
                        <div>
                          <p className="text-xs text-gray-400 mb-0.5">Due</p>
                          <p className="text-sm text-gray-700">{formatDate(selectedStep.due_date)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="px-4 pt-3 pb-2.5 border-b border-gray-100 flex-shrink-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Steps</p>
                          <p className="text-xs text-gray-400 mt-0.5">{completedCount} of {workSteps.length} done</p>
                        </div>
                        {isAdmin && workSteps.filter(s => !s.is_client_step).length > 0 && (
                          reassignMode ? (
                            <button onClick={exitReassign} className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-2 py-1 rounded-lg transition-colors">
                              Cancel
                            </button>
                          ) : (
                            <button
                              onClick={() => setReassignMode(true)}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 border border-gray-200 px-2 py-1 rounded-lg hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                            >
                              <Users className="h-3 w-3" /> Reassign
                            </button>
                          )
                        )}
                      </div>
                      {/* Reassign: select-all row */}
                      {isAdmin && reassignMode && (() => {
                        const reassignable = workSteps.filter(s => !s.is_client_step);
                        const allSel = reassignable.length > 0 && reassignable.every(s => selectedStepIds.has(s.id));
                        const someSel = selectedStepIds.size > 0 && !allSel;
                        return (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-indigo-100">
                            <button
                              onClick={() => allSel
                                ? setSelectedStepIds(new Set())
                                : setSelectedStepIds(new Set(reassignable.map(s => s.id)))}
                              className={`flex-shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                                ${allSel ? 'bg-indigo-500 border-indigo-500' : someSel ? 'bg-indigo-200 border-indigo-400' : 'border-gray-300 hover:border-indigo-400 bg-white'}`}
                            >
                              {allSel && <svg className="h-2.5 w-2.5 text-[var(--text-primary)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                              {someSel && !allSel && <div className="w-2 h-0.5 bg-indigo-600 rounded" />}
                            </button>
                            <span className="text-xs text-indigo-600">
                              {selectedStepIds.size > 0 ? `${selectedStepIds.size} selected` : 'Select steps'}
                            </span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Step list */}
                    <div className="flex-1 overflow-y-auto py-2 min-h-0">
                      {workSteps.map((s, idx) => {
                        const isDone     = s.status === 'complete' || s.status === 'skipped';
                        const isProgress = s.status === 'in_progress';
                        const isWaiting  = s.status === 'waiting_on_client';
                        const isUpdating = updatingStep === s.id || (s.step_type === 'end' && updatingTask);
                        const isNextUp   = s.id === nextStep?.id;
                        const isEndStep  = s.step_type === 'end';

                        const rowBg = isDone     ? 'bg-green-50/60'
                                    : isProgress ? 'bg-indigo-50/40'
                                    : isWaiting  ? 'bg-amber-50/40'
                                    : isEndStep  ? 'bg-indigo-50/30'
                                    : '';

                        const isCustom = !s.template_step_id && task.template_id;
                        const isDragging = draggingStepId === s.id;
                        const isDragOver = dragOverStepId === s.id && draggingStepId !== s.id;
                        return (
                          <div
                            key={s.id}
                            draggable={isAdmin && !reassignMode && !isEndStep}
                            onDragStart={e => handleStepDragStart(e, s.id)}
                            onDragOver={e => handleStepDragOver(e, s.id)}
                            onDrop={() => handleStepDrop(s.id)}
                            onDragEnd={() => { setDraggingStepId(null); setDragOverStepId(null); }}
                            className={`group flex items-start gap-2.5 px-4 py-2.5 transition-colors
                              ${isDone ? 'bg-green-50/60' : selectedStepIds.has(s.id) ? 'bg-indigo-50/60' : isProgress ? 'bg-indigo-50/40' : isWaiting ? 'bg-amber-50/40' : isEndStep ? 'bg-indigo-50/30' : 'hover:bg-gray-50'}
                              ${selectedStepIds.has(s.id) ? 'border-l-2 border-indigo-500' : isNextUp ? 'border-l-2 border-indigo-400' : 'border-l-2 border-transparent'}
                              ${isDragging ? 'opacity-50' : ''}
                              ${isDragOver ? 'ring-2 ring-indigo-300 ring-inset' : ''}`}
                          >
                            {/* Drag handle — admin only, not on end step */}
                            {isAdmin && !reassignMode && !isEndStep && (
                              <Tooltip label="Drag to reorder">
                                <span className="mt-1 flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <GripVertical className="h-3.5 w-3.5" />
                                </span>
                              </Tooltip>
                            )}
                            {/* Reassign checkbox */}
                            {reassignMode && (
                              <button
                                onClick={() => !s.is_client_step && toggleStep(s.id)}
                                disabled={s.is_client_step}
                                className={`flex-shrink-0 mt-0.5 h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                                  ${selectedStepIds.has(s.id) ? 'bg-indigo-500 border-indigo-500' : s.is_client_step ? 'border-gray-200 opacity-25 cursor-default bg-white' : 'border-gray-300 hover:border-indigo-400 cursor-pointer bg-white'}`}
                              >
                                {selectedStepIds.has(s.id) && <svg className="h-2.5 w-2.5 text-[var(--text-primary)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                              </button>
                            )}

                            {/* Complete checkbox */}
                            <Tooltip label={isEndStep && !isDone ? 'Complete task — marks all steps done' : isDone ? 'Mark as not started' : 'Mark as complete'} className="mt-0.5 flex-shrink-0">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                if (isEndStep && !isDone) handleCompleteAll();
                                else handleStepStatus(s.id, isDone ? 'not_started' : 'complete');
                              }}
                              disabled={isUpdating || reassignMode}
                              aria-label="Toggle step complete"
                              className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all
                                ${isDone ? 'bg-green-500 border-green-500' : isEndStep ? 'border-indigo-400 bg-white group-hover:bg-indigo-50' : 'border-gray-300 bg-white group-hover:border-indigo-400'}
                                ${isUpdating ? 'opacity-50 cursor-wait' : reassignMode ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              {isUpdating ? (
                                <Loader2 className="h-3 w-3 text-[var(--text-primary)] animate-spin" />
                              ) : isDone ? (
                                <svg className="h-3 w-3 text-[var(--text-primary)]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="2,6 5,9 10,3" />
                                </svg>
                              ) : null}
                            </button>
                            </Tooltip>

                            {/* Step info + comments */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                {/* Step number + title — click opens detail */}
                                <button onClick={() => !reassignMode && setSelectedStepId(s.id)} className="flex-1 text-left min-w-0">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-[10px] font-semibold text-gray-300 tabular-nums flex-shrink-0">
                                      {String(idx + 1).padStart(2, '0')}
                                    </span>
                                    <span className={`text-sm font-medium leading-snug ${isDone ? 'line-through text-gray-400' : isEndStep ? 'text-indigo-700' : 'text-gray-800'}`}>
                                      {s.title}
                                    </span>
                                  </div>
                                  {isEndStep && !isDone && (
                                    <p className="text-[10px] text-indigo-400 mt-0.5 ml-6">Ticking this completes all steps &amp; closes the task</p>
                                  )}
                                </button>

                                {/* Assignee: clickable picker for admin (non-reassign mode), static otherwise */}
                                {isAdmin && !s.is_client_step && !reassignMode ? (
                                  <AssigneePicker
                                    current={s.assignee ?? null}
                                    teamMembers={teamMembers}
                                    onSelect={mid => void handleInlineAssign(s.id, mid)}
                                    disabled={isUpdating}
                                    size="sm"
                                  />
                                ) : s.assignee ? (
                                  <Tooltip label={s.assignee.full_name ?? s.assignee.email} side="top" className="flex-shrink-0">
                                    <div
                                      className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white ${avatarColour(s.assignee.id)}`}
                                    >
                                      {initials(s.assignee.full_name, s.assignee.email)}
                                    </div>
                                  </Tooltip>
                                ) : null}
                              </div>

                              {/* Status row */}
                              {!reassignMode && (
                                <div className="flex items-center gap-2 mt-1 flex-wrap ml-6">
                                  {!isDone && (
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                      isProgress ? 'bg-indigo-100 text-indigo-600' : isWaiting ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'
                                    }`}>
                                      {isProgress ? 'In Progress' : isWaiting ? 'Waiting' : 'Not Started'}
                                    </span>
                                  )}
                                  {isNextUp && !isProgress && !isWaiting && !isDone && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500 text-white">Next up</span>
                                  )}
                                  {s.tool_module_id && (
                                    <span className="text-[10px] font-medium text-indigo-400 flex items-center gap-0.5">
                                      <Puzzle className="h-3 w-3" />Tool
                                    </span>
                                  )}
                                  {s.is_client_step && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-medium">Client</span>
                                  )}
                                  {isCustom && (
                                    <Tooltip label="Custom step — only on this client's task, not on the template">
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium inline-flex items-center gap-0.5">
                                        <Sparkles className="h-2.5 w-2.5" /> Custom
                                      </span>
                                    </Tooltip>
                                  )}
                                  {/* Delete — admin only, not on end step */}
                                  {isAdmin && !isEndStep && !reassignMode && (
                                    <Tooltip label="Delete this step from this task only">
                                      <button
                                        onClick={e => { e.stopPropagation(); void handleDeleteStep(s.id); }}
                                        disabled={deletingStepId === s.id}
                                        aria-label="Delete step"
                                        className="ml-auto p-1 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        {deletingStepId === s.id
                                          ? <Loader2 className="h-3 w-3 animate-spin" />
                                          : <Trash2 className="h-3 w-3" />}
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>
                              )}

                              {/* Comments */}
                              {!reassignMode && (
                                <div className="mt-2">
                                  <StepComments taskId={task.id} stepId={s.id} currentUserId={currentUserId} compact />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* + Add custom step — admin only, hidden during reassign mode */}
                      {isAdmin && !reassignMode && (
                        <div className="px-4 py-2 border-t border-gray-100 mt-1">
                          {addingStep ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                autoFocus
                                value={newStepTitle}
                                onChange={e => setNewStepTitle(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); void handleAddStep(); }
                                  if (e.key === 'Escape') { setAddingStep(false); setNewStepTitle(''); }
                                }}
                                placeholder="New step title…"
                                disabled={submittingNewStep}
                                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <button
                                onClick={() => void handleAddStep()}
                                disabled={!newStepTitle.trim() || submittingNewStep}
                                className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {submittingNewStep ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                              </button>
                              <button
                                onClick={() => { setAddingStep(false); setNewStepTitle(''); }}
                                disabled={submittingNewStep}
                                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAddingStep(true)}
                              className="inline-flex items-center gap-1.5 text-xs text-indigo-600 font-medium hover:text-indigo-700 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors"
                            >
                              <Plus className="h-3 w-3" /> Add custom step
                            </button>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1">
                            Custom steps stay on this client&apos;s task and recur with future cycles, but won&apos;t be added to the template.
                          </p>
                        </div>
                      )}
                      {reordering && (
                        <div className="px-4 py-1 text-[11px] text-gray-400 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Saving order…
                        </div>
                      )}
                    </div>

                    {/* Batch reassign bar */}
                    {isAdmin && reassignMode && selectedStepIds.size > 0 && (
                      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-indigo-600 border-t border-indigo-500">
                        <UserCheck className="h-4 w-4 text-indigo-200 flex-shrink-0" />
                        <span className="text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap">
                          {selectedStepIds.size} step{selectedStepIds.size !== 1 ? 's' : ''}
                        </span>
                        <select
                          value={batchTarget}
                          onChange={e => setBatchTarget(e.target.value)}
                          className="flex-1 text-xs rounded-lg px-2 py-1.5 border-0 bg-indigo-500 text-white focus:outline-none focus:ring-1 focus:ring-white/40 min-w-0"
                        >
                          <option value="" disabled>Choose person…</option>
                          <option value="__unassigned__">— Unassign —</option>
                          {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                        </select>
                        <button
                          onClick={() => void handleApplyBatch()}
                          disabled={!batchTarget || applying}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-white text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-50 disabled:opacity-40 transition-colors flex-shrink-0"
                        >
                          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Apply
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'time' && (
            <div className="flex-1 overflow-y-auto p-6">
              <TimeTracker
                task={task}
                steps={workSteps}
                onLogTime={entry => onLogTime(task.id, entry)}
              />
            </div>
          )}

          {activeTab === 'details' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Status</p>
                  <TaskStatusBadge status={task.status} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Client</p>
                  <p className="text-sm text-gray-700">{task.client?.name ?? 'Internal'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Due Date</p>
                  <p className="text-sm text-gray-700">{formatDate(task.due_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Created By</p>
                  <p className="text-sm text-gray-700">{task.created_by_user?.full_name ?? task.created_by_user?.email ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Recurrence</p>
                  <p className="text-sm text-gray-700 capitalize">{task.recurrence_type ?? 'None'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Created</p>
                  <p className="text-sm text-gray-700">{formatDate(task.created_at)}</p>
                </div>
              </div>

              {task.description && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Description</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.description}</p>
                </div>
              )}

              <div className="pt-4 border-t border-gray-100">
                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" /> Delete Task
                  </button>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-700 mb-3">Delete this task? This cannot be undone.</p>
                    <div className="flex gap-2">
                      <button onClick={() => onDelete(task.id)} className="bg-red-500 text-white text-sm px-3 py-1.5 rounded hover:bg-red-600">Delete</button>
                      <button onClick={() => setShowDeleteConfirm(false)} className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Workflow editor — admin only */}
    {showWorkflowEditor && (
      <TemplateBuilder
        template={null}
        initialData={{
          name: task.title,
          description: task.description ?? null,
          is_firm_wide: true,
          category: 'general',
          recurrence_type: null,
          recurrence_interval_days: null,
          steps: (task.steps ?? []).map(s => ({
            step_key: s.step_key,
            title: s.title,
            description: s.description ?? null,
            assignee_role: s.is_client_step ? 'client' : 'team_member',
            default_assignee_id: s.assignee_id ?? null,
            tool_module_id: s.tool_module_id ?? null,
            email_reminder_enabled: s.email_reminder_enabled ?? false,
            email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
            email_reminder_subject: null,
            email_reminder_message: null,
            client_instructions: s.client_instructions ?? null,
            client_can_upload: s.client_can_upload ?? false,
            time_estimate_minutes: null,
            position_x: s.position_x ?? 200,
            position_y: s.position_y ?? 0,
            step_type: (s.step_type as 'regular' | 'start' | 'end') ?? 'regular',
            start_trigger_config: null,
            end_config: null,
          })),
          edges: (task.edges ?? []).map(e => ({
            from_step_key: e.from_step_key,
            to_step_key:   e.to_step_key,
            label:         e.label ?? null,
            condition_type: e.condition_type ?? null,
            condition_config: e.condition_config ?? null,
            source_handle: e.source_handle ?? null,
            target_handle: e.target_handle ?? null,
          })),
        }}
        teamMembers={teamMembers}
        existingTemplates={[]}
        onSave={async () => { /* not used in edit-task mode */ }}
        onEditTask={async (steps, edges) => {
          const r = await fetch(`/api/tasks/${task.id}/workflow`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steps, edges }),
          });
          if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            throw new Error(data.error ?? 'Failed to save workflow');
          }
          await onTaskRefetch?.(task.id);
        }}
        mode="edit-task"
        editTaskClientName={task.client?.name ?? undefined}
        onClose={() => setShowWorkflowEditor(false)}
      />
    )}
    </>
  );
}
