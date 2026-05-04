'use client';

import { useState, useCallback } from 'react';
import {
  X, Calendar, Clock, RefreshCw, User, ChevronDown, CheckCircle2,
  Play, Pause, Plus, Trash2, ExternalLink, Loader2, AlertCircle, Puzzle,
} from 'lucide-react';
import { TaskStatusBadge, StepStatusBadge } from './TaskStatusBadge';
import { TaskViewFlowChart } from './TaskFlowChart';
import { MODULES } from '@/config/modules.config';
import type { Task, TaskStatus, StepStatus, TaskStep } from '@/types';

interface Props {
  task: Task;
  currentUserId: string;
  onClose: () => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onStepUpdate: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onLogTime: (taskId: string, entry: { step_id?: string; started_at: string; ended_at: string; notes?: string }) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
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
        started_at: startedAt.toISOString(),
        ended_at: ended.toISOString(),
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
        started_at: started.toISOString(),
        ended_at: now.toISOString(),
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

export default function TaskDetailPanel({ task, currentUserId, onClose, onUpdate, onStepUpdate, onLogTime, onDelete }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('workflow');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [updatingStep, setUpdatingStep] = useState<string | null>(null);
  const [updatingTask, setUpdatingTask] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const steps = task.steps ?? [];
  const edges = task.edges ?? [];
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

  const completedCount = steps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-5xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 truncate">{task.title}</h2>
              {task.recurrence_type && task.recurrence_type !== 'once' && (
                <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  <RefreshCw className="h-3 w-3" /> {task.recurrence_type}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {task.client ? (
                <span className="text-sm text-gray-600 font-medium">{task.client.name}</span>
              ) : (
                <span className="text-sm text-gray-400 italic">Internal</span>
              )}
              {task.due_date && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Calendar className="h-3.5 w-3.5" />
                  Due {formatDate(task.due_date)}
                </span>
              )}
              {steps.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {completedCount}/{steps.length} steps
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
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
        {steps.length > 0 && (
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
        <div className="flex border-b border-gray-200 px-6 flex-shrink-0">
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
                    onStepClick={setSelectedStepId}
                    onStepStatusChange={handleStepStatus}
                  />
                )}
              </div>

              {/* Step detail sidebar */}
              <div className="w-72 border-l border-gray-200 overflow-y-auto flex-shrink-0">
                {selectedStep ? (
                  <div className="p-4">
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
                                  <a href={mod.route} className="ml-auto text-indigo-600 hover:text-indigo-800" title="Open tool">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
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
                  <div className="p-4">
                    <p className="text-xs text-gray-400 mb-3">Click any step in the chart to view and update it.</p>
                    <div className="space-y-1.5">
                      {steps.map(s => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedStepId(s.id)}
                          className="w-full flex items-center justify-between rounded px-2 py-2 hover:bg-gray-50 text-left transition-colors"
                        >
                          <span className="text-sm text-gray-700 truncate mr-2">{s.title}</span>
                          <StepStatusBadge status={s.status} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'time' && (
            <div className="flex-1 overflow-y-auto p-6">
              <TimeTracker
                task={task}
                steps={steps}
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
  );
}
