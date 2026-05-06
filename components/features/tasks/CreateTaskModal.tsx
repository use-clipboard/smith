'use client';

import { useState, useMemo } from 'react';
import { X, ChevronRight, ChevronLeft, Loader2, RefreshCw, Search } from 'lucide-react';
import { TaskViewFlowChart } from './TaskFlowChart';
import { DEFAULT_TASK_TEMPLATES, TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { TaskTemplate, TaskStep, TaskStepEdge, Task, RecurrenceType, DefaultTemplate, EdgeConditionType } from '@/types';

interface Props {
  onClose: () => void;
  onCreate: (data: CreateTaskData) => Promise<void>;
  clients: { id: string; name: string; client_ref: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  firmTemplates: TaskTemplate[];
}

export interface CreateTaskData {
  title: string;
  description?: string;
  client_id?: string | null;
  template_id?: string | null;
  due_date?: string | null;
  is_internal: boolean;
  recurrence_type?: RecurrenceType | null;
  recurrence_interval_days?: number | null;
  steps: StepInput[];
  edges: EdgeInput[];
}

interface StepInput {
  step_key: string;
  title: string;
  description?: string | null;
  assignee_id?: string | null;
  is_client_step: boolean;
  tool_module_id?: string | null;
  email_reminder_enabled: boolean;
  email_reminder_config: { recipients: string[]; timing: string };
  position_x: number;
  position_y: number;
}

interface EdgeInput { from_step_key: string; to_step_key: string; label?: string | null; condition_type?: string | null; source_handle?: string | null; target_handle?: string | null }

type Step = 'template' | 'details' | 'assignees' | 'preview';

const RECURRENCE_OPTIONS: { value: RecurrenceType | ''; label: string }[] = [
  { value: '', label: 'One-off (no recurrence)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly (fortnightly)' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'custom', label: 'Custom interval' },
];

export default function CreateTaskModal({ onClose, onCreate, clients, teamMembers, firmTemplates }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [selectedDefault, setSelectedDefault] = useState<DefaultTemplate | null>(null);
  const [selectedFirmTemplate, setSelectedFirmTemplate] = useState<TaskTemplate | null>(null);
  const [isBlank, setIsBlank] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  // Details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [recurrence, setRecurrence] = useState<RecurrenceType | ''>('');
  const [customInterval, setCustomInterval] = useState('');

  // Step assignees (map step_key → assignee_id)
  const [assigneeMap, setAssigneeMap] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const activeTemplate = selectedDefault ?? selectedFirmTemplate;

  const steps: StepInput[] = useMemo(() => {
    if (!activeTemplate) return [];
    const templateSteps = selectedDefault ? selectedDefault.steps : (selectedFirmTemplate?.steps ?? []);
    return templateSteps.map(s => ({
      step_key: s.step_key,
      title: s.title,
      description: 'description' in s ? (s.description ?? null) : null,
      assignee_id: assigneeMap[s.step_key] ?? null,
      is_client_step: s.assignee_role === 'client',
      tool_module_id: s.tool_module_id ?? null,
      email_reminder_enabled: s.email_reminder_enabled ?? false,
      email_reminder_config: (s.email_reminder_config as { recipients: string[]; timing: string } | undefined) ?? { recipients: [], timing: 'on_assign' },
      position_x: s.position_x,
      position_y: s.position_y,
    }));
  }, [activeTemplate, selectedDefault, selectedFirmTemplate, assigneeMap]);

  const edges: EdgeInput[] = useMemo(() => {
    if (!activeTemplate) return [];
    const templateEdges = selectedDefault ? selectedDefault.edges : (selectedFirmTemplate?.edges ?? []);
    return templateEdges.map(e => ({
      from_step_key: e.from_step_key,
      to_step_key: e.to_step_key,
      label: e.label ?? null,
      source_handle: 'source_handle' in e ? (e.source_handle as string | null) : null,
      target_handle: 'target_handle' in e ? (e.target_handle as string | null) : null,
    }));
  }, [activeTemplate, selectedDefault, selectedFirmTemplate]);

  // Preview flowchart data (fake task steps from template)
  const previewSteps: TaskStep[] = useMemo(() => steps.map(s => ({
    id: s.step_key,
    task_id: '',
    template_step_id: null,
    step_key: s.step_key,
    title: s.title,
    description: s.description ?? null,
    assignee_id: s.assignee_id ?? null,
    is_client_step: s.is_client_step,
    status: 'not_started' as const,
    tool_module_id: s.tool_module_id ?? null,
    tool_output_id: null,
    email_reminder_enabled: s.email_reminder_enabled,
    email_reminder_config: { recipients: [], timing: 'on_assign' as const },
    due_date: null,
    completed_at: null,
    position_x: s.position_x,
    position_y: s.position_y,
    email_reminder_subject: null,
    email_reminder_message: null,
    client_instructions: null,
    client_can_upload: false,
    created_at: '',
    updated_at: '',
    assignee: teamMembers.find(m => m.id === s.assignee_id) ?? null,
  })), [steps, teamMembers]);

  const previewEdges: TaskStepEdge[] = useMemo(() => edges.map((e, i) => ({
    id: `e-${i}`,
    task_id: '',
    from_step_key: e.from_step_key,
    to_step_key: e.to_step_key,
    label: e.label ?? null,
    condition_type: (e.condition_type ?? null) as EdgeConditionType | null,
    condition_config: null,
    source_handle: e.source_handle ?? null,
    target_handle: e.target_handle ?? null,
  })), [edges]);

  function handleSelectDefault(t: DefaultTemplate) {
    setSelectedDefault(t);
    setSelectedFirmTemplate(null);
    setIsBlank(false);
    if (!title) setTitle(t.name);
    if (!recurrence && t.recurrence_type) setRecurrence(t.recurrence_type);
  }

  function handleSelectFirm(t: TaskTemplate) {
    setSelectedFirmTemplate(t);
    setSelectedDefault(null);
    setIsBlank(false);
    if (!title) setTitle(t.name);
    if (!recurrence && t.recurrence_type) setRecurrence(t.recurrence_type as RecurrenceType);
  }

  function handleBlank() {
    setIsBlank(true);
    setSelectedDefault(null);
    setSelectedFirmTemplate(null);
  }

  async function handleCreate() {
    if (!title.trim()) { setError('Please enter a task title.'); return; }
    setSaving(true);
    setError('');
    try {
      await onCreate({
        title: title.trim(),
        description: description || undefined,
        client_id: isInternal ? null : (clientId || null),
        template_id: selectedFirmTemplate?.id ?? null,
        due_date: dueDate || null,
        is_internal: isInternal || !clientId,
        recurrence_type: recurrence as RecurrenceType || null,
        recurrence_interval_days: recurrence === 'custom' && customInterval ? parseInt(customInterval) : null,
        steps,
        edges,
      });
      onClose();
    } catch (e) {
      setError('Failed to create task. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const filteredDefaults = DEFAULT_TASK_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
    t.description.toLowerCase().includes(templateSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-4xl h-[88vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Create New Task</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center px-6 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 gap-1">
          {(['template', 'details', 'assignees', 'preview'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <span className={`text-xs font-medium px-3 py-1 rounded-full ${step === s ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}>
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
              {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 mx-1" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">

          {/* Step 1: Template selection */}
          {step === 'template' && (
            <div className="h-full overflow-y-auto p-6">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input placeholder="Search templates…" value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>

              {/* Blank option */}
              <div className="mb-6">
                <button
                  onClick={handleBlank}
                  className={`w-full text-left border-2 rounded-lg p-3 transition-all ${isBlank ? 'border-indigo-500 bg-indigo-50' : 'border-dashed border-gray-200 hover:border-gray-300'}`}
                >
                  <p className="text-sm font-semibold text-gray-700">Start from scratch</p>
                  <p className="text-xs text-gray-400">Create a blank task and add steps manually</p>
                </button>
              </div>

              {/* SMITH defaults */}
              {filteredDefaults.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">SMITH Built-in Templates</p>
                  <div className="grid grid-cols-2 gap-3">
                    {filteredDefaults.map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleSelectDefault(t)}
                        className={`text-left border-2 rounded-lg p-3 transition-all ${selectedDefault?.id === t.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                          {t.recurrence_type && <RefreshCw className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-gray-500 mb-2">{t.description}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}</span>
                          <span className="text-xs text-gray-400">{t.steps.length} steps</span>
                          {t.recurrence_type && <span className="text-xs text-indigo-600 capitalize">{t.recurrence_type}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Firm templates */}
              {firmTemplates.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Your Firm's Templates</p>
                  <div className="grid grid-cols-2 gap-3">
                    {firmTemplates
                      .filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                      .map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleSelectFirm(t)}
                          className={`text-left border-2 rounded-lg p-3 transition-all ${selectedFirmTemplate?.id === t.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                        >
                          <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                          {t.description && <p className="text-xs text-gray-500 mb-2">{t.description}</p>}
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">Firm template</span>
                            <span className="text-xs text-gray-400">{t.steps?.length ?? 0} steps</span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Details */}
          {step === 'details' && (
            <div className="h-full overflow-y-auto p-6 max-w-xl">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Task Title <span className="text-red-500">*</span></label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. VAT Return Q1 2025" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                  <div className="flex gap-2 mb-2">
                    <button onClick={() => setIsInternal(false)} className={`flex-1 text-sm py-2 rounded-lg border-2 font-medium ${!isInternal ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>Client task</button>
                    <button onClick={() => { setIsInternal(true); setClientId(''); }} className={`flex-1 text-sm py-2 rounded-lg border-2 font-medium ${isInternal ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>Internal</button>
                  </div>
                  {!isInternal && (
                    <select value={clientId} onChange={e => setClientId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                      <option value="">Select a client…</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.client_ref})</option>)}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recurrence</label>
                  <select value={recurrence} onChange={e => setRecurrence(e.target.value as RecurrenceType | '')} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                    {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {recurrence === 'custom' && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-sm text-gray-500">Every</span>
                      <input type="number" min="1" value={customInterval} onChange={e => setCustomInterval(e.target.value)} className="w-20 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      <span className="text-sm text-gray-500">days</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Assignees */}
          {step === 'assignees' && (
            <div className="h-full overflow-y-auto p-6">
              {steps.length === 0 ? (
                <p className="text-sm text-gray-500">No steps to assign. You can add steps after creating the task.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 mb-4">Assign team members to each step. Client steps will be sent to the client.</p>
                  {steps.map(s => (
                    <div key={s.step_key} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{s.title}</p>
                        {s.is_client_step && <span className="text-xs text-amber-600">Client step</span>}
                      </div>
                      {!s.is_client_step && (
                        <select
                          value={assigneeMap[s.step_key] ?? ''}
                          onChange={e => setAssigneeMap(prev => ({ ...prev, [s.step_key]: e.target.value }))}
                          className="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-44"
                        >
                          <option value="">Unassigned</option>
                          {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Preview flowchart */}
          {step === 'preview' && (
            <div className="h-full">
              {previewSteps.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <p className="text-sm">No steps — this will be a blank task.</p>
                </div>
              ) : (
                <TaskViewFlowChart steps={previewSteps} edges={previewEdges} />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
          <div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex gap-2">
            {step !== 'template' && (
              <button onClick={() => setStep(step === 'details' ? 'template' : step === 'assignees' ? 'details' : 'assignees')} className="flex items-center gap-1.5 text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 border border-gray-200">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
            {step !== 'preview' ? (
              <button
                onClick={() => {
                  if (step === 'template') { if (!activeTemplate && !isBlank) { setError('Please select a template or choose blank.'); return; } setError(''); setStep('details'); }
                  else if (step === 'details') { if (!title.trim()) { setError('Please enter a task title.'); return; } setError(''); setStep('assignees'); }
                  else if (step === 'assignees') { setStep('preview'); }
                }}
                className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Task
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
