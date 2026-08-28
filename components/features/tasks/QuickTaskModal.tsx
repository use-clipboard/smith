'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronUp, Loader2, Zap, RefreshCw } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import type { RecurrenceType } from '@/types';
import type { CreateTaskData } from './CreateTaskModal';
import { useModules } from '@/components/ui/ModulesProvider';
import { CH_DEADLINE_LABELS, CH_DEADLINE_TYPES, fetchClientChDeadlines, scanClientChDeadlines, formatDeadlineDate, type ChDeadlineType, type ClientChDeadlines } from './chDeadlines';

// Local helper type so the state declaration below stays readable rather
// than carrying a five-arm union inline.
type ChDeadlineSelection = '' | ChDeadlineType;
type ChDeadlineFilled    = ChDeadlineType;

interface TeamMember { id: string; full_name: string | null; email: string }

interface Props {
  onClose: () => void;
  onCreate: (data: CreateTaskData) => Promise<void>;
  teamMembers: TeamMember[];
  /** Pre-populate client from a client context (e.g. client detail page) */
  defaultClientId?: string;
  defaultClientName?: string;
  /** AI-suggested values (e.g. from email content) — all overridable by the user */
  defaultTitle?: string;
  defaultSteps?: string[];
  defaultDueDate?: string;
  /** Optional outputs.id link — when present, the created task gets
   *  source_output_id set so the source view can show a "task already
   *  exists" marker. */
  sourceOutputId?: string;
}

const RECURRENCE_OPTIONS: { value: RecurrenceType | ''; label: string }[] = [
  { value: '', label: 'No recurrence (one-off)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly (fortnightly)' },
  { value: 'four-weekly', label: 'Four-weekly (every 28 days)' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'custom', label: 'Custom interval…' },
];

export default function QuickTaskModal({ onClose, onCreate, teamMembers, defaultClientId, defaultClientName, defaultTitle, defaultSteps, defaultDueDate, sourceOutputId }: Props) {
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [isInternal, setIsInternal] = useState(false);
  const [dueDate, setDueDate] = useState(defaultDueDate ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [steps, setSteps] = useState<string[]>(defaultSteps?.length ? defaultSteps : ['']);
  const [showRepeat, setShowRepeat] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceType | ''>('');
  const [customInterval, setCustomInterval] = useState('');
  // CH-deadline linking — when chDeadlineType is non-empty the task gets
  // an auto-link at creation time; the manual due-date + recurrence inputs
  // are disabled because the CH deadline dictates both.
  const [chDeadlineType, setChDeadlineType] = useState<ChDeadlineSelection>('');
  const [chOffsetDays, setChOffsetDays] = useState<number>(0);
  const isChLinked = chDeadlineType !== '';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // CH-deadline linking is only offered when the firm has the CH Secretarial
  // module AND the chosen client is an eligible Ltd/LLP with a CH number.
  const { isModuleActive } = useModules();
  const chModuleActive = isModuleActive('ch-secretarial');
  const [chInfo, setChInfo] = useState<ClientChDeadlines | null>(null);
  const chEligible = chModuleActive && !isInternal && !!clientId && !!chInfo?.eligible;
  // On-demand CH scan for clients not yet in the CH Secretarial cache.
  const [chScanning, setChScanning] = useState(false);
  const [chScanError, setChScanError] = useState<string | null>(null);
  const chHasNoDates = !!chInfo && CH_DEADLINE_TYPES.every(dt => !chInfo.deadlines[dt]);
  async function runChScan() {
    if (!clientId) return;
    setChScanning(true); setChScanError(null);
    const res = await scanClientChDeadlines(clientId);
    if (res.ok && res.deadlines) setChInfo(prev => (prev ? { ...prev, deadlines: res.deadlines! } : prev));
    else setChScanError(res.error ?? 'Scan failed.');
    setChScanning(false);
  }

  useEffect(() => {
    if (!chModuleActive || isInternal || !clientId) { setChInfo(null); return; }
    let cancelled = false;
    fetchClientChDeadlines(clientId).then(info => { if (!cancelled) setChInfo(info); });
    return () => { cancelled = true; };
  }, [clientId, isInternal, chModuleActive]);

  // Drop back to manual cadence if the client stops being CH-eligible while a
  // CH deadline was selected.
  useEffect(() => {
    if (isChLinked && !chEligible) setChDeadlineType('');
  }, [isChLinked, chEligible]);

  function addStep() {
    setSteps(prev => [...prev, '']);
  }

  function updateStep(idx: number, val: string) {
    setSteps(prev => prev.map((s, i) => i === idx ? val : s));
  }

  function removeStep(idx: number) {
    setSteps(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleCreate() {
    if (!title.trim()) { setError('Please enter a task title.'); return; }
    const filledSteps = steps.map(s => s.trim()).filter(Boolean);
    setSaving(true);
    setError('');
    try {
      const stepInputs = filledSteps.map((s, i) => ({
        step_key: `step_${i + 1}`,
        title: s,
        description: null,
        assignee_id: assigneeId || null,
        is_client_step: false,
        tool_module_id: null,
        email_reminder_enabled: false,
        email_reminder_config: { recipients: [] as string[], timing: 'on_assign' as const },
        position_x: 400,
        position_y: 150 + i * 130,
      }));

      await onCreate({
        title: title.trim(),
        client_id: isInternal ? null : (clientId || null),
        // CH-linked tasks get their due_date from the CH deadline +
        // offset, applied server-side. We don't send a manual due_date
        // in that mode so a stale UI value can't sneak through.
        due_date: isChLinked ? null : (dueDate || null),
        is_internal: isInternal || !clientId,
        // Same story for recurrence — CH dictates cadence, manual fields
        // are ignored. Send null to be explicit.
        recurrence_type: isChLinked ? null : ((recurrence as RecurrenceType) || null),
        recurrence_interval_days: isChLinked ? null : (recurrence === 'custom' && customInterval ? parseInt(customInterval) : null),
        ch_deadline_type: isChLinked ? chDeadlineType : null,
        ch_offset_days:   isChLinked ? chOffsetDays : 0,
        source_output_id: sourceOutputId ?? null,
        steps: stepInputs,
        edges: [],
      });
      onClose();
    } catch {
      setError('Failed to create task. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="h-9 w-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <Zap className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900">Quick Task</h2>
            <p className="text-xs text-gray-400">Simple checklist task — all in one screen</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Task title <span className="text-red-500">*</span>
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder="e.g. Review Q1 bank statement"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          {/* Client */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Client</label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setIsInternal(false)}
                className={`flex-1 text-sm py-2 rounded-lg border-2 font-medium transition-colors ${!isInternal ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                Client task
              </button>
              <button
                onClick={() => { setIsInternal(true); setClientId(''); }}
                className={`flex-1 text-sm py-2 rounded-lg border-2 font-medium transition-colors ${isInternal ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                Internal
              </button>
            </div>
            {!isInternal && (
              <ClientSearchInput
                value={clientId}
                valueName={clientId === (defaultClientId ?? '') ? (defaultClientName ?? '') : undefined}
                onChange={(id) => setClientId(id)}
                placeholder="Search for a client…"
                className="w-full"
              />
            )}
          </div>

          {/* Due date + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Due date
                {isChLinked && (
                  <span className="ml-1.5 text-[10px] font-medium text-[var(--accent)] uppercase tracking-wide">
                    · set by CH
                  </span>
                )}
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                disabled={isChLinked}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Assign to</label>
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Unassigned</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Steps checklist */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Steps <span className="text-xs font-normal text-gray-400 ml-1">optional</span>
            </label>
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border-2 border-gray-300 flex-shrink-0" />
                  <input
                    value={s}
                    onChange={e => updateStep(idx, e.target.value)}
                    placeholder={`Step ${idx + 1}…`}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addStep(); }
                    }}
                  />
                  {steps.length > 1 && (
                    <button
                      onClick={() => removeStep(idx)}
                      className="p-1.5 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addStep}
              className="mt-2.5 flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              <Plus className="h-4 w-4" /> Add step
            </button>
          </div>

          {/* Repeat / renewal source section */}
          <div className="border-t border-gray-100 pt-4">
            <button
              onClick={() => setShowRepeat(v => !v)}
              className="w-full flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              <RefreshCw className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">
                Repeat this task?
                {isChLinked && <span className="ml-1.5 text-[var(--accent)]">· linked to CH deadline</span>}
              </span>
              {showRepeat
                ? <ChevronUp className="h-4 w-4" />
                : <ChevronDown className="h-4 w-4" />
              }
            </button>

            {showRepeat && (
              <div className="mt-3 space-y-3 pl-6">
                {/* Renewal source toggle — Manual vs CH deadline. Hidden when
                    the user picked "Internal" task since CH links need a
                    client to follow. */}
                {chEligible && (
                  <select
                    value={isChLinked ? 'ch' : 'manual'}
                    onChange={e => {
                      if (e.target.value === 'manual') setChDeadlineType('');
                      else setChDeadlineType('accounts_due');
                    }}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="manual">Manual cadence</option>
                    <option value="ch">CH deadline-linked (auto-renew via Companies House)</option>
                  </select>
                )}
                {isChLinked ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={runChScan}
                        disabled={chScanning}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        {chScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {chScanning ? 'Scanning…' : chHasNoDates ? 'Scan this client now' : 'Re-scan from Companies House'}
                      </button>
                      {chScanError
                        ? <span className="text-[11px] text-red-600">{chScanError}</span>
                        : chHasNoDates && !chScanning && <span className="text-[11px] text-indigo-600">No dates cached yet — scan to fetch them.</span>}
                    </div>
                    <select
                      value={chDeadlineType}
                      onChange={e => setChDeadlineType(e.target.value as ChDeadlineFilled)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {CH_DEADLINE_TYPES.map(dt => (
                        <option key={dt} value={dt}>
                          {CH_DEADLINE_LABELS[dt]} — {formatDeadlineDate(chInfo?.deadlines[dt])}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">Offset</span>
                      <input
                        type="number"
                        step={1}
                        value={chOffsetDays}
                        onChange={e => setChOffsetDays(Number.isFinite(parseInt(e.target.value, 10)) ? parseInt(e.target.value, 10) : 0)}
                        className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-gray-500">days (negative = before)</span>
                    </div>
                    <p className="text-[11px] text-gray-500 italic">
                      Due date is dictated by the chosen CH deadline + offset. The task auto-renews each cycle.
                    </p>
                  </>
                ) : (
                <select
                  value={recurrence}
                  onChange={e => setRecurrence(e.target.value as RecurrenceType | '')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {RECURRENCE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                )}
                {/* Keep the existing custom-interval input below only in manual mode */}
                {!isChLinked && (
                <>
                {recurrence === 'custom' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Every</span>
                    <input
                      type="number"
                      min="1"
                      value={customInterval}
                      onChange={e => setCustomInterval(e.target.value)}
                      className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-500">days</span>
                  </div>
                )}
                {recurrence && (
                  <p className="text-xs text-gray-400">
                    For more control over recurring tasks (custom assignees per recurrence, conditional steps), use a Full Task instead.
                  </p>
                )}
                </>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-gray-50">
          <div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Task
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
