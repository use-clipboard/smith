'use client';

import { useState, useMemo } from 'react';
import { X, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Loader2, RefreshCw, Search, Pencil, ExternalLink, Clock } from 'lucide-react';
import { TaskViewFlowChart } from './TaskFlowChart';
import { DEFAULT_TASK_TEMPLATES, TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { TaskTemplate, TaskStep, TaskStepEdge, Task, RecurrenceType, DefaultTemplate, EdgeConditionType, StartTriggerConfig } from '@/types';
import type { TemplateData } from './TemplateBuilder';
import { triggerLabel } from './StartEndNodes';
import ClientSearchInput from '@/components/ui/ClientSearchInput';

interface Props {
  onClose: () => void;
  onCreate: (data: CreateTaskData) => Promise<void>;
  clients: { id: string; name: string; client_ref: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  firmTemplates: TaskTemplate[];
  /** Called when the user wants to open the full visual builder (optionally pre-populated) */
  onGoToBuilder?: (initialData?: TemplateData | null) => void;
  /** Pre-populate client from a client context (e.g. client detail page) */
  defaultClientId?: string;
  defaultClientName?: string;
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
  step_type?: 'regular' | 'start' | 'end';
  start_trigger_config?: object | null;
  end_config?: object | null;
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

// ── Template card helpers ─────────────────────────────────────────────────────

const RECURRENCE_SHORT: Record<string, string> = {
  weekly: 'Weekly', 'bi-weekly': 'Bi-weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annually: 'Annually', custom: 'Custom',
};

/** Display order for category groups */
const CATEGORY_ORDER: string[] = [
  'year_end', 'vat', 'self_assessment', 'payroll', 'companies_house',
  'bookkeeping', 'cis', 'management', 'performance', 'audit',
  'onboarding', 'internal', 'general', 'other',
];

/** Tailwind colour classes per category — badge bg/text + section accent */
const CATEGORY_COLOURS: Record<string, { badge: string; header: string; dot: string }> = {
  year_end:        { badge: 'bg-indigo-100 text-indigo-700',  header: 'text-indigo-700',  dot: 'bg-indigo-400' },
  vat:             { badge: 'bg-teal-100 text-teal-700',      header: 'text-teal-700',    dot: 'bg-teal-400' },
  self_assessment: { badge: 'bg-orange-100 text-orange-700',  header: 'text-orange-700',  dot: 'bg-orange-400' },
  payroll:         { badge: 'bg-green-100 text-green-700',    header: 'text-green-700',   dot: 'bg-green-400' },
  companies_house: { badge: 'bg-blue-100 text-blue-700',      header: 'text-blue-700',    dot: 'bg-blue-400' },
  bookkeeping:     { badge: 'bg-sky-100 text-sky-700',        header: 'text-sky-700',     dot: 'bg-sky-400' },
  cis:             { badge: 'bg-yellow-100 text-yellow-700',  header: 'text-yellow-700',  dot: 'bg-yellow-400' },
  management:      { badge: 'bg-violet-100 text-violet-700',  header: 'text-violet-700',  dot: 'bg-violet-400' },
  performance:     { badge: 'bg-emerald-100 text-emerald-700',header: 'text-emerald-700', dot: 'bg-emerald-400' },
  audit:           { badge: 'bg-red-100 text-red-700',        header: 'text-red-700',     dot: 'bg-red-400' },
  onboarding:      { badge: 'bg-pink-100 text-pink-700',      header: 'text-pink-700',    dot: 'bg-pink-400' },
  internal:        { badge: 'bg-gray-100 text-gray-600',      header: 'text-gray-600',    dot: 'bg-gray-400' },
  general:         { badge: 'bg-slate-100 text-slate-600',    header: 'text-slate-600',   dot: 'bg-slate-400' },
  other:           { badge: 'bg-stone-100 text-stone-600',    header: 'text-stone-600',   dot: 'bg-stone-400' },
};

function categoryColours(category: string) {
  return CATEGORY_COLOURS[category] ?? { badge: 'bg-gray-100 text-gray-600', header: 'text-gray-600', dot: 'bg-gray-400' };
}

function getStartTrigger(steps: { step_type?: string; start_trigger_config?: StartTriggerConfig | null }[] | undefined): string | null {
  const startStep = steps?.find(s => s.step_type === 'start');
  const cfg = startStep?.start_trigger_config ?? null;
  if (!cfg || cfg.type === 'manual') return null;
  return triggerLabel(cfg);
}

interface TemplateCardProps {
  name: string;
  description?: string | null;
  category: string;
  stepCount: number;
  recurrenceType?: RecurrenceType | null;
  recurrenceIntervalDays?: number | null;
  steps?: { step_type?: string; start_trigger_config?: StartTriggerConfig | null }[];
  selected: boolean;
  onClick: () => void;
}

function TemplateCard({ name, description, category, stepCount, recurrenceType, recurrenceIntervalDays, steps, selected, onClick }: TemplateCardProps) {
  const triggerText = getStartTrigger(steps);
  const recurrenceText = recurrenceType && recurrenceType !== 'once'
    ? (recurrenceType === 'custom' && recurrenceIntervalDays
        ? `Every ${recurrenceIntervalDays}d`
        : RECURRENCE_SHORT[recurrenceType] ?? recurrenceType)
    : null;

  return (
    <button
      onClick={onClick}
      className={`text-left border-2 rounded-lg p-3 transition-all ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
    >
      <p className="text-sm font-semibold text-gray-800 mb-1 leading-snug">{name}</p>
      {description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${categoryColours(category).badge}`}>
          {TEMPLATE_CATEGORY_LABELS[category] ?? category}
        </span>
        <span className="text-xs text-gray-400">{stepCount} steps</span>
        {recurrenceText && (
          <span className="flex items-center gap-1 text-xs text-indigo-600 font-medium">
            <RefreshCw className="h-3 w-3" />{recurrenceText}
          </span>
        )}
      </div>
      {triggerText && (
        <div className="flex items-center gap-1 mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded">
          <Clock className="h-3 w-3 flex-shrink-0 text-amber-500" />
          <span className="truncate">{triggerText}</span>
        </div>
      )}
    </button>
  );
}

// ── Collapsible SMITH built-in templates section ──────────────────────────────

interface SmithTemplatesSectionProps {
  templates: DefaultTemplate[];
  selectedId: string | null;
  onSelect: (t: DefaultTemplate) => void;
}

function SmithTemplatesSection({ templates, selectedId, onSelect }: SmithTemplatesSectionProps) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, DefaultTemplate[]>();
    templates.forEach(t => {
      const cat = t.category ?? 'general';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    });
    const ordered = CATEGORY_ORDER
      .filter(cat => map.has(cat))
      .map(cat => ({ cat, items: map.get(cat)! }));
    Array.from(map.entries())
      .filter(([cat]) => !CATEGORY_ORDER.includes(cat))
      .forEach(([cat, items]) => ordered.push({ cat, items }));
    return ordered;
  }, [templates]);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">SMITH Built-in Templates</span>
          <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">{templates.length}</span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        }
      </button>
      {open && (
        <div className="p-4 space-y-5">
          {groups.map(({ cat, items }) => {
            const colours = categoryColours(cat);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${colours.dot}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wider ${colours.header}`}>
                    {TEMPLATE_CATEGORY_LABELS[cat] ?? cat}
                  </span>
                  <span className="text-xs text-gray-400">({items.length})</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {items.map(t => (
                    <TemplateCard
                      key={t.id}
                      name={t.name}
                      description={t.description}
                      category={cat}
                      stepCount={t.steps.length}
                      recurrenceType={t.recurrence_type}
                      steps={t.steps}
                      selected={selectedId === t.id}
                      onClick={() => onSelect(t)}
                    />
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

// ── Firm templates grouped by category ───────────────────────────────────────

interface FirmTemplatesGroupedProps {
  templates: TaskTemplate[];
  selectedId: string | null;
  onSelect: (t: TaskTemplate) => void;
}

function FirmTemplatesGrouped({ templates, selectedId, onSelect }: FirmTemplatesGroupedProps) {
  const groups = useMemo(() => {
    const map = new Map<string, TaskTemplate[]>();
    templates.forEach(t => {
      const cat = t.category ?? 'general';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    });
    const ordered = CATEGORY_ORDER
      .filter(cat => map.has(cat))
      .map(cat => ({ cat, items: map.get(cat)! }));
    // append any categories not in CATEGORY_ORDER (future-proofing)
    Array.from(map.entries())
      .filter(([cat]) => !CATEGORY_ORDER.includes(cat))
      .forEach(([cat, items]) => ordered.push({ cat, items }));
    return ordered;
  }, [templates]);

  if (groups.length === 0) return null;

  return (
    <div className="mb-6 space-y-5">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Firm's Templates</h3>
      {groups.map(({ cat, items }) => {
        const colours = categoryColours(cat);
        return (
          <div key={cat}>
            {/* Category header */}
            <div className="flex items-center gap-2 mb-2.5">
              <div className={`h-2 w-2 rounded-full flex-shrink-0 ${colours.dot}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${colours.header}`}>
                {TEMPLATE_CATEGORY_LABELS[cat] ?? cat}
              </span>
              <span className="text-xs text-gray-400">({items.length})</span>
            </div>
            {/* Template cards */}
            <div className="grid grid-cols-2 gap-3">
              {items.map(t => (
                <TemplateCard
                  key={t.id}
                  name={t.name}
                  description={t.description}
                  category={cat}
                  stepCount={t.steps?.length ?? 0}
                  recurrenceType={t.recurrence_type}
                  recurrenceIntervalDays={t.recurrence_interval_days}
                  steps={t.steps}
                  selected={selectedId === t.id}
                  onClick={() => onSelect(t)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Convert a DefaultTemplate or TaskTemplate into the TemplateData shape the builder expects */
function toTemplateData(t: DefaultTemplate | TaskTemplate): TemplateData {
  const isDefault = 'steps' in t && !('id' in t && typeof (t as TaskTemplate).is_firm_wide !== 'undefined');
  const source = t as DefaultTemplate; // safe to cast — fields are structurally compatible
  return {
    name: t.name,
    description: ('description' in t ? t.description : null) ?? null,
    is_firm_wide: ('is_firm_wide' in t ? (t as TaskTemplate).is_firm_wide : true) ?? true,
    category: ('category' in t ? t.category : 'general') ?? 'general',
    recurrence_type: (t.recurrence_type as RecurrenceType) ?? null,
    recurrence_interval_days: ('recurrence_interval_days' in t ? (t as TaskTemplate).recurrence_interval_days : null) ?? null,
    estimated_duration_days: ('estimated_duration_days' in t ? t.estimated_duration_days : null) ?? null,
    steps: (t.steps ?? []).map((s: Record<string, unknown>) => ({
      step_key:              String(s.step_key ?? ''),
      title:                 String(s.title ?? ''),
      description:           (s.description as string | null) ?? null,
      assignee_role:         (s.assignee_role as 'team_member' | 'client' | 'any') ?? 'team_member',
      default_assignee_id:   (s.default_assignee_id as string | null) ?? null,
      tool_module_id:        (s.tool_module_id as string | null) ?? null,
      email_reminder_enabled:(s.email_reminder_enabled as boolean) ?? false,
      email_reminder_config: (s.email_reminder_config as { recipients: ('assignee' | 'client')[]; timing: string }) ?? { recipients: [], timing: 'on_assign' },
      email_reminder_subject:(s.email_reminder_subject as string | null) ?? null,
      email_reminder_message:(s.email_reminder_message as string | null) ?? null,
      client_instructions:   (s.client_instructions as string | null) ?? null,
      client_can_upload:     (s.client_can_upload as boolean) ?? false,
      time_estimate_minutes: (s.time_estimate_minutes as number | null) ?? null,
      position_x:            Number(s.position_x ?? 220),
      position_y:            Number(s.position_y ?? 0),
      step_type:             (s.step_type as 'regular' | 'start' | 'end') ?? 'regular',
      start_trigger_config:  (s.start_trigger_config as object | null) ?? null,
      end_config:            (s.end_config as object | null) ?? null,
    })),
    edges: (('edges' in t ? t.edges : []) ?? []).map((e: Record<string, unknown>) => ({
      from_step_key:  String(e.from_step_key ?? ''),
      to_step_key:    String(e.to_step_key ?? ''),
      label:          (e.label as string | null) ?? null,
      condition_type: (e.condition_type as EdgeConditionType | null) ?? null,
      condition_config: null,
      source_handle:  (e.source_handle as string | null) ?? null,
      target_handle:  (e.target_handle as string | null) ?? null,
    })),
  };
}

export default function CreateTaskModal({ onClose, onCreate, clients, teamMembers, firmTemplates, onGoToBuilder, defaultClientId, defaultClientName }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [selectedDefault, setSelectedDefault] = useState<DefaultTemplate | null>(null);
  const [selectedFirmTemplate, setSelectedFirmTemplate] = useState<TaskTemplate | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');

  // Details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState(defaultClientId ?? '');
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
      step_type: ('step_type' in s ? s.step_type : undefined) as 'regular' | 'start' | 'end' | undefined,
      start_trigger_config: ('start_trigger_config' in s ? s.start_trigger_config : null) as object | null,
      end_config: ('end_config' in s ? s.end_config : null) as object | null,
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
    step_type: (s.step_type ?? 'regular') as 'regular' | 'start' | 'end',
    start_trigger_config: s.start_trigger_config ?? null,
    end_config: s.end_config ?? null,
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
    if (!title) setTitle(t.name);
    if (!recurrence && t.recurrence_type) setRecurrence(t.recurrence_type);
  }

  function handleSelectFirm(t: TaskTemplate) {
    setSelectedFirmTemplate(t);
    setSelectedDefault(null);
    if (!title) setTitle(t.name);
    if (!recurrence && t.recurrence_type) setRecurrence(t.recurrence_type as RecurrenceType);
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

              {/* Start from scratch → opens full visual builder */}
              <div className="mb-6">
                <button
                  onClick={() => onGoToBuilder?.(null)}
                  className="w-full flex items-center justify-between text-left border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 rounded-lg p-3 transition-all group"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-700 group-hover:text-indigo-700">Start from scratch</p>
                    <p className="text-xs text-gray-400">Build a custom flowchart in the visual editor</p>
                  </div>
                  <span className="text-xs text-indigo-500 font-medium flex items-center gap-1 flex-shrink-0 ml-3">
                    Open builder <ExternalLink className="h-3 w-3" />
                  </span>
                </button>
              </div>

              {/* Firm templates — grouped by category */}
              {firmTemplates.length > 0 ? (
                <FirmTemplatesGrouped
                  templates={firmTemplates.filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase()))}
                  selectedId={selectedFirmTemplate?.id ?? null}
                  onSelect={handleSelectFirm}
                />
              ) : (
                <div className="mb-6 px-3 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  <p className="text-xs text-gray-400 text-center">No firm templates yet — use a SMITH template below or start from scratch.</p>
                </div>
              )}

              {/* SMITH built-in templates — collapsible */}
              {filteredDefaults.length > 0 && (
                <SmithTemplatesSection
                  templates={filteredDefaults}
                  selectedId={selectedDefault?.id ?? null}
                  onSelect={handleSelectDefault}
                />
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
                    <ClientSearchInput
                      value={clientId}
                      valueName={clientId === (defaultClientId ?? '') ? (defaultClientName ?? '') : undefined}
                      onChange={(id, _name, _ref) => setClientId(id)}
                      placeholder="Select a client…"
                      className="w-full"
                    />
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

            {/* Template step: show Customise / Use as-is when a template is selected */}
            {step === 'template' && activeTemplate && (
              <>
                <button
                  onClick={() => onGoToBuilder?.(toTemplateData(activeTemplate))}
                  className="flex items-center gap-1.5 text-sm text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 border border-gray-200 font-medium"
                >
                  <Pencil className="h-4 w-4" /> Customise first
                </button>
                <button
                  onClick={() => { setError(''); setStep('details'); }}
                  className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium"
                >
                  Use as-is <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}

            {/* Template step: no template selected yet — nothing in footer (start from scratch is inline) */}

            {/* Steps 2-4 */}
            {step !== 'template' && step !== 'preview' && (
              <button
                onClick={() => {
                  if (step === 'details') { if (!title.trim()) { setError('Please enter a task title.'); return; } setError(''); setStep('assignees'); }
                  else if (step === 'assignees') { setStep('preview'); }
                }}
                className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === 'preview' && (
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
