'use client';

import { useState } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronUp, Loader2, Zap, RefreshCw } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import type { RecurrenceType } from '@/types';
import type { CreateTaskData } from './CreateTaskModal';

interface TeamMember { id: string; full_name: string | null; email: string }

interface Props {
  onClose: () => void;
  onCreate: (data: CreateTaskData) => Promise<void>;
  teamMembers: TeamMember[];
}

const RECURRENCE_OPTIONS: { value: RecurrenceType | ''; label: string }[] = [
  { value: '', label: 'No recurrence (one-off)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly (fortnightly)' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'custom', label: 'Custom interval…' },
];

export default function QuickTaskModal({ onClose, onCreate, teamMembers }: Props) {
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [showRepeat, setShowRepeat] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceType | ''>('');
  const [customInterval, setCustomInterval] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
        due_date: dueDate || null,
        is_internal: isInternal || !clientId,
        recurrence_type: (recurrence as RecurrenceType) || null,
        recurrence_interval_days: recurrence === 'custom' && customInterval ? parseInt(customInterval) : null,
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
                onChange={(id) => setClientId(id)}
                placeholder="Search for a client…"
                className="w-full"
              />
            )}
          </div>

          {/* Due date + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

          {/* Repeat section — less prominent, collapsible */}
          <div className="border-t border-gray-100 pt-4">
            <button
              onClick={() => setShowRepeat(v => !v)}
              className="w-full flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              <RefreshCw className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">Repeat this task?</span>
              {showRepeat
                ? <ChevronUp className="h-4 w-4" />
                : <ChevronDown className="h-4 w-4" />
              }
            </button>

            {showRepeat && (
              <div className="mt-3 space-y-3 pl-6">
                <select
                  value={recurrence}
                  onChange={e => setRecurrence(e.target.value as RecurrenceType | '')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {RECURRENCE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
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
                {recurrence && recurrence !== '' && (
                  <p className="text-xs text-gray-400">
                    For more control over recurring tasks (custom assignees per recurrence, conditional steps), use a Full Task instead.
                  </p>
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
