'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNodesState, useEdgesState, addEdge, type Connection, type OnConnect } from '@xyflow/react';
import { X, Plus, Trash2, Loader2, Save, Mail, Puzzle, Clock, RefreshCw, ChevronDown, ChevronUp, Zap, ArrowRight, UserCheck, Upload, CheckCircle2, ExternalLink, Sparkles, AlertTriangle, AlertCircle, Info, ShieldCheck, Rocket, Flag, Bell } from 'lucide-react';
import { MERGE_TAGS, resolveMergeTags, type MergeTagContext } from '@/lib/emailMergeTags';
import Tooltip from '@/components/ui/Tooltip';
import { TaskEditFlowChart } from './TaskFlowChart';
import TaskTemplateTestRun from './TaskTemplateTestRun';
import AITemplateBuilder from './AITemplateBuilder';
import { runStaticAnalysis, type StaticIssue } from './TaskTemplateTestRun';
import type { FlowAnalysis } from '@/app/api/tasks/templates/ai-check/route';
import { MODULES } from '@/config/modules.config';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { TaskTemplate, TaskTemplateStep, TaskTemplateEdge, RecurrenceType, EmailReminderTiming, EdgeConditionType, EdgeConditionConfig, StepType, StartTriggerConfig, EndConfig, StepStatusAutomation, StepAutomationTrigger, StepAutomationTargetStatus } from '@/types';
import { triggerLabel } from './StartEndNodes';
import ClientSearchInput from '@/components/ui/ClientSearchInput';

/** The shape passed back when TemplateBuilder is in task-creation mode */
export interface TaskCreationOutput {
  title: string;
  description?: string | null;
  client_id?: string | null;
  due_date?: string | null;
  is_internal: boolean;
  recurrence_type?: RecurrenceType | null;
  recurrence_interval_days?: number | null;
  steps: Array<{
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
  }>;
  edges: Array<{
    from_step_key: string;
    to_step_key: string;
    label?: string | null;
    condition_type?: string | null;
    source_handle?: string | null;
    target_handle?: string | null;
  }>;
}

interface Props {
  template: TaskTemplate | null; // null = creating new
  initialData?: TemplateData | null; // pre-populate from AI builder or selected template
  teamMembers: { id: string; full_name: string | null; email: string }[];
  existingTemplates?: { id: string; name: string }[]; // for duplicate-name detection
  onSave: (data: TemplateData) => Promise<void>;
  onClose: () => void;
  /** Which save flow to use:
   *   'template'  — saves to task_templates (default)
   *   'task'      — creates a new task instance
   *   'edit-task' — edits an existing task's workflow only (this client only) */
  mode?: 'template' | 'task' | 'edit-task';
  /** Client list — only used in task mode for the client selector */
  clients?: { id: string; name: string; client_ref?: string }[];
  /** Called instead of onSave when mode === 'task' */
  onCreateTask?: (data: TaskCreationOutput, saveAsTemplate: boolean, templateData: TemplateData) => Promise<void>;
  /** Called instead of onSave when mode === 'edit-task'. Receives the new
   *  step + edge graph; the parent persists it via PUT /api/tasks/[id]/workflow. */
  onEditTask?: (steps: TaskCreationOutput['steps'], edges: TaskCreationOutput['edges']) => Promise<void>;
  /** Pre-populate client when launched from a client context */
  defaultClientId?: string;
  defaultClientName?: string;
  /** Pre-populated client name to display read-only in edit-task header */
  editTaskClientName?: string;
}

export type ChDeadlineType = 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due';

export interface TemplateData {
  name: string;
  description?: string | null;
  is_firm_wide: boolean;
  category: string;
  recurrence_type: RecurrenceType | null;
  recurrence_interval_days?: number | null;
  estimated_duration_days?: number | null;
  /** When set, tasks created from this template are auto-linked to this
   *  Companies House deadline on the chosen client. The manual recurrence
   *  fields above are ignored in this mode — CH dictates the cadence. */
  ch_deadline_type?: ChDeadlineType | null;
  ch_offset_days?: number;
  /** Which Gmail mailbox this template's task emails send from: inherit the
   *  firm default, the task owner's mailbox, or a specific firm mailbox. */
  email_sender_mode?: 'default' | 'owner' | 'specific';
  email_sender_mailbox_id?: string | null;
  steps: TemplateStepData[];
  edges: TemplateEdgeData[];
  /** When editing a template that already has active task instances, this
   *  tells the API whether to merge the changes into those existing tasks
   *  ('existing') or only affect future instantiations ('new'). */
  propagateTo?: 'new' | 'existing';
}

export interface TemplateStepData {
  step_key: string;
  title: string;
  description?: string | null;
  assignee_role: 'team_member' | 'client' | 'any';
  default_assignee_id?: string | null;
  tool_module_id?: string | null;
  email_reminder_enabled: boolean;
  email_reminder_config: { recipients: ('assignee' | 'client')[]; timing: EmailReminderTiming };
  email_reminder_subject?: string | null;
  email_reminder_message?: string | null;
  status_automation?: StepStatusAutomation | null;
  client_instructions?: string | null;
  client_can_upload: boolean;
  time_estimate_minutes?: number | null;
  position_x: number;
  position_y: number;
  /** 'regular' by default; 'start' = trigger node, 'end' = completion node */
  step_type?: StepType;
  start_trigger_config?: StartTriggerConfig | null;
  end_config?: EndConfig | null;
}

export interface TemplateEdgeData {
  from_step_key: string;
  to_step_key: string;
  label?: string | null;
  condition_type: EdgeConditionType | null;
  condition_config: EdgeConditionConfig | null;
  source_handle: string | null;
  target_handle: string | null;
}

const TIMING_OPTIONS: { value: EmailReminderTiming; label: string }[] = [
  { value: 'on_assign',          label: 'When step is assigned' },
  { value: '1_week_before_due',  label: '1 week before due date' },
  { value: '3_days_before_due',  label: '3 days before due date' },
  { value: '1_day_before_due',   label: '1 day before due date' },
  { value: 'on_due_date',        label: 'On the due date' },
];

// Status-automation options: when the step reaches `on`, set the task status.
const STATUS_TRIGGER_OPTIONS: { value: StepAutomationTrigger; label: string }[] = [
  { value: 'complete',          label: 'completed' },
  { value: 'in_progress',       label: 'started (In Progress)' },
  { value: 'waiting_on_client', label: 'set to Waiting on Client' },
  { value: 'skipped',           label: 'skipped' },
];
const STATUS_TARGET_OPTIONS: { value: StepAutomationTargetStatus; label: string; color: string }[] = [
  { value: 'not_started',       label: 'Not Started',       color: '#94a3b8' },
  { value: 'in_progress',       label: 'In Progress',       color: '#6366f1' },
  { value: 'waiting_on_client', label: 'Waiting on Client', color: '#f59e0b' },
  { value: 'records_here',      label: 'Records Here',      color: '#0891b2' },
  { value: 'review',            label: 'Review',            color: '#8b5cf6' },
];

const TOOL_MODULES = MODULES.filter(m => m.category === 'tool' && m.route);

// Example merge tag context used for live previews in the editor modals
const PREVIEW_CTX: MergeTagContext = {
  client_name: 'Acme Ltd', client_ref: 'ACM001',
  recipient_name: 'John Smith', year_end: '31 MAR',
  task_title: '', step_title: '', due_date: null,
};

// ── Email Reminder Editor Modal ───────────────────────────────────────────────

interface EmailEditorModalProps {
  step: TemplateStepData;
  templateName: string;
  onUpdate: (updates: Partial<TemplateStepData>) => void;
  onClose: () => void;
}

function EmailEditorModal({ step, templateName, onUpdate, onClose }: EmailEditorModalProps) {
  const [showMergeTags, setShowMergeTags] = useState(false);
  const [activeField, setActiveField] = useState<'subject' | 'message'>('message');
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const ctx: MergeTagContext = { ...PREVIEW_CTX, task_title: templateName, step_title: step.title };
  const previewSubject = step.email_reminder_subject
    ? resolveMergeTags(step.email_reminder_subject, ctx)
    : `[SMITH] Reminder: ${step.title} — ${templateName}`;
  const previewMessage = step.email_reminder_message
    ? resolveMergeTags(step.email_reminder_message, ctx)
    : null;
  const isClientRecipient = step.email_reminder_config.recipients.includes('client');
  const toAddress = isClientRecipient ? 'accounts@acmeltd.com' : 'john.smith@yourfirm.com';
  const toName    = isClientRecipient ? 'Acme Ltd' : 'John Smith';

  function insertTag(tag: string) {
    if (activeField === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      const next  = el.value.slice(0, start) + tag + el.value.slice(end);
      onUpdate({ email_reminder_subject: next || null });
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); });
    } else if (messageRef.current) {
      const el = messageRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      const next  = el.value.slice(0, start) + tag + el.value.slice(end);
      onUpdate({ email_reminder_message: next || null });
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); });
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-blue-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Mail className="h-5 w-5" />
            <div>
              <p className="text-sm font-bold">Email Reminder — {step.title}</p>
              <p className="text-blue-200 text-xs">Preview updates live as you type</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-blue-500 transition-colors"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left — form */}
          <div className="w-72 border-r border-gray-200 overflow-y-auto flex-shrink-0 p-4 space-y-4">

            {/* Send to */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-2">Send to</label>
              <div className="space-y-1.5">
                {(['assignee', 'client'] as const).map(r => (
                  <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={step.email_reminder_config.recipients.includes(r)}
                      onChange={e => {
                        const recs = step.email_reminder_config.recipients;
                        const next = e.target.checked ? [...recs, r] : recs.filter(x => x !== r);
                        onUpdate({ email_reminder_config: { ...step.email_reminder_config, recipients: next } });
                      }}
                      className="rounded" />
                    <span>{r === 'assignee' ? 'Assigned team member' : 'Client'}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Timing */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">When to send</label>
              <select
                value={step.email_reminder_config.timing}
                onChange={e => onUpdate({ email_reminder_config: { ...step.email_reminder_config, timing: e.target.value as EmailReminderTiming } })}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIMING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Subject */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Subject <span className="font-normal text-gray-400">(optional)</span></label>
              <input
                ref={subjectRef}
                type="text"
                value={step.email_reminder_subject ?? ''}
                onChange={e => onUpdate({ email_reminder_subject: e.target.value || null })}
                onFocus={() => setActiveField('subject')}
                placeholder="e.g. Action required: {{task_title}}"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-300"
              />
              <p className="text-[11px] text-gray-400 mt-1">Leave blank to use the default SMITH subject.</p>
            </div>

            {/* Message */}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Message <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea
                ref={messageRef}
                value={step.email_reminder_message ?? ''}
                onChange={e => onUpdate({ email_reminder_message: e.target.value || null })}
                onFocus={() => setActiveField('message')}
                rows={5}
                placeholder="e.g. Please provide your bank statements for {{year_end}} year end…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder-gray-300"
              />
              <p className="text-[11px] text-gray-400 mt-1">Appears below the task details in the email.</p>
            </div>

            {/* Merge tag picker */}
            <div className="border border-indigo-100 rounded-lg overflow-hidden">
              <button type="button" onClick={() => setShowMergeTags(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors">
                <span>Insert data field</span>
                {showMergeTags ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showMergeTags && (
                <div className="p-3 space-y-2.5 bg-white">
                  <p className="text-[11px] text-gray-400">Click to insert at cursor in the {activeField} field.</p>
                  {(['Client', 'Task', 'Recipient'] as const).map(group => (
                    <div key={group}>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{group}</p>
                      <div className="flex flex-wrap gap-1">
                        {MERGE_TAGS.filter(t => t.group === group).map(tag => (
                          <Tooltip key={tag.tag} label={`Example: ${tag.example}`}>
                            <button type="button" onClick={() => insertTag(tag.tag)} aria-label={`Insert ${tag.label}`}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors">
                              {tag.label}
                            </button>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — live preview */}
          <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Live Preview</p>
            <div className="max-w-lg mx-auto">
              {/* Email client chrome */}
              <div className="border border-gray-200 rounded-t-lg px-4 py-3 bg-white space-y-1 text-xs">
                <div className="flex gap-2"><span className="text-gray-400 w-14 flex-shrink-0">From</span><span className="text-gray-700 font-medium">SMITH &lt;noreply@smithforaccountants.co.uk&gt;</span></div>
                <div className="flex gap-2"><span className="text-gray-400 w-14 flex-shrink-0">To</span><span className="text-gray-700">{toAddress}</span></div>
                <div className="flex gap-2"><span className="text-gray-400 w-14 flex-shrink-0">Subject</span><span className="text-gray-900 font-semibold">{previewSubject}</span></div>
              </div>
              <div className="border border-t-0 border-gray-200 rounded-b-lg overflow-hidden">
                <div className="bg-indigo-600 px-5 py-4">
                  <h1 className="text-[var(--text-primary)] text-base font-semibold m-0">SMITH — Task Reminder</h1>
                </div>
                <div className="px-5 py-4 space-y-3 bg-white">
                  <p className="text-gray-900 text-sm">Hello {toName},</p>
                  <p className="text-gray-500 text-xs">You have a task step that requires your attention:</p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
                    <p className="text-gray-900 font-semibold text-sm">{templateName}</p>
                    <p className="text-gray-500 text-xs">Step: <span className="text-gray-700">{step.title}</span></p>
                    <p className="text-gray-500 text-xs">Client: <span className="text-gray-700 font-medium">Acme Ltd</span></p>
                  </div>
                  {previewMessage && <p className="text-gray-600 text-xs whitespace-pre-line leading-relaxed">{previewMessage}</p>}
                  <div>
                    {step.assignee_role === 'client' ? (
                      <div className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-medium">
                        <ExternalLink className="h-3 w-3" /> View &amp; Complete Task
                      </div>
                    ) : (
                      <div className="inline-flex items-center bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-medium">View Task</div>
                    )}
                  </div>
                </div>
                <div className="px-5 py-2.5 border-t border-gray-200 bg-gray-50">
                  <p className="text-[11px] text-gray-400">This reminder was sent from SMITH.</p>
                </div>
              </div>
              <p className="text-center text-[11px] text-gray-400 mt-3">Example data — no real emails are sent during template editing</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
          <p className="text-xs text-gray-400">Changes apply immediately — click <strong>Save</strong> in the template editor to persist.</p>
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Client Portal Editor Modal ────────────────────────────────────────────────

interface ClientPortalEditorModalProps {
  step: TemplateStepData;
  templateName: string;
  onUpdate: (updates: Partial<TemplateStepData>) => void;
  onClose: () => void;
}

function ClientPortalEditorModal({ step, templateName, onUpdate, onClose }: ClientPortalEditorModalProps) {
  const instructions = step.client_instructions ?? step.description;

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-amber-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <UserCheck className="h-5 w-5" />
            <div>
              <p className="text-sm font-bold">Client Request — {step.title}</p>
              <p className="text-amber-200 text-xs">Configure what the client sees on their secure portal page</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-amber-500 transition-colors"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left — form */}
          <div className="w-72 border-r border-gray-200 overflow-y-auto flex-shrink-0 p-4 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 leading-relaxed">
              When this task runs, the client receives a secure link by email. They click it to open this page and mark the step as done.
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Instructions for client</label>
              <textarea
                value={step.client_instructions ?? ''}
                onChange={e => onUpdate({ client_instructions: e.target.value || null })}
                placeholder="e.g. Please upload your bank statements and any invoices for the period. If you have any questions call us on 01234 567890."
                rows={7}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder-gray-300 resize-none"
              />
              <p className="text-[11px] text-gray-400 mt-1">Shown prominently on the client&apos;s portal page.</p>
            </div>

            <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={step.client_can_upload ?? false}
                  onChange={e => onUpdate({ client_can_upload: e.target.checked })}
                  className="rounded accent-amber-500" />
                <span className="text-sm font-medium text-gray-700">Allow client to upload files</span>
              </label>
              {step.client_can_upload && (
                <p className="text-xs text-gray-500 pl-6">Client can attach PDFs, images and spreadsheets (max 20 MB each).</p>
              )}
            </div>
          </div>

          {/* Right — live preview */}
          <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Live Preview</p>
            <div className="max-w-lg mx-auto">
              {/* Firm header */}
              <header className="bg-white border border-gray-200 rounded-t-lg px-4 py-3 flex items-center gap-3">
                <div className="h-7 w-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">F</div>
                <span className="text-sm font-semibold text-gray-900">Your Firm Name</span>
                <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Secure link</span>
              </header>
              <div className="border border-t-0 border-gray-200 rounded-b-lg overflow-hidden bg-gray-50">
                <div className="p-4 space-y-3">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{templateName} · Acme Ltd</p>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-indigo-600 px-4 py-3">
                      <p className="text-indigo-200 text-xs font-medium uppercase tracking-wide mb-0.5">Action required from you</p>
                      <h2 className="text-[var(--text-primary)] text-base font-bold">{step.title}</h2>
                      {step.time_estimate_minutes && (
                        <p className="text-indigo-200 text-xs mt-1 flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Estimated: {step.time_estimate_minutes < 60 ? `${step.time_estimate_minutes} minutes` : `${Math.floor(step.time_estimate_minutes / 60)}h`}
                        </p>
                      )}
                    </div>
                    <div className="p-4 space-y-3">
                      {instructions ? (
                        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{instructions}</p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">No instructions yet — type them in the field on the left.</p>
                      )}
                      {step.client_can_upload && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1.5">Attach files <span className="text-gray-400 font-normal">(optional)</span></p>
                          <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center bg-gray-50">
                            <Upload className="h-4 w-4 text-gray-300 mx-auto mb-1" />
                            <p className="text-sm text-gray-500">Drop files here or <span className="text-indigo-600 font-medium">browse</span></p>
                            <p className="text-xs text-gray-400 mt-0.5">PDF, images, spreadsheets · Max 20 MB</p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-2 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold text-sm">
                        <CheckCircle2 className="h-4 w-4" /> Mark as done
                      </div>
                      <p className="text-center text-xs text-gray-400">Clicking this will notify your accountant that this step is complete.</p>
                    </div>
                  </div>
                  <p className="text-center text-[11px] text-gray-400">Secure link · Expires 30 days · Powered by SMITH</p>
                </div>
              </div>
              <p className="text-center text-[11px] text-gray-400 mt-3">Example data — the real page uses live client info</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
          <p className="text-xs text-gray-400">Changes apply immediately — click <strong>Save</strong> in the template editor to persist.</p>
          <button onClick={onClose} className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Condition Editor Modal ────────────────────────────────────────────────────

const CONDITION_OPTIONS: { value: EdgeConditionType; label: string; desc: string; color: string }[] = [
  { value: 'on_complete', label: 'When previous step is marked complete', desc: 'The next step begins as soon as this one is completed.', color: '#16a34a' },
  { value: 'timeout',     label: 'If no change after a set time',         desc: 'Move on or escalate if the previous step is not completed in time.', color: '#d97706' },
  { value: 'always',      label: 'No condition (proceed immediately)',     desc: 'The next step is available as soon as the workflow reaches it.', color: '#6b7280' },
];

interface ConditionModalProps {
  fromTitle: string;
  toTitle: string;
  currentType: EdgeConditionType | null;
  currentConfig: EdgeConditionConfig | null;
  onSave: (type: EdgeConditionType, config: EdgeConditionConfig | null) => void;
  onClose: () => void;
}

function ConditionModal({ fromTitle, toTitle, currentType, currentConfig, onSave, onClose }: ConditionModalProps) {
  const [type, setType] = useState<EdgeConditionType>(currentType ?? 'on_complete');
  const [days, setDays] = useState(String(currentConfig?.timeout_days ?? ''));
  const [hours, setHours] = useState(String(currentConfig?.timeout_hours ?? ''));

  function handleSave() {
    const config: EdgeConditionConfig | null = type === 'timeout'
      ? { timeout_days: days ? parseInt(days) : undefined, timeout_hours: hours ? parseInt(hours) : undefined }
      : null;
    onSave(type, config);
  }

  return (
    <div className="fixed inset-0 z-[70] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Set Connection Condition</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{fromTitle} → {toTitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-2.5">
          <p className="text-xs text-gray-500 mb-3">When should the next step become active?</p>
          {CONDITION_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className="flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all"
              style={type === opt.value
                ? { borderColor: opt.color, backgroundColor: `${opt.color}12` }
                : { borderColor: '#f3f4f6' }}
            >
              <input
                type="radio"
                name="condition_type"
                value={opt.value}
                checked={type === opt.value}
                onChange={() => setType(opt.value)}
                className="mt-0.5 flex-shrink-0"
              />
              <div>
                <p className="text-sm font-medium" style={type === opt.value ? { color: opt.color } : { color: '#111827' }}>
                  {opt.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}

          {type === 'timeout' && (
            <div className="border border-amber-200 rounded-xl p-3 bg-amber-50 space-y-2 mt-1">
              <p className="text-xs font-semibold text-amber-700">Time limit</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0"
                  value={days}
                  onChange={e => setDays(e.target.value)}
                  placeholder="0"
                  className="w-16 text-sm border border-amber-300 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <span className="text-xs text-amber-700">days</span>
                <input
                  type="number" min="0" max="23"
                  value={hours}
                  onChange={e => setHours(e.target.value)}
                  placeholder="0"
                  className="w-16 text-sm border border-amber-300 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <span className="text-xs text-amber-700">hours</span>
              </div>
              <p className="text-[11px] text-amber-600">If the previous step is not completed within this time, this condition triggers.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors">Save Condition</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

let _keyCounter = 0;
function newStepKey() { return `step_${Date.now()}_${++_keyCounter}`; }

export default function TemplateBuilder({ template, initialData, teamMembers, existingTemplates, onSave, onClose, mode = 'template', clients = [], onCreateTask, onEditTask, defaultClientId, defaultClientName, editTaskClientName }: Props) {
  const isTaskMode = mode === 'task';
  const isEditTaskMode = mode === 'edit-task';
  // Meta — initialData (from AI builder) takes precedence over blank, template takes precedence over both
  const [name, setName] = useState(template?.name ?? initialData?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? initialData?.description ?? '');
  const [isFirmWide, setIsFirmWide] = useState(template?.is_firm_wide ?? initialData?.is_firm_wide ?? true);
  const [category, setCategory] = useState(template?.category ?? initialData?.category ?? 'general');
  const [recurrence, setRecurrence] = useState<RecurrenceType | ''>(template?.recurrence_type ?? (initialData?.recurrence_type as RecurrenceType) ?? '');
  const [customInterval, setCustomInterval] = useState(String(template?.recurrence_interval_days ?? ''));
  const [estimatedDays, setEstimatedDays] = useState(String(template?.estimated_duration_days ?? initialData?.estimated_duration_days ?? ''));
  // CH-deadline linking — when chDeadlineType is non-empty the template is
  // "CH-linked": instantiated tasks attach a ch_deadline_task_links row
  // pointing at this deadline on the chosen client. The recurrence picker
  // above is disabled in this mode because CH dictates cadence.
  const [chDeadlineType, setChDeadlineType] = useState<ChDeadlineType | ''>(
    template?.ch_deadline_type ?? initialData?.ch_deadline_type ?? '',
  );
  const [chOffsetDays, setChOffsetDays] = useState<number>(
    template?.ch_offset_days ?? initialData?.ch_offset_days ?? 0,
  );
  const isChLinked = chDeadlineType !== '';

  // Task-email sender for this template (inherits the firm default unless overridden).
  const [senderMode, setSenderMode] = useState<'default' | 'owner' | 'specific'>(
    (template as { email_sender_mode?: 'default' | 'owner' | 'specific' } | undefined)?.email_sender_mode ?? 'default',
  );
  const [senderMailboxId, setSenderMailboxId] = useState<string | null>(
    (template as { email_sender_mailbox_id?: string | null } | undefined)?.email_sender_mailbox_id ?? null,
  );
  const [senderMailboxes, setSenderMailboxes] = useState<{ id: string; google_email: string; label: string | null }[]>([]);
  useEffect(() => {
    void fetch('/api/tasks/sending-mailboxes')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.mailboxes) setSenderMailboxes(j.mailboxes); })
      .catch(() => {});
  }, []);

  // Steps (local state — push to React Flow via useMemo)
  const [steps, setSteps] = useState<TemplateStepData[]>(() =>
    template ? (template.steps ?? []).map(s => ({
      step_key: s.step_key,
      title: s.title,
      description: s.description,
      assignee_role: s.assignee_role,
      default_assignee_id: s.default_assignee_id,
      tool_module_id: s.tool_module_id,
      email_reminder_enabled: s.email_reminder_enabled,
      email_reminder_config: s.email_reminder_config,
      email_reminder_subject: s.email_reminder_subject,
      email_reminder_message: s.email_reminder_message,
      status_automation: (s.status_automation as StepStatusAutomation | null) ?? null,
      client_instructions: s.client_instructions ?? null,
      client_can_upload: s.client_can_upload ?? false,
      time_estimate_minutes: s.time_estimate_minutes,
      position_x: s.position_x,
      position_y: s.position_y,
      step_type: s.step_type ?? 'regular',
      start_trigger_config: s.start_trigger_config ?? null,
      end_config: s.end_config ?? null,
    })) : (initialData?.steps ?? [])
  );
  const [edgesData, setEdgesData] = useState<TemplateEdgeData[]>(() =>
    template ? (template.edges ?? []).map(e => ({
      from_step_key: e.from_step_key,
      to_step_key: e.to_step_key,
      label: e.label,
      condition_type: e.condition_type ?? null,
      condition_config: e.condition_config ?? null,
      source_handle: e.source_handle ?? null,
      target_handle: e.target_handle ?? null,
    })) : (initialData?.edges ?? [])
  );

  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Propagation modal — shown when saving an edit to a template that has
  // active task instances. The user picks "new only" or "merge into existing".
  const [propagationModal, setPropagationModal] = useState<{ activeCount: number; resolve: (choice: 'new' | 'existing' | null) => void } | null>(null);

  // ── Task-mode only state ────────────────────────────────────────────────────
  const [taskClientId, setTaskClientId]       = useState(defaultClientId ?? '');
  const [taskIsInternal, setTaskIsInternal]   = useState(false);
  const [taskDueDate, setTaskDueDate]         = useState('');
  const [taskSaveAsTemplate, setTaskSaveAsTemplate] = useState(false);
  // ───────────────────────────────────────────────────────────────────────────

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [showTestRun, setShowTestRun] = useState(false);
  const [showAIEdit, setShowAIEdit] = useState(false);
  const [conditionEdge, setConditionEdge] = useState<{ from: string; to: string } | null>(null);

  // Flow analysis
  const [aiCheckState, setAiCheckState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiCheckResult, setAiCheckResult] = useState<FlowAnalysis | null>(null);
  const [aiCheckError, setAiCheckError] = useState('');
  const [showIssuesPanel, setShowIssuesPanel] = useState(false);

  const selectedStep = steps.find(s => s.step_key === selectedStepKey) ?? null;

  // Live static analysis (runs on every steps/edges change, zero cost)
  const staticIssues = useMemo(() => runStaticAnalysis(steps, edgesData), [steps, edgesData]);
  const staticErrorCount   = staticIssues.filter(i => i.severity === 'error').length;
  const staticWarningCount = staticIssues.filter(i => i.severity === 'warning').length;

  async function runAICheck() {
    if (aiCheckState === 'loading') return;
    setAiCheckState('loading');
    setAiCheckError('');
    setShowIssuesPanel(true);
    try {
      const res = await fetch('/api/tasks/templates/ai-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'Untitled', steps, edges: edgesData }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Analysis failed');
      }
      const data: FlowAnalysis = await res.json();
      setAiCheckResult(data);
      setAiCheckState('done');
    } catch (err) {
      setAiCheckError(err instanceof Error ? err.message : 'Analysis failed');
      setAiCheckState('error');
    }
  }

  // Build fake TaskTemplateStep/Edge arrays for the flow chart
  const flowSteps: TaskTemplateStep[] = useMemo(() => steps.map(s => ({
    id: s.step_key,
    template_id: template?.id ?? '',
    step_key: s.step_key,
    title: s.title,
    description: s.description ?? null,
    assignee_role: s.assignee_role,
    default_assignee_id: s.default_assignee_id ?? null,
    tool_module_id: s.tool_module_id ?? null,
    email_reminder_enabled: s.email_reminder_enabled,
    email_reminder_config: s.email_reminder_config,
    email_reminder_subject: s.email_reminder_subject ?? null,
    email_reminder_message: s.email_reminder_message ?? null,
    status_automation: s.status_automation ?? null,
    client_instructions: s.client_instructions ?? null,
    client_can_upload: s.client_can_upload ?? false,
    time_estimate_minutes: s.time_estimate_minutes ?? null,
    position_x: s.position_x,
    position_y: s.position_y,
    step_type: s.step_type ?? 'regular',
    start_trigger_config: s.start_trigger_config ?? null,
    end_config: s.end_config ?? null,
    default_assignee: s.default_assignee_id ? (teamMembers.find(m => m.id === s.default_assignee_id) ?? null) : null,
  })), [steps, template, teamMembers]);

  const flowEdges: TaskTemplateEdge[] = useMemo(() => edgesData.map((e, i) => ({
    id: `e-${i}`,
    template_id: template?.id ?? '',
    from_step_key: e.from_step_key,
    to_step_key: e.to_step_key,
    label: e.label ?? null,
    condition_type: e.condition_type ?? null,
    condition_config: e.condition_config ?? null,
    source_handle: e.source_handle ?? null,
    target_handle: e.target_handle ?? null,
  })), [edgesData, template]);

  // React Flow internal state (needed for onNodesChange/onEdgesChange handlers)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [, , onNodesChange] = useNodesState<any>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [, , onEdgesChange] = useEdgesState<any>([]);

  const handleConnect: OnConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setEdgesData(prev => {
      const exists = prev.some(e => e.from_step_key === connection.source && e.to_step_key === connection.target);
      if (exists) return prev;
      return [...prev, {
        from_step_key: connection.source!,
        to_step_key: connection.target!,
        condition_type: null,
        condition_config: null,
        source_handle: connection.sourceHandle ?? null,
        target_handle: connection.targetHandle ?? null,
      }];
    });
  }, []);

  function handleNodePositionChange(stepKey: string, x: number, y: number) {
    setSteps(prev => prev.map(s => s.step_key === stepKey ? { ...s, position_x: x, position_y: y } : s));
  }

  function addStep() {
    if (steps.length === 0) {
      // No steps yet — place immediately in the centre
      placeStep(220, 0);
    } else {
      // Enter placement mode so user can click where they want it
      setPlacementMode(true);
      setSelectedStepKey(null);
    }
  }

  function addStartNode() {
    const minY = steps.length > 0 ? Math.min(...steps.map(s => s.position_y)) : 200;
    const key = `start_${Date.now()}`;
    setSteps(prev => [...prev, {
      step_key: key,
      step_type: 'start',
      title: 'Start',
      description: null,
      assignee_role: 'any',
      default_assignee_id: null,
      tool_module_id: null,
      email_reminder_enabled: false,
      email_reminder_config: { recipients: [], timing: 'on_assign' },
      email_reminder_subject: null,
      email_reminder_message: null,
      client_instructions: null,
      client_can_upload: false,
      time_estimate_minutes: null,
      position_x: 220,
      position_y: minY - 220,
      start_trigger_config: { type: 'manual' },
      end_config: null,
    }]);
    setSelectedStepKey(key);
  }

  function addEndNode() {
    const maxY = steps.length > 0 ? Math.max(...steps.map(s => s.position_y)) : 0;
    const key = `end_${Date.now()}`;
    setSteps(prev => [...prev, {
      step_key: key,
      step_type: 'end',
      title: 'Complete',
      description: null,
      assignee_role: 'any',
      default_assignee_id: null,
      tool_module_id: null,
      email_reminder_enabled: false,
      email_reminder_config: { recipients: [], timing: 'on_assign' },
      email_reminder_subject: null,
      email_reminder_message: null,
      client_instructions: null,
      client_can_upload: false,
      time_estimate_minutes: null,
      position_x: 220,
      position_y: maxY + 220,
      start_trigger_config: null,
      end_config: { send_completion_notification: false, notification_recipients: [] },
    }]);
    setSelectedStepKey(key);
  }

  function placeStep(x: number, y: number) {
    const key = newStepKey();
    const newStep: TemplateStepData = {
      step_key: key,
      title: 'New Step',
      description: null,
      assignee_role: 'team_member',
      default_assignee_id: null,
      tool_module_id: null,
      email_reminder_enabled: false,
      email_reminder_config: { recipients: [], timing: 'on_assign' },
      email_reminder_subject: null,
      email_reminder_message: null,
      client_instructions: null,
      client_can_upload: false,
      time_estimate_minutes: null,
      position_x: x,
      position_y: y,
    };
    setSteps(prev => [...prev, newStep]);
    setSelectedStepKey(key);
    setPlacementMode(false);
  }

  function handleInsertOnEdge(fromKey: string, toKey: string) {
    // Find positions of the two connected steps and place new step between them
    const fromStep = steps.find(s => s.step_key === fromKey);
    const toStep = steps.find(s => s.step_key === toKey);
    const midX = fromStep && toStep ? (fromStep.position_x + toStep.position_x) / 2 : 220;
    const midY = fromStep && toStep ? (fromStep.position_y + toStep.position_y) / 2 : 0;

    const key = newStepKey();
    const newStep: TemplateStepData = {
      step_key: key,
      title: 'New Step',
      description: null,
      assignee_role: 'team_member',
      default_assignee_id: null,
      tool_module_id: null,
      email_reminder_enabled: false,
      email_reminder_config: { recipients: [], timing: 'on_assign' },
      email_reminder_subject: null,
      email_reminder_message: null,
      client_instructions: null,
      client_can_upload: false,
      time_estimate_minutes: null,
      position_x: midX,
      position_y: midY,
    };

    setSteps(prev => [...prev, newStep]);
    // Replace the direct edge with two edges: from → new → to
    setEdgesData(prev => [
      ...prev.filter(e => !(e.from_step_key === fromKey && e.to_step_key === toKey)),
      { from_step_key: fromKey, to_step_key: key, condition_type: null, condition_config: null, source_handle: null, target_handle: null },
      { from_step_key: key, to_step_key: toKey, condition_type: null, condition_config: null, source_handle: null, target_handle: null },
    ]);
    setSelectedStepKey(key);
  }

  function deleteStep(key: string) {
    setSteps(prev => prev.filter(s => s.step_key !== key));
    setEdgesData(prev => prev.filter(e => e.from_step_key !== key && e.to_step_key !== key));
    if (selectedStepKey === key) setSelectedStepKey(null);
  }

  function deleteEdge(from: string, to: string) {
    setEdgesData(prev => prev.filter(e => !(e.from_step_key === from && e.to_step_key === to)));
  }

  function updateSelectedStep(updates: Partial<TemplateStepData>) {
    if (!selectedStepKey) return;
    setSteps(prev => prev.map(s => s.step_key === selectedStepKey ? { ...s, ...updates } : s));
  }

  /** Set the default assignee on every team-member step at once. Client/any
   *  steps are left untouched. Called from the "Apply to all team steps" link. */
  function assignAllTeamSteps(assigneeId: string | null) {
    setSteps(prev => prev.map(s =>
      s.assignee_role === 'team_member' ? { ...s, default_assignee_id: assigneeId } : s
    ));
  }

  async function handleSave() {
    // edit-task mode skips name validation (the task title isn't being changed here)
    if (!isEditTaskMode && !name.trim()) { setError(isTaskMode ? 'Task title is required.' : 'Template name is required.'); return; }

    // Duplicate-name check only applies in template mode (or when saving as template)
    if (!isTaskMode && !isEditTaskMode || taskSaveAsTemplate) {
      const duplicate = existingTemplates?.find(
        t => t.name.toLowerCase() === name.trim().toLowerCase() && t.id !== template?.id
      );
      if (duplicate) { setError(`A template named "${duplicate.name}" already exists. Please choose a different name.`); return; }
    }

    const unconfiguredEdges = edgesData.filter(e => !e.condition_type);
    if (unconfiguredEdges.length > 0) {
      setError(`${unconfiguredEdges.length} connection${unconfiguredEdges.length > 1 ? 's' : ''} need${unconfiguredEdges.length === 1 ? 's' : ''} a condition set. Hover over each connection on the canvas to add one.`);
      return;
    }

    setSaving(true);
    setError('');

    const templateData: TemplateData = {
      name: name.trim(),
      description: description || null,
      is_firm_wide: isFirmWide,
      category,
      // CH-linked templates ignore manual recurrence — the CH deadline +
      // the sync engine's renewal logic dictate the cadence instead. We
      // still persist the user's prior recurrence choice (in case they
      // toggle back to manual later) but pass null to the API in CH mode.
      recurrence_type: isChLinked ? null : (recurrence as RecurrenceType || null),
      recurrence_interval_days: isChLinked ? null : (recurrence === 'custom' && customInterval ? parseInt(customInterval) : null),
      ch_deadline_type: isChLinked ? (chDeadlineType as ChDeadlineType) : null,
      ch_offset_days:   isChLinked ? chOffsetDays : 0,
      estimated_duration_days: estimatedDays ? parseInt(estimatedDays) : null,
      email_sender_mode: senderMode,
      email_sender_mailbox_id: senderMode === 'specific' ? senderMailboxId : null,
      steps,
      edges: edgesData,
    };

    // If editing a template (not creating, not task-mode, not edit-task), check whether
    // it has live task instances and prompt for propagation.
    if (template && !isTaskMode && !isEditTaskMode) {
      try {
        const r = await fetch(`/api/tasks/templates/${template.id}/usage`);
        if (r.ok) {
          const { activeCount } = await r.json() as { activeCount: number };
          if (activeCount > 0) {
            const choice = await new Promise<'new' | 'existing' | null>(resolve => {
              setPropagationModal({ activeCount, resolve });
            });
            setPropagationModal(null);
            if (choice === null) { setSaving(false); return; }
            templateData.propagateTo = choice;
          }
        }
      } catch { /* non-fatal — fall through with default 'new only' */ }
    }

    try {
      if (isTaskMode && onCreateTask) {
        // Map TemplateStepData → TaskCreationOutput steps
        const taskSteps = steps.map(s => ({
          step_key:               s.step_key,
          title:                  s.title,
          description:            s.description ?? null,
          assignee_id:            s.default_assignee_id ?? null,
          is_client_step:         s.assignee_role === 'client',
          tool_module_id:         s.tool_module_id ?? null,
          email_reminder_enabled: s.email_reminder_enabled,
          email_reminder_config:  s.email_reminder_config as { recipients: string[]; timing: string },
          status_automation:      s.status_automation ?? null,
          position_x:             s.position_x,
          position_y:             s.position_y,
          step_type:              s.step_type,
          start_trigger_config:   s.start_trigger_config ?? null,
          end_config:             s.end_config ?? null,
        }));
        const taskEdges = edgesData.map(e => ({
          from_step_key:  e.from_step_key,
          to_step_key:    e.to_step_key,
          label:          e.label ?? null,
          condition_type: e.condition_type,
          source_handle:  e.source_handle,
          target_handle:  e.target_handle,
        }));
        await onCreateTask({
          title:                    name.trim(),
          description:              description || null,
          client_id:                taskIsInternal ? null : (taskClientId || null),
          due_date:                 taskDueDate || null,
          is_internal:              taskIsInternal || !taskClientId,
          recurrence_type:          recurrence as RecurrenceType || null,
          recurrence_interval_days: recurrence === 'custom' && customInterval ? parseInt(customInterval) : null,
          steps:                    taskSteps,
          edges:                    taskEdges,
        }, taskSaveAsTemplate, templateData);
      } else if (isEditTaskMode && onEditTask) {
        // Reuse the task-mode mapping for steps/edges so shapes match the API
        const taskSteps = steps.map(s => ({
          step_key:               s.step_key,
          title:                  s.title,
          description:            s.description ?? null,
          assignee_id:            s.default_assignee_id ?? null,
          is_client_step:         s.assignee_role === 'client',
          tool_module_id:         s.tool_module_id ?? null,
          email_reminder_enabled: s.email_reminder_enabled,
          email_reminder_config:  s.email_reminder_config as { recipients: string[]; timing: string },
          status_automation:      s.status_automation ?? null,
          position_x:             s.position_x,
          position_y:             s.position_y,
          step_type:              s.step_type,
          start_trigger_config:   s.start_trigger_config ?? null,
          end_config:             s.end_config ?? null,
        }));
        const taskEdges = edgesData.map(e => ({
          from_step_key:  e.from_step_key,
          to_step_key:    e.to_step_key,
          label:          e.label ?? null,
          condition_type: e.condition_type,
          source_handle:  e.source_handle,
          target_handle:  e.target_handle,
        }));
        await onEditTask(taskSteps, taskEdges);
      } else {
        await onSave(templateData);
      }
      onClose();
    } catch {
      setError(isEditTaskMode ? 'Failed to save workflow. Please try again.' : isTaskMode ? 'Failed to create task. Please try again.' : 'Failed to save template. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full max-w-6xl h-[92vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 flex-shrink-0 bg-gray-50">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {isEditTaskMode ? (
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-gray-900 truncate">{name || 'Edit task workflow'}</h2>
                <p className="text-xs text-amber-700 mt-0.5">
                  Editing this client&apos;s task only — the template is unchanged. {editTaskClientName ? `Client: ${editTaskClientName}` : ''}
                </p>
              </div>
            ) : (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isTaskMode ? 'Task title…' : 'Template name…'}
                className="text-lg font-bold text-gray-900 border-0 bg-transparent focus:outline-none focus:ring-0 min-w-0 flex-1 placeholder-gray-300"
              />
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {error && <span className="text-xs text-red-600">{error}</span>}

            {/* Live issue badge */}
            {steps.length > 0 && (staticErrorCount > 0 || staticWarningCount > 0) && (
              <Tooltip label="Show flow issues">
                <button
                  onClick={() => { setShowIssuesPanel(v => !v); setSelectedStepKey(null); }}
                  aria-label="Show flow issues"
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                    staticErrorCount > 0
                      ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                      : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  {staticErrorCount > 0 ? <AlertCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {staticErrorCount + staticWarningCount} issue{staticErrorCount + staticWarningCount > 1 ? 's' : ''}
                </button>
              </Tooltip>
            )}
            {steps.length > 0 && staticErrorCount === 0 && staticWarningCount === 0 && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" /> Flow OK
              </span>
            )}

            <button
              onClick={() => setShowAIEdit(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium transition-colors"
            >
              <Sparkles className="h-4 w-4" /> AI Edit
            </button>
            {steps.length > 0 && (
              <button
                onClick={() => setShowTestRun(true)}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium transition-colors"
              >
                <Zap className="h-4 w-4" /> Test Flow
              </button>
            )}
            {/* Task mode: save-as-template checkbox */}
            {isTaskMode && (
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={taskSaveAsTemplate}
                  onChange={e => setTaskSaveAsTemplate(e.target.checked)}
                  className="rounded"
                />
                Save as template
              </label>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isTaskMode ? 'Create Task' : isEditTaskMode ? 'Save Workflow' : 'Save'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-200 text-gray-400"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Sub-header — template settings / task details */}
        <div className="flex items-center gap-4 px-6 py-2 border-b border-gray-100 flex-shrink-0 flex-wrap">
          {isEditTaskMode ? (
            /* edit-task mode: read-only meta. The task title / client / due-date / recurrence
               are managed elsewhere; this builder only edits the step + edge graph. */
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              Workflow editor · client task only
            </span>
          ) : isTaskMode ? (
            /* Task mode: client + due date */
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTaskIsInternal(false)}
                  className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors ${!taskIsInternal ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >
                  Client task
                </button>
                <button
                  onClick={() => { setTaskIsInternal(true); setTaskClientId(''); }}
                  className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors ${taskIsInternal ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >
                  Internal
                </button>
              </div>
              {!taskIsInternal && (
                <div className="w-56">
                  <ClientSearchInput
                    value={taskClientId}
                    valueName={taskClientId === (defaultClientId ?? '') ? (defaultClientName ?? '') : undefined}
                    onChange={(id) => setTaskClientId(id)}
                    placeholder="Select client…"
                    className="w-full"
                  />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Due</span>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={e => setTaskDueDate(e.target.value)}
                  className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <select value={recurrence} onChange={e => setRecurrence(e.target.value as RecurrenceType | '')} className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="">No recurrence</option>
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
                <option value="four-weekly">Four-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
                <option value="custom">Custom</option>
              </select>
              {recurrence === 'custom' && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">Every</span>
                  <input type="number" min="1" value={customInterval} onChange={e => setCustomInterval(e.target.value)} className="w-14 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  <span className="text-xs text-gray-500">days</span>
                </div>
              )}
            </>
          ) : (
            /* Template mode: original controls */
            <>
              <select value={category} onChange={e => setCategory(e.target.value)} className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                {Object.entries(TEMPLATE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {/* Renewal source — Manual (recurrence below) or CH Deadline.
                  When CH is picked the manual recurrence + custom-interval
                  inputs are disabled and the CH controls take over. */}
              <select
                value={isChLinked ? 'ch' : 'manual'}
                onChange={e => {
                  if (e.target.value === 'manual') setChDeadlineType('');
                  else setChDeadlineType('accounts_due');
                }}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="manual">Manual cadence</option>
                <option value="ch">CH deadline-linked</option>
              </select>
              {isChLinked ? (
                <>
                  <select
                    value={chDeadlineType}
                    onChange={e => setChDeadlineType(e.target.value as ChDeadlineType)}
                    className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="accounts_due">Accounts Due</option>
                    <option value="cs_due">CS Due</option>
                    <option value="officer_idv_due">Officer IDV Due</option>
                    <option value="psc_idv_due">PSC IDV Due</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Offset</span>
                    <input
                      type="number"
                      step={1}
                      value={chOffsetDays}
                      onChange={e => setChOffsetDays(Number.isFinite(parseInt(e.target.value, 10)) ? parseInt(e.target.value, 10) : 0)}
                      className="w-16 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-500">days</span>
                  </div>
                  <span className="text-[10px] text-gray-500 italic">
                    Negative = before the deadline. Existing tasks aren&apos;t affected — only new ones get the link.
                  </span>
                </>
              ) : (
                <>
                  <select value={recurrence} onChange={e => setRecurrence(e.target.value as RecurrenceType | '')} className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                    <option value="">No recurrence</option>
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="four-weekly">Four-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                    <option value="custom">Custom</option>
                  </select>
                  {recurrence === 'custom' && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">Every</span>
                      <input type="number" min="1" value={customInterval} onChange={e => setCustomInterval(e.target.value)} className="w-14 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      <span className="text-xs text-gray-500">days</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">Est.</span>
                <input type="number" min="1" placeholder="days" value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} className="w-16 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <span className="text-xs text-gray-500">days</span>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input type="checkbox" checked={isFirmWide} onChange={e => setIsFirmWide(e.target.checked)} className="rounded" />
                Firm-wide
              </label>
              {/* Which Gmail this template's task emails send from. */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">Email from</span>
                <select
                  value={senderMode}
                  onChange={e => setSenderMode(e.target.value as 'default' | 'owner' | 'specific')}
                  className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="default">Firm default</option>
                  <option value="owner">Task owner&apos;s Gmail</option>
                  <option value="specific" disabled={senderMailboxes.length === 0}>Specific mailbox</option>
                </select>
                {senderMode === 'specific' && (
                  <select
                    value={senderMailboxId ?? ''}
                    onChange={e => setSenderMailboxId(e.target.value || null)}
                    className="text-xs border border-gray-200 rounded px-2 py-1 bg-white max-w-[180px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">Choose…</option>
                    {senderMailboxes.map(m => <option key={m.id} value={m.id}>{m.label || m.google_email}</option>)}
                  </select>
                )}
              </div>
            </>
          )}
        </div>

        {/* Body: flowchart + step panel */}
        <div className="flex-1 overflow-hidden flex">

          {/* Flowchart canvas */}
          <div className="flex-1 min-w-0 relative">
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              {placementMode ? (
                <button
                  onClick={() => setPlacementMode(false)}
                  className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-lg shadow-sm"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              ) : (
                <>
                  <button
                    onClick={addStep}
                    className="flex items-center gap-1.5 bg-white border border-gray-300 shadow-sm text-sm text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 hover:border-indigo-400"
                  >
                    <Plus className="h-4 w-4 text-indigo-600" /> Add Step
                  </button>
                  <Tooltip label={steps.some(s => s.step_type === 'start') ? 'Start node already exists' : 'Add a trigger/start node'}>
                    <button
                      onClick={addStartNode}
                      disabled={steps.some(s => s.step_type === 'start')}
                      aria-label="Add start node"
                      className="flex items-center gap-1.5 bg-white border border-gray-300 shadow-sm text-sm text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-50 hover:border-green-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Rocket className="h-4 w-4" /> Start
                    </button>
                  </Tooltip>
                  <Tooltip label={steps.some(s => s.step_type === 'end') ? 'End node already exists' : 'Add a completion/end node'}>
                    <button
                      onClick={addEndNode}
                      disabled={steps.some(s => s.step_type === 'end')}
                      aria-label="Add end node"
                      className="flex items-center gap-1.5 bg-white border border-gray-300 shadow-sm text-sm text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-50 hover:border-purple-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Flag className="h-4 w-4" /> End
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
            {steps.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
                <p className="text-sm">Click "Add Step" to start building your workflow.</p>
                <p className="text-xs">Drag between step handles to create connections.</p>
              </div>
            ) : (
              <TaskEditFlowChart
                steps={flowSteps}
                edges={flowEdges}
                selectedStepKey={selectedStepKey}
                onSelectStep={setSelectedStepKey}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onNodePositionChange={handleNodePositionChange}
                placementMode={placementMode}
                onPlaceStep={placeStep}
                onCancelPlacement={() => setPlacementMode(false)}
                onInsertOnEdge={handleInsertOnEdge}
                onConditionChange={(from, to) => setConditionEdge({ from, to })}
                onDeleteEdge={deleteEdge}
              />
            )}
          </div>

          {/* Step configuration panel */}
          <div className="w-72 border-l border-gray-200 overflow-y-auto flex-shrink-0 bg-gray-50">

            {/* ── Start Node Config ─────────────────────────────── */}
            {selectedStep?.step_type === 'start' && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <h4 className="text-sm font-semibold text-green-700">Start Node</h4>
                  </div>
                  <Tooltip label="Remove start node">
                  <button onClick={() => deleteStep(selectedStep.step_key)} aria-label="Remove start node" className="text-red-400 hover:text-red-600 p-1 rounded">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  </Tooltip>
                </div>
                <p className="text-xs text-gray-500">Sets when this workflow is triggered. Connect this node to your first step.</p>

                {/* Label */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Label</label>
                  <input value={selectedStep.title} onChange={e => updateSelectedStep({ title: e.target.value })} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white" />
                </div>

                {/* Trigger type */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Trigger Type</label>
                  <select
                    value={selectedStep.start_trigger_config?.type ?? 'manual'}
                    onChange={e => updateSelectedStep({
                      start_trigger_config: {
                        ...(selectedStep.start_trigger_config ?? {}),
                        type: e.target.value as StartTriggerConfig['type'],
                      }
                    })}
                    className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="manual">Manual — staff clicks "Start Task"</option>
                    <option value="deadline_relative">Deadline-relative — N months/weeks/days before deadline</option>
                    <option value="day_of_month">Day of month / period</option>
                    <option value="date_of_year">Specific date each year</option>
                  </select>
                </div>

                {/* Deadline-relative options */}
                {selectedStep.start_trigger_config?.type === 'deadline_relative' && (() => {
                  const cfg = selectedStep.start_trigger_config!;
                  const unit = cfg.deadline_unit ?? 'months';
                  const currentValue = unit === 'weeks' ? (cfg.weeks_before ?? '')
                                     : unit === 'days'  ? (cfg.days_before  ?? '')
                                     :                    (cfg.months_before ?? '');
                  return (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">How far in advance</label>
                        <div className="flex gap-2">
                          <input
                            type="number" min="0" max="365"
                            value={currentValue}
                            onChange={e => {
                              const n = parseInt(e.target.value) || undefined;
                              updateSelectedStep({
                                start_trigger_config: {
                                  ...cfg,
                                  months_before: unit === 'months' ? n : undefined,
                                  weeks_before:  unit === 'weeks'  ? n : undefined,
                                  days_before:   unit === 'days'   ? n : undefined,
                                }
                              });
                            }}
                            placeholder="e.g. 3"
                            className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
                          />
                          <select
                            value={unit}
                            onChange={e => {
                              const newUnit = e.target.value as 'months' | 'weeks' | 'days';
                              updateSelectedStep({
                                start_trigger_config: {
                                  ...cfg,
                                  deadline_unit: newUnit,
                                  months_before: newUnit === 'months' ? (cfg.months_before ?? cfg.weeks_before ?? cfg.days_before) : undefined,
                                  weeks_before:  newUnit === 'weeks'  ? (cfg.weeks_before  ?? cfg.months_before ?? cfg.days_before) : undefined,
                                  days_before:   newUnit === 'days'   ? (cfg.days_before   ?? cfg.months_before ?? cfg.weeks_before) : undefined,
                                }
                              });
                            }}
                            className="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                          >
                            <option value="months">Months</option>
                            <option value="weeks">Weeks</option>
                            <option value="days">Days</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Deadline label</label>
                        <input
                          value={cfg.deadline_label ?? ''}
                          onChange={e => updateSelectedStep({
                            start_trigger_config: { ...cfg, deadline_label: e.target.value || undefined }
                          })}
                          placeholder="e.g. year end, tax deadline"
                          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
                        />
                      </div>
                      <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-green-700 font-medium">Preview</p>
                        <p className="text-xs text-green-600 mt-0.5">{triggerLabel(cfg)}</p>
                      </div>
                    </>
                  );
                })()}

                {/* Day of month options */}
                {(selectedStep.start_trigger_config?.type === 'day_of_month' || selectedStep.start_trigger_config?.type === 'date_of_year') && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Day of month (1–31)</label>
                      <input
                        type="number" min="1" max="31"
                        value={selectedStep.start_trigger_config?.day_of_month ?? ''}
                        onChange={e => updateSelectedStep({
                          start_trigger_config: {
                            ...selectedStep.start_trigger_config!,
                            day_of_month: parseInt(e.target.value) || undefined,
                          }
                        })}
                        placeholder="e.g. 1"
                        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">
                        {selectedStep.start_trigger_config?.type === 'date_of_year' ? 'Month' : 'Month (leave blank = every period)'}
                      </label>
                      <select
                        value={selectedStep.start_trigger_config?.month ?? ''}
                        onChange={e => updateSelectedStep({
                          start_trigger_config: {
                            ...selectedStep.start_trigger_config!,
                            month: e.target.value ? parseInt(e.target.value) : null,
                          }
                        })}
                        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                      >
                        {selectedStep.start_trigger_config?.type !== 'date_of_year' && <option value="">Every period</option>}
                        {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                          <option key={i+1} value={i+1}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <p className="text-xs text-green-700 font-medium">Preview</p>
                      <p className="text-xs text-green-600 mt-0.5">{triggerLabel(selectedStep.start_trigger_config)}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── End Node Config ───────────────────────────────── */}
            {selectedStep?.step_type === 'end' && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flag className="h-4 w-4 text-purple-600 flex-shrink-0" />
                    <h4 className="text-sm font-semibold text-purple-700">End Node</h4>
                  </div>
                  <Tooltip label="Remove end node">
                    <button onClick={() => deleteStep(selectedStep.step_key)} aria-label="Remove end node" className="text-red-400 hover:text-red-600 p-1 rounded">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
                <p className="text-xs text-gray-500">Marks where the workflow is complete. Connect your last step to this node.</p>

                {/* Label */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Label</label>
                  <input value={selectedStep.title} onChange={e => updateSelectedStep({ title: e.target.value })} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 bg-white" />
                </div>

                {/* Completion notification */}
                <div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStep.end_config?.send_completion_notification ?? false}
                      onChange={e => updateSelectedStep({
                        end_config: {
                          ...(selectedStep.end_config ?? {}),
                          send_completion_notification: e.target.checked,
                        }
                      })}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700 font-medium">Send completion notification</span>
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-5">Notify specified recipients when the workflow reaches this end node.</p>
                </div>

                {selectedStep.end_config?.send_completion_notification && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1.5">Notify</label>
                      <div className="space-y-1.5">
                        {(['assignee', 'client'] as const).map(r => (
                          <label key={r} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(selectedStep.end_config?.notification_recipients ?? []).includes(r)}
                              onChange={e => {
                                const current = selectedStep.end_config?.notification_recipients ?? [];
                                const next = e.target.checked ? [...current, r] : current.filter(x => x !== r);
                                updateSelectedStep({
                                  end_config: { ...selectedStep.end_config!, notification_recipients: next }
                                });
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-700 capitalize">{r === 'assignee' ? 'Team (task assignee)' : 'Client'}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                        <Bell className="h-3.5 w-3.5" /> Notification message (optional)
                      </label>
                      <textarea
                        value={selectedStep.end_config?.notification_message ?? ''}
                        onChange={e => updateSelectedStep({
                          end_config: {
                            ...selectedStep.end_config!,
                            notification_message: e.target.value || null,
                          }
                        })}
                        rows={3}
                        placeholder="e.g. Your tax return has been completed and submitted. Please review the confirmation below."
                        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500 bg-white resize-none"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Regular Step Config ───────────────────────────── */}
            {selectedStep && (!selectedStep.step_type || selectedStep.step_type === 'regular') && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-700">Step Settings</h4>
                  <button onClick={() => deleteStep(selectedStep.step_key)} className="text-red-400 hover:text-red-600 p-1 rounded">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Title */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Title</label>
                  <input value={selectedStep.title} onChange={e => updateSelectedStep({ title: e.target.value })} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white" />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Description</label>
                  <textarea value={selectedStep.description ?? ''} onChange={e => updateSelectedStep({ description: e.target.value || null })} rows={2} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white resize-none" />
                </div>

                {/* Assignee role */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Assignee Type</label>
                  <select value={selectedStep.assignee_role} onChange={e => updateSelectedStep({ assignee_role: e.target.value as 'team_member' | 'client' | 'any' })} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                    <option value="team_member">Team Member</option>
                    <option value="client">Client</option>
                    <option value="any">Any</option>
                  </select>
                </div>

                {/* Default assignee (only for team_member) */}
                {selectedStep.assignee_role === 'team_member' && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Default Assignee</label>
                    <select value={selectedStep.default_assignee_id ?? ''} onChange={e => updateSelectedStep({ default_assignee_id: e.target.value || null })} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      <option value="">Unassigned</option>
                      {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                    </select>
                    {steps.filter(s => s.assignee_role === 'team_member').length > 1 && (
                      <button
                        type="button"
                        onClick={() => assignAllTeamSteps(selectedStep.default_assignee_id ?? null)}
                        className="mt-1.5 text-xs text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        Apply this assignee to all team steps
                      </button>
                    )}
                  </div>
                )}

                {/* Tool link */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <Puzzle className="h-3.5 w-3.5" /> Link to SMITH Tool (optional)
                  </label>
                  <select value={selectedStep.tool_module_id ?? ''} onChange={e => updateSelectedStep({ tool_module_id: e.target.value || null })} className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                    <option value="">No tool link</option>
                    {TOOL_MODULES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>

                {/* Time estimate */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <Clock className="h-3.5 w-3.5" /> Time Estimate
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min="0"
                      value={selectedStep.time_estimate_minutes ? Math.floor(selectedStep.time_estimate_minutes / 60) : ''}
                      onChange={e => {
                        const h = parseInt(e.target.value) || 0;
                        const m = (selectedStep.time_estimate_minutes ?? 0) % 60;
                        updateSelectedStep({ time_estimate_minutes: h * 60 + m || null });
                      }}
                      placeholder="0" className="w-16 text-sm border border-gray-200 rounded px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                    />
                    <span className="text-xs text-gray-400">h</span>
                    <input
                      type="number" min="0" max="59"
                      value={selectedStep.time_estimate_minutes ? selectedStep.time_estimate_minutes % 60 : ''}
                      onChange={e => {
                        const h = Math.floor((selectedStep.time_estimate_minutes ?? 0) / 60);
                        const m = parseInt(e.target.value) || 0;
                        updateSelectedStep({ time_estimate_minutes: h * 60 + m || null });
                      }}
                      placeholder="0" className="w-16 text-sm border border-gray-200 rounded px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                    />
                    <span className="text-xs text-gray-400">m</span>
                  </div>
                </div>

                {/* Email reminder */}
                <div className="border border-gray-200 rounded-lg p-3 bg-white">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStep.email_reminder_enabled}
                      onChange={e => updateSelectedStep({ email_reminder_enabled: e.target.checked })}
                      className="rounded"
                    />
                    <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Mail className="h-3.5 w-3.5 text-blue-500" /> Email Reminder
                    </span>
                  </label>

                  {selectedStep.email_reminder_enabled && (
                    <div className="mt-2.5 space-y-2">
                      {/* Summary */}
                      <div className="text-xs text-gray-500 space-y-0.5 leading-relaxed">
                        {selectedStep.email_reminder_config.recipients.length > 0
                          ? <p>To: {selectedStep.email_reminder_config.recipients.map(r => r === 'assignee' ? 'Team Member' : 'Client').join(' &amp; ')}</p>
                          : <p className="text-amber-600">⚠ No recipients selected</p>
                        }
                        <p>{TIMING_OPTIONS.find(o => o.value === selectedStep.email_reminder_config.timing)?.label ?? 'When assigned'}</p>
                        {selectedStep.email_reminder_subject && (
                          <p className="truncate text-gray-400">&ldquo;{selectedStep.email_reminder_subject}&rdquo;</p>
                        )}
                      </div>
                      <button
                        onClick={() => setShowEmailModal(true)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                      >
                        <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Edit Email</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Status automation — when this step reaches a status, change
                    the whole task's status (still overridable by hand). */}
                <div className="border border-gray-200 rounded-lg p-3 bg-white">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selectedStep.status_automation}
                      onChange={e => updateSelectedStep({
                        status_automation: e.target.checked
                          ? { on: 'complete', set_task_status: 'records_here' }
                          : null,
                      })}
                      className="rounded"
                    />
                    <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Zap className="h-3.5 w-3.5 text-indigo-500" /> Auto-change task status
                    </span>
                  </label>

                  {selectedStep.status_automation ? (
                    <div className="mt-2.5 space-y-2">
                      {/* Indicator chip */}
                      {(() => {
                        const on = selectedStep.status_automation.on;
                        const target = STATUS_TARGET_OPTIONS.find(o => o.value === selectedStep.status_automation!.set_task_status);
                        const trig = STATUS_TRIGGER_OPTIONS.find(o => o.value === on);
                        return (
                          <div className="flex items-center gap-1.5 text-xs text-gray-600 flex-wrap">
                            <span>When this step is <span className="font-medium">{trig?.label}</span> →</span>
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold border"
                              style={{ color: target?.color, borderColor: `${target?.color}55`, background: `${target?.color}14` }}
                            >
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: target?.color }} />
                              {target?.label}
                            </span>
                          </div>
                        );
                      })()}

                      {/* Scenario picker */}
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">When this step is</label>
                        <select
                          value={selectedStep.status_automation.on}
                          onChange={e => updateSelectedStep({
                            status_automation: { ...selectedStep.status_automation!, on: e.target.value as StepAutomationTrigger },
                          })}
                          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {STATUS_TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">Set the task status to</label>
                        <select
                          value={selectedStep.status_automation.set_task_status}
                          onChange={e => updateSelectedStep({
                            status_automation: { ...selectedStep.status_automation!, set_task_status: e.target.value as StepAutomationTargetStatus },
                          })}
                          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {STATUS_TARGET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Runs automatically — you can still change the task status by hand at any time. When every step is done the task completes regardless.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-gray-400 italic">
                      Task status stays automatic. Add a rule to move it (e.g. this step completes → Records Here).
                    </p>
                  )}
                </div>

                {/* Client portal — only shown when assignee_role is 'client' */}
                {selectedStep.assignee_role === 'client' && (
                  <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-sm font-medium text-amber-800">Client Portal</span>
                      <span className="text-[10px] text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200">Client step</span>
                    </div>
                    {/* Summary */}
                    <div className="text-xs text-amber-700 space-y-0.5 mb-2.5">
                      {selectedStep.client_instructions
                        ? <p className="line-clamp-2 leading-relaxed">{selectedStep.client_instructions}</p>
                        : <p className="italic text-amber-500">No instructions set yet</p>
                      }
                      {selectedStep.client_can_upload && (
                        <p className="flex items-center gap-1 text-amber-600"><Upload className="h-3 w-3" /> File upload enabled</p>
                      )}
                    </div>
                    <button
                      onClick={() => setShowClientModal(true)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-amber-100 border border-amber-300 text-amber-800 rounded-lg text-xs font-semibold hover:bg-amber-200 transition-colors"
                    >
                      <span className="flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5" /> Edit Client Request</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

              </div>
            )}

            {/* ── No step selected — issues panel + step list ── */}
            {!selectedStep && (
              <div className="p-4">
                <p className="text-xs text-gray-400 mb-4">Click a step on the canvas to configure it. Drag between step handles to connect them.</p>

                {/* Live issues panel */}
                {showIssuesPanel && steps.length > 0 && (() => {
                  const allIssues: StaticIssue[] = [...staticIssues];
                  const aiExtras = aiCheckResult?.issues.filter(ai =>
                    !staticIssues.some(s => s.step_key === ai.step_key && s.title === ai.title)
                  ) ?? [];
                  const combined = [...allIssues, ...aiExtras];
                  const errors   = combined.filter(i => i.severity === 'error');
                  const warnings = combined.filter(i => i.severity === 'warning');
                  const infos    = combined.filter(i => i.severity === 'info');
                  const sorted   = [...errors, ...warnings, ...infos];

                  return (
                    <div className="mb-4 border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                        <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                          {errors.length > 0 ? <AlertCircle className="h-3.5 w-3.5 text-red-500" /> : warnings.length > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> : <ShieldCheck className="h-3.5 w-3.5 text-green-500" />}
                          Flow Analysis
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={runAICheck}
                            disabled={aiCheckState === 'loading'}
                            className="flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-medium disabled:opacity-50"
                          >
                            {aiCheckState === 'loading'
                              ? <><Loader2 className="h-3 w-3 animate-spin" /> Checking…</>
                              : <><Sparkles className="h-3 w-3" /> {aiCheckState === 'done' ? 'Re-check' : 'AI check'}</>
                            }
                          </button>
                          <button onClick={() => setShowIssuesPanel(false)} className="text-gray-400 hover:text-gray-600 ml-1">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {aiCheckState === 'error' && (
                        <div className="px-3 py-2 text-[11px] text-red-600 bg-red-50 border-b border-red-100">
                          {aiCheckError} — <button onClick={runAICheck} className="underline">retry</button>
                        </div>
                      )}
                      {aiCheckState === 'done' && aiCheckResult && (
                        <div className="px-3 py-2 text-[11px] text-indigo-700 bg-indigo-50 border-b border-indigo-100 flex items-start gap-1.5">
                          <Sparkles className="h-3 w-3 flex-shrink-0 mt-0.5" />
                          <span>{aiCheckResult.summary}</span>
                        </div>
                      )}

                      {sorted.length === 0 ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-xs text-green-700">
                          <ShieldCheck className="h-4 w-4 text-green-500" /> No issues found — workflow looks good.
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                          {sorted.map((issue, i) => (
                            <div key={i} className="px-3 py-2.5">
                              <div className="flex items-start gap-1.5 mb-1">
                                {issue.severity === 'error'   && <AlertCircle  className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5"    />}
                                {issue.severity === 'warning' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />}
                                {issue.severity === 'info'    && <Info          className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5"   />}
                                <p className="text-xs font-semibold text-gray-800 leading-snug">{issue.title}</p>
                              </div>
                              <p className="text-[11px] text-gray-500 leading-relaxed mb-1.5 pl-5">{issue.description}</p>
                              <p className="text-[11px] text-gray-600 leading-relaxed pl-5">
                                <span className="font-medium">Fix:</span> {issue.fix}
                              </p>
                              {issue.step_key && (
                                <button
                                  onClick={() => setSelectedStepKey(issue.step_key!)}
                                  className="mt-1 pl-5 text-[11px] text-indigo-600 hover:underline font-medium"
                                >
                                  Select step →
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Step list — sorted in flow/connection order (topological sort) */}
                {(() => {
                  // ── Topological sort (Kahn's BFS) ─────────────────────────
                  const outgoing = new Map<string, string[]>(); // key → [targets]
                  const incoming = new Map<string, string[]>(); // key → [sources]
                  steps.forEach(s => { outgoing.set(s.step_key, []); incoming.set(s.step_key, []); });
                  edgesData.forEach(e => {
                    outgoing.get(e.from_step_key)?.push(e.to_step_key);
                    incoming.get(e.to_step_key)?.push(e.from_step_key);
                  });

                  // Seed queue with roots (in-degree 0), tie-break by canvas position
                  const inDegree = new Map<string, number>();
                  steps.forEach(s => inDegree.set(s.step_key, (incoming.get(s.step_key) ?? []).length));

                  const queue: string[] = steps
                    .filter(s => (inDegree.get(s.step_key) ?? 0) === 0)
                    .sort((a, b) => a.position_y !== b.position_y ? a.position_y - b.position_y : a.position_x - b.position_x)
                    .map(s => s.step_key);

                  const sorted: string[] = [];
                  const visited = new Set<string>();

                  while (queue.length > 0) {
                    const key = queue.shift()!;
                    if (visited.has(key)) continue;
                    visited.add(key);
                    sorted.push(key);
                    const children = (outgoing.get(key) ?? [])
                      .filter(k => !visited.has(k))
                      .sort((a, b) => {
                        const sa = steps.find(s => s.step_key === a);
                        const sb = steps.find(s => s.step_key === b);
                        return (sa?.position_y ?? 0) !== (sb?.position_y ?? 0)
                          ? (sa?.position_y ?? 0) - (sb?.position_y ?? 0)
                          : (sa?.position_x ?? 0) - (sb?.position_x ?? 0);
                      });
                    children.forEach(k => {
                      const deg = (inDegree.get(k) ?? 1) - 1;
                      inDegree.set(k, deg);
                      if (deg === 0) queue.push(k);
                    });
                  }

                  // Append any unvisited keys (cycles / orphans not reachable from roots)
                  steps.forEach(s => { if (!visited.has(s.step_key)) sorted.push(s.step_key); });

                  // ── Build display items ────────────────────────────────────
                  interface FlowItem {
                    step: TemplateStepData;
                    num: number;
                    isSplit: boolean;   // out-degree > 1
                    isMerge: boolean;   // in-degree > 1
                    isOrphan: boolean;  // no connections at all
                    branchSymbol: '├─' | '└─' | null;
                    indented: boolean;
                  }

                  // For each split node, determine which of its children get branch symbols
                  const branchOf = new Map<string, { parent: string; isLast: boolean }>();
                  steps.forEach(s => {
                    const children = outgoing.get(s.step_key) ?? [];
                    if (children.length > 1) {
                      // Sort children by their position in sorted[] for consistent symbol assignment
                      const ordered = [...children].sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b));
                      ordered.forEach((k, idx) => {
                        branchOf.set(k, { parent: s.step_key, isLast: idx === ordered.length - 1 });
                      });
                    }
                  });

                  const items: FlowItem[] = sorted.map((key, idx) => {
                    const step = steps.find(s => s.step_key === key)!;
                    const outDeg = (outgoing.get(key) ?? []).length;
                    const inDeg = (incoming.get(key) ?? []).length;
                    const branch = branchOf.get(key);
                    return {
                      step,
                      num: idx + 1,
                      isSplit: outDeg > 1,
                      isMerge: inDeg > 1,
                      isOrphan: outDeg === 0 && inDeg === 0 && steps.length > 1,
                      branchSymbol: branch ? (branch.isLast ? '└─' : '├─') : null,
                      indented: !!branch,
                    };
                  });

                  // Sort connections list by from-step topological index
                  const sortedEdges = [...edgesData].sort((a, b) =>
                    sorted.indexOf(a.from_step_key) - sorted.indexOf(b.from_step_key)
                  );

                  return (
                    <>
                      <div className="space-y-0.5">
                        {items.map((item) => (
                          <div key={item.step.step_key}>
                            {/* Split indicator above this node if it has multiple incoming */}
                            {item.isMerge && (
                              <div className="flex items-center gap-1 px-2 py-0.5">
                                <span className="text-[10px] text-indigo-400 font-medium ml-7">↘↙ merge</span>
                              </div>
                            )}
                            <button
                              onClick={() => setSelectedStepKey(item.step.step_key)}
                              className="w-full flex items-center gap-1.5 rounded px-2 py-2 hover:bg-white text-left border border-transparent hover:border-gray-200"
                            >
                              <span className="text-xs text-gray-300 w-5 text-center flex-shrink-0 font-mono">{item.num}</span>
                              {item.branchSymbol && (
                                <span className="text-xs text-indigo-400 font-mono flex-shrink-0">{item.branchSymbol}</span>
                              )}
                              <span className={`text-sm text-gray-700 truncate ${item.indented ? 'pl-1' : ''}`}>
                                {item.step.title}
                              </span>
                              <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                                {item.isOrphan && <Tooltip label="Not connected" side="top"><span className="text-[10px] text-amber-500">⚠</span></Tooltip>}
                                {item.isSplit && <Tooltip label="Splits into multiple paths" side="top"><span className="text-[10px] text-indigo-400 font-medium">split</span></Tooltip>}
                                {item.step.email_reminder_enabled && <Mail className="h-3.5 w-3.5 text-blue-400" />}
                                {item.step.tool_module_id && <Puzzle className="h-3.5 w-3.5 text-indigo-400" />}
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>

                      {sortedEdges.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-gray-400">Connections ({sortedEdges.length})</p>
                            {sortedEdges.some(e => !e.condition_type) && (
                              <span className="text-[10px] text-red-500 font-medium">
                                {sortedEdges.filter(e => !e.condition_type).length} need conditions
                              </span>
                            )}
                          </div>
                          <div className="space-y-0.5">
                            {sortedEdges.map((e, i) => {
                              const fromTitle = steps.find(s => s.step_key === e.from_step_key)?.title ?? e.from_step_key;
                              const toTitle = steps.find(s => s.step_key === e.to_step_key)?.title ?? e.to_step_key;
                              const conditionColor = e.condition_type === 'on_complete' ? '#16a34a' : e.condition_type === 'timeout' ? '#d97706' : e.condition_type === 'always' ? '#6b7280' : '#ef4444';
                              const conditionLabel = e.condition_type === 'on_complete' ? 'On complete' : e.condition_type === 'timeout' ? 'After delay' : e.condition_type === 'always' ? 'Always' : 'Set condition';
                              return (
                                <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500 group rounded px-1 py-1.5 hover:bg-white">
                                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: conditionColor }} />
                                  <span className="truncate flex-1 min-w-0">{fromTitle} → {toTitle}</span>
                                  <button
                                    onClick={() => setConditionEdge({ from: e.from_step_key, to: e.to_step_key })}
                                    className="text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 font-medium hover:underline"
                                    style={{ color: conditionColor }}
                                  >
                                    {conditionLabel}
                                  </button>
                                  <button onClick={() => deleteEdge(e.from_step_key, e.to_step_key)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 flex-shrink-0">
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Test run overlay */}
    {showTestRun && (
      <TaskTemplateTestRun
        steps={steps}
        edges={edgesData}
        templateName={name || 'Untitled Template'}
        onClose={() => setShowTestRun(false)}
      />
    )}

    {/* AI edit overlay */}
    {showAIEdit && (
      <AITemplateBuilder
        teamMembers={teamMembers}
        existingTemplate={{
          name,
          description,
          is_firm_wide: isFirmWide,
          category,
          recurrence_type: recurrence || null,
          estimated_duration_days: estimatedDays ? Number(estimatedDays) : null,
          steps,
          edges: edgesData,
        }}
        onOpenInEditor={data => {
          setName(data.name);
          setDescription(data.description ?? '');
          setCategory(data.category);
          setRecurrence((data.recurrence_type as RecurrenceType) ?? '');
          setEstimatedDays(String(data.estimated_duration_days ?? ''));
          setSteps(data.steps);
          setEdgesData(data.edges);
          setShowAIEdit(false);
        }}
        onClose={() => setShowAIEdit(false)}
      />
    )}

    {/* Email editor modal */}
    {showEmailModal && selectedStep && (
      <EmailEditorModal
        step={selectedStep}
        templateName={name || 'Untitled Template'}
        onUpdate={updateSelectedStep}
        onClose={() => setShowEmailModal(false)}
      />
    )}

    {/* Client portal editor modal */}
    {showClientModal && selectedStep && (
      <ClientPortalEditorModal
        step={selectedStep}
        templateName={name || 'Untitled Template'}
        onUpdate={updateSelectedStep}
        onClose={() => setShowClientModal(false)}
      />
    )}

    {/* Condition editor modal */}
    {conditionEdge && (() => {
      const edgeEntry = edgesData.find(e => e.from_step_key === conditionEdge.from && e.to_step_key === conditionEdge.to);
      const fromTitle = steps.find(s => s.step_key === conditionEdge.from)?.title ?? conditionEdge.from;
      const toTitle = steps.find(s => s.step_key === conditionEdge.to)?.title ?? conditionEdge.to;
      return (
        <ConditionModal
          fromTitle={fromTitle}
          toTitle={toTitle}
          currentType={edgeEntry?.condition_type ?? null}
          currentConfig={edgeEntry?.condition_config ?? null}
          onSave={(type, config) => {
            setEdgesData(prev => prev.map(e =>
              e.from_step_key === conditionEdge.from && e.to_step_key === conditionEdge.to
                ? { ...e, condition_type: type, condition_config: config }
                : e
            ));
            setConditionEdge(null);
          }}
          onClose={() => setConditionEdge(null)}
        />
      );
    })()}

    {/* Propagation choice modal — shown when saving edits to a template with active tasks */}
    {propagationModal && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
          <h3 className="text-base font-bold text-gray-900">Apply changes to existing tasks?</h3>
          <p className="text-sm text-gray-600 mt-1.5">
            <strong>{propagationModal.activeCount}</strong> active task{propagationModal.activeCount !== 1 ? 's are' : ' is'} currently using this template.
            How would you like to handle them?
          </p>
          <div className="mt-4 space-y-2">
            <button
              onClick={() => propagationModal.resolve('new')}
              className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <p className="text-sm font-semibold text-gray-900">Only future tasks</p>
              <p className="text-xs text-gray-500 mt-0.5">Existing tasks keep their current setup. The new template applies only to tasks created from now on.</p>
            </button>
            <button
              onClick={() => propagationModal.resolve('existing')}
              className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <p className="text-sm font-semibold text-gray-900">Merge into existing tasks too</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Updates titles/descriptions on matching steps, adds any new template steps that are missing,
                and leaves per-client custom steps and any removed-template steps in place.
              </p>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => propagationModal.resolve(null)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
