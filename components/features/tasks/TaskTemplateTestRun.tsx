'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, Play, Pause, ChevronLeft, ChevronRight, RotateCcw,
  Mail, Puzzle, Clock, User, CheckCircle2, Circle, Zap,
  UserCheck, Upload, Eye, ArrowRight, ExternalLink,
} from 'lucide-react';
import { TaskViewFlowChart } from './TaskFlowChart';
import { MODULES } from '@/config/modules.config';
import { resolveMergeTags, MERGE_TAGS, type MergeTagContext } from '@/lib/emailMergeTags';
import type { TaskStep, TaskStepEdge } from '@/types';
import type { TemplateStepData, TemplateEdgeData } from './TemplateBuilder';

// ── Example context ───────────────────────────────────────────────────────────

const EXAMPLE_CONTEXT: MergeTagContext = Object.fromEntries(
  MERGE_TAGS.map(t => [t.tag.replace(/\{\{|\}\}/g, ''), t.example])
) as MergeTagContext;
Object.assign(EXAMPLE_CONTEXT, {
  client_name:    'Acme Ltd',
  client_ref:     'ACM001',
  business_type:  'limited_company',
  year_end:       '31 MAR',
  recipient_name: 'John Smith',
  due_date:       null,
});

// ── Topological sort ──────────────────────────────────────────────────────────

function topoSort(steps: TemplateStepData[], edges: TemplateEdgeData[]): TemplateStepData[] {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  steps.forEach(s => { outgoing.set(s.step_key, []); incoming.set(s.step_key, []); });
  edges.forEach(e => {
    outgoing.get(e.from_step_key)?.push(e.to_step_key);
    incoming.get(e.to_step_key)?.push(e.from_step_key);
  });
  const inDeg = new Map<string, number>();
  steps.forEach(s => inDeg.set(s.step_key, (incoming.get(s.step_key) ?? []).length));
  const queue = steps
    .filter(s => (inDeg.get(s.step_key) ?? 0) === 0)
    .sort((a, b) => a.position_y !== b.position_y ? a.position_y - b.position_y : a.position_x - b.position_x)
    .map(s => s.step_key);
  const sorted: TemplateStepData[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const step = steps.find(s => s.step_key === key);
    if (step) sorted.push(step);
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
      const d = (inDeg.get(k) ?? 1) - 1;
      inDeg.set(k, d);
      if (d === 0) queue.push(k);
    });
  }
  steps.forEach(s => { if (!visited.has(s.step_key)) sorted.push(s); });
  return sorted;
}

const SPEEDS = { slow: 3000, normal: 1800, fast: 900 } as const;

// ── Email lightbox ────────────────────────────────────────────────────────────

interface EmailLightboxProps {
  step: TemplateStepData;
  templateName: string;
  onClose: () => void;
  onContinue: () => void;
  hasClient: boolean;
}

function EmailLightbox({ step, templateName, onClose, onContinue, hasClient }: EmailLightboxProps) {
  const ctx: MergeTagContext = { ...EXAMPLE_CONTEXT, step_title: step.title, task_title: templateName };
  const subject = step.email_reminder_subject
    ? resolveMergeTags(step.email_reminder_subject, ctx)
    : `[SMITH] Reminder: ${step.title} — ${templateName}`;
  const message = step.email_reminder_message
    ? resolveMergeTags(step.email_reminder_message, ctx)
    : null;
  const recipients = step.email_reminder_config.recipients;

  const recipientLabel = recipients.includes('client') ? 'Acme Ltd (client)' : 'John Smith (assignee)';
  const toAddress = recipients.includes('client') ? 'accounts@acmeltd.com' : 'john.smith@yourfirm.com';

  return (
    <div className="absolute inset-0 z-20 bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-full flex flex-col overflow-hidden">

        {/* Lightbox header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-blue-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Mail className="h-4.5 w-4.5" />
            <div>
              <p className="text-sm font-bold">Email Preview</p>
              <p className="text-blue-200 text-xs">Sent to: {recipientLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-blue-500 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Email chrome — mimics a real email client */}
        <div className="flex-1 overflow-y-auto">
          {/* Email header strip */}
          <div className="border-b border-gray-200 px-5 py-3 bg-gray-50 space-y-1 text-xs">
            <div className="flex gap-2">
              <span className="text-gray-400 w-14 flex-shrink-0">From</span>
              <span className="text-gray-700 font-medium">SMITH &lt;noreply@smithapp.co.uk&gt;</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-400 w-14 flex-shrink-0">To</span>
              <span className="text-gray-700">{toAddress}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-400 w-14 flex-shrink-0">Subject</span>
              <span className="text-gray-900 font-semibold">{subject}</span>
            </div>
          </div>

          {/* Email body — matches exactly what lib/email.ts sends */}
          <div className="p-5 bg-white">
            <div className="max-w-[520px] mx-auto border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              {/* Brand header */}
              <div className="bg-indigo-600 px-6 py-5">
                <h1 className="text-white text-lg font-semibold m-0">SMITH — Task Reminder</h1>
              </div>
              {/* Body */}
              <div className="px-6 py-5 space-y-4 bg-white">
                <p className="text-gray-900 text-base m-0">Hello John Smith,</p>
                <p className="text-gray-600 text-sm">You have a task step that requires your attention:</p>
                {/* Task card */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1.5">
                  <p className="text-gray-900 font-semibold text-base">{templateName}</p>
                  <p className="text-gray-500 text-sm">Step: <span className="text-gray-700">{step.title}</span></p>
                  <p className="text-gray-500 text-sm">Client: <span className="text-gray-700 font-medium">Acme Ltd</span></p>
                </div>
                {message && (
                  <p className="text-gray-600 text-sm whitespace-pre-line leading-relaxed">{message}</p>
                )}
                {/* CTA button */}
                <div>
                  {step.assignee_role === 'client' ? (
                    <div className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
                      <ExternalLink className="h-3.5 w-3.5" /> View &amp; Complete Task
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
                      View Task
                    </div>
                  )}
                  {step.assignee_role === 'client' && (
                    <p className="text-xs text-gray-400 mt-2">This links to your secure client portal page</p>
                  )}
                </div>
              </div>
              {/* Footer */}
              <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
                <p className="text-xs text-gray-400">
                  This reminder was sent from SMITH. You are receiving this because you are assigned to this task step.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <p className="text-xs text-gray-400">Example data — no real email is sent</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
              Close
            </button>
            <button
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {hasClient ? 'Next: Client portal →' : 'Continue test →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Client portal lightbox ────────────────────────────────────────────────────

interface ClientPortalLightboxProps {
  step: TemplateStepData;
  templateName: string;
  onClose: () => void;
  onContinue: () => void;
}

function ClientPortalLightbox({ step, templateName, onClose, onContinue }: ClientPortalLightboxProps) {
  const instructions = step.client_instructions ?? step.description;

  return (
    <div className="absolute inset-0 z-20 bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-full flex flex-col overflow-hidden">

        {/* Lightbox header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-amber-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <UserCheck className="h-4.5 w-4.5" />
            <div>
              <p className="text-sm font-bold">Client Portal Preview</p>
              <p className="text-amber-200 text-xs">What Acme Ltd sees when they click the link</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-amber-500 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Client portal render */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {/* Firm header */}
          <header className="bg-white border-b border-gray-200 px-5 py-3.5 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              F
            </div>
            <span className="text-sm font-semibold text-gray-900">Your Firm Name</span>
            <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Secure link</span>
          </header>

          <div className="p-5 space-y-4">
            {/* Task context */}
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
              {templateName} · Acme Ltd
            </p>

            {/* Main card */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              {/* Step header */}
              <div className="bg-indigo-600 px-5 py-4">
                <p className="text-indigo-200 text-xs font-medium uppercase tracking-wide mb-1">Action required from you</p>
                <h2 className="text-white text-lg font-bold leading-snug">{step.title}</h2>
                {step.time_estimate_minutes && (
                  <p className="text-indigo-200 text-xs mt-1.5 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Estimated: {step.time_estimate_minutes < 60 ? `${step.time_estimate_minutes} minutes` : `${Math.floor(step.time_estimate_minutes / 60)} hour${Math.floor(step.time_estimate_minutes / 60) > 1 ? 's' : ''}`}
                  </p>
                )}
              </div>

              <div className="p-5 space-y-4">
                {/* Instructions */}
                {instructions ? (
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{instructions}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No client instructions added yet — add them in the step editor under &quot;Client Portal&quot;.</p>
                )}

                {/* File upload zone */}
                {step.client_can_upload && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Attach files <span className="text-gray-400 font-normal">(optional)</span>
                    </p>
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center bg-gray-50">
                      <Upload className="h-5 w-5 text-gray-300 mx-auto mb-1.5" />
                      <p className="text-sm text-gray-500">Drop files here or <span className="text-indigo-600 font-medium">browse</span></p>
                      <p className="text-xs text-gray-400 mt-0.5">PDF, images, spreadsheets · Max 20 MB each</p>
                    </div>
                  </div>
                )}

                {/* Mark as done button */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold text-sm shadow-sm">
                    <CheckCircle2 className="h-4 w-4" /> Mark as done
                  </div>
                </div>

                <p className="text-center text-xs text-gray-400">
                  Clicking this will notify your accountant that this step is complete.
                </p>
              </div>
            </div>

            {/* Expiry notice */}
            <p className="text-center text-xs text-gray-400">
              Secure link · Expires 30 days after being sent · Powered by SMITH
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <p className="text-xs text-gray-400">Example data — the real page uses live client info</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
              Close
            </button>
            <button
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors"
            >
              Continue test →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  steps: TemplateStepData[];
  edges: TemplateEdgeData[];
  templateName: string;
  onClose: () => void;
}

// What to show in the lightbox for the current step
type LightboxStage = 'email' | 'client' | null;

export default function TaskTemplateTestRun({ steps, edges, templateName, onClose }: Props) {
  const sortedSteps = useMemo(() => topoSort(steps, edges), [steps, edges]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [completed, setCompleted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lightbox state
  const [lightbox, setLightbox] = useState<LightboxStage>(null);
  // Track which step index we've already auto-shown a lightbox for (so we don't re-trigger on re-render)
  const autoShownRef = useRef<number>(-1);

  const currentStep = sortedSteps[currentIdx] ?? null;

  const hasEmail  = !!currentStep?.email_reminder_enabled;
  const hasClient = currentStep?.assignee_role === 'client';

  // Auto-show lightbox when step changes — always, whether playing or navigating manually
  useEffect(() => {
    if (completed || !currentStep) return;
    if (autoShownRef.current === currentIdx) return; // already shown for this step
    autoShownRef.current = currentIdx;

    if (hasEmail) {
      setPlaying(false);
      setLightbox('email');
    } else if (hasClient) {
      setPlaying(false);
      setLightbox('client');
    } else {
      setLightbox(null);
    }
  }, [currentIdx, currentStep, completed, hasEmail, hasClient]);

  // Auto-advance timer (only runs when lightbox is closed)
  useEffect(() => {
    if (!playing || lightbox) return;
    timerRef.current = setTimeout(() => {
      if (currentIdx < sortedSteps.length - 1) {
        setCurrentIdx(i => i + 1);
      } else {
        setPlaying(false);
        setCompleted(true);
      }
    }, SPEEDS[speed]);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, currentIdx, sortedSteps.length, speed, lightbox]);

  const handlePlay  = () => { setCompleted(false); setLightbox(null); setPlaying(true); };
  const handlePause = () => setPlaying(false);
  const handlePrev  = () => {
    setPlaying(false); setLightbox(null);
    setCurrentIdx(i => { const next = Math.max(0, i - 1); autoShownRef.current = -1; return next; });
    setCompleted(false);
  };
  const handleNext  = () => {
    setPlaying(false); setLightbox(null);
    if (currentIdx < sortedSteps.length - 1) { autoShownRef.current = -1; setCurrentIdx(i => i + 1); }
    else setCompleted(true);
  };
  const handleReset = () => {
    setPlaying(false); setCurrentIdx(0); setCompleted(false);
    setLightbox(null); autoShownRef.current = -1;
  };
  const handleStepClick = useCallback((stepId: string) => {
    setPlaying(false); setLightbox(null);
    const idx = sortedSteps.findIndex(s => s.step_key === stepId);
    if (idx !== -1) { autoShownRef.current = -1; setCurrentIdx(idx); }
    setCompleted(false);
  }, [sortedSteps]);

  // Lightbox "Continue" logic — if step has both email AND client, sequence through both
  function handleEmailContinue() {
    if (hasClient) {
      setLightbox('client'); // show client portal next
    } else {
      setLightbox(null);
      setPlaying(true); // resume
    }
  }
  function handleClientContinue() {
    setLightbox(null);
    setPlaying(true); // resume
  }
  // Manual re-open buttons
  function openPreview(type: LightboxStage) {
    setPlaying(false);
    setLightbox(type);
  }

  // Flowchart step statuses
  const viewSteps: TaskStep[] = useMemo(() => sortedSteps.map((s, idx) => ({
    id: s.step_key,
    task_id: '',
    template_step_id: null,
    step_key: s.step_key,
    title: s.title,
    description: s.description ?? null,
    assignee_id: s.default_assignee_id ?? null,
    is_client_step: s.assignee_role === 'client',
    status: completed || idx < currentIdx ? 'complete' : idx === currentIdx ? 'in_progress' : 'not_started',
    tool_module_id: s.tool_module_id ?? null,
    tool_output_id: null,
    email_reminder_enabled: s.email_reminder_enabled,
    email_reminder_config: s.email_reminder_config,
    email_reminder_subject: s.email_reminder_subject ?? null,
    email_reminder_message: s.email_reminder_message ?? null,
    client_instructions: s.client_instructions ?? null,
    client_can_upload: s.client_can_upload ?? false,
    due_date: null,
    completed_at: null,
    position_x: s.position_x,
    position_y: s.position_y,
    created_at: '',
    updated_at: '',
    assignee: null,
  })), [sortedSteps, currentIdx, completed]);

  const viewEdges: TaskStepEdge[] = useMemo(() => edges.map((e, i) => ({
    id: `e-${i}`,
    task_id: '',
    from_step_key: e.from_step_key,
    to_step_key: e.to_step_key,
    label: e.label ?? null,
  })), [edges]);

  const module = currentStep?.tool_module_id ? MODULES.find(m => m.id === currentStep.tool_module_id) : null;
  const progressPct = sortedSteps.length > 1
    ? ((completed ? sortedSteps.length : currentIdx) / (sortedSteps.length - 1)) * 100
    : 100;
  const assigneeLabel = !currentStep ? '' :
    currentStep.assignee_role === 'client' ? 'Client' :
    currentStep.assignee_role === 'team_member' ? 'Team Member' : 'Anyone';
  const formatTime = (mins: number) =>
    mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 bg-indigo-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-indigo-200" />
            <div>
              <h2 className="text-base font-bold">Test Run — {templateName}</h2>
              <p className="text-indigo-200 text-xs mt-0.5">
                Simulating with example client data &nbsp;·&nbsp; {sortedSteps.length} steps
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-indigo-500 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Flowchart panel — lightboxes render absolutely over this */}
          <div className="flex-1 relative bg-gray-50 border-r border-gray-200 min-w-0">
            <TaskViewFlowChart steps={viewSteps} edges={viewEdges} onStepClick={handleStepClick} />

            {/* Step label */}
            {currentStep && !completed && !lightbox && (
              <div className="absolute top-3 left-3 bg-white border border-indigo-200 rounded-xl shadow-md px-3 py-2 pointer-events-none max-w-[220px]">
                <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wide mb-0.5">
                  Step {currentIdx + 1} of {sortedSteps.length}
                </p>
                <p className="text-sm font-semibold text-gray-800 leading-tight">{currentStep.title}</p>
              </div>
            )}

            {/* Preview buttons — shown when lightbox is closed but step has previewable content */}
            {currentStep && !completed && !lightbox && (hasEmail || hasClient) && (
              <div className="absolute top-3 right-3 flex flex-col gap-1.5">
                {hasEmail && (
                  <button
                    onClick={() => openPreview('email')}
                    className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow hover:bg-blue-700 transition-colors"
                  >
                    <Eye className="h-3 w-3" /> Preview email
                  </button>
                )}
                {hasClient && (
                  <button
                    onClick={() => openPreview('client')}
                    className="flex items-center gap-1.5 bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow hover:bg-amber-700 transition-colors"
                  >
                    <Eye className="h-3 w-3" /> Preview client page
                  </button>
                )}
              </div>
            )}

            {/* Completed overlay */}
            {completed && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-sm">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-10 w-10 text-green-500" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Flow Complete</h3>
                  <p className="text-gray-500 text-sm mt-1">All {sortedSteps.length} steps processed successfully</p>
                  <button onClick={handleReset} className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                    <RotateCcw className="h-4 w-4" /> Run Again
                  </button>
                </div>
              </div>
            )}

            {/* ── Lightboxes ── */}
            {lightbox === 'email' && currentStep && (
              <EmailLightbox
                step={currentStep}
                templateName={templateName}
                onClose={() => setLightbox(null)}
                onContinue={handleEmailContinue}
                hasClient={hasClient}
              />
            )}
            {lightbox === 'client' && currentStep && (
              <ClientPortalLightbox
                step={currentStep}
                templateName={templateName}
                onClose={() => setLightbox(null)}
                onContinue={handleClientContinue}
              />
            )}
          </div>

          {/* ── Right panel ──────────────────────────────────────────────── */}
          <div className="w-80 flex flex-col bg-white overflow-hidden flex-shrink-0">

            {/* Progress bar */}
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-semibold text-gray-500">
                  {completed ? 'Complete' : `Step ${currentIdx + 1} of ${sortedSteps.length}`}
                </span>
                <span className="text-xs text-gray-400">{Math.round(progressPct)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">

              {/* Current step info */}
              {currentStep && !completed && (
                <div className="p-4 space-y-3 border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{currentStep.title}</h3>
                    {currentStep.description && (
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{currentStep.description}</p>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                      currentStep.assignee_role === 'client'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : currentStep.assignee_role === 'any'
                        ? 'bg-gray-50 text-gray-600 border-gray-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}>
                      {currentStep.assignee_role === 'client' ? <UserCheck className="h-3 w-3" /> : <User className="h-3 w-3" />}
                      {assigneeLabel}
                    </span>
                    {currentStep.time_estimate_minutes && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                        <Clock className="h-3 w-3" /> {formatTime(currentStep.time_estimate_minutes)}
                      </span>
                    )}
                  </div>

                  {/* Preview buttons (right panel) */}
                  {(hasEmail || hasClient || module) && (
                    <div className="space-y-1.5 pt-1">
                      {hasEmail && (
                        <button
                          onClick={() => openPreview('email')}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors text-left"
                        >
                          <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="flex-1">Preview email reminder</span>
                          <Eye className="h-3 w-3 text-blue-400 flex-shrink-0" />
                        </button>
                      )}
                      {hasClient && (
                        <button
                          onClick={() => openPreview('client')}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors text-left"
                        >
                          <UserCheck className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="flex-1">Preview client portal page</span>
                          <Eye className="h-3 w-3 text-amber-400 flex-shrink-0" />
                        </button>
                      )}
                      {module && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-indigo-100 bg-indigo-50">
                          <Puzzle className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-indigo-700">{module.name}</p>
                            <p className="text-[11px] text-indigo-500 leading-relaxed mt-0.5 line-clamp-2">{module.description}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step list */}
              <div className="px-4 py-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">All Steps</p>
                <div className="space-y-0.5">
                  {sortedSteps.map((s, idx) => {
                    const isPast    = completed || idx < currentIdx;
                    const isCurrent = !completed && idx === currentIdx;
                    return (
                      <button
                        key={s.step_key}
                        onClick={() => handleStepClick(s.step_key)}
                        className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                          isCurrent ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50 text-gray-500'
                        }`}
                      >
                        {isPast ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        ) : isCurrent ? (
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-indigo-500 bg-indigo-100 flex-shrink-0" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-gray-200 flex-shrink-0" />
                        )}
                        <span className={`truncate ${isCurrent ? 'font-semibold' : ''}`}>{s.title}</span>
                        <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">
                          {s.email_reminder_enabled && <Mail className="h-3 w-3 text-blue-300" />}
                          {s.tool_module_id && <Puzzle className="h-3 w-3 text-indigo-300" />}
                          {s.assignee_role === 'client' && <UserCheck className="h-3 w-3 text-amber-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="px-4 pb-4">
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Legend</p>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500"><Mail className="h-3 w-3 text-blue-400 flex-shrink-0" /> Email reminder sent</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500"><Puzzle className="h-3 w-3 text-indigo-400 flex-shrink-0" /> AI tool runs</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500"><UserCheck className="h-3 w-3 text-amber-400 flex-shrink-0" /> Client action required</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="border-t border-gray-200 px-6 py-3 bg-gray-50 flex items-center gap-3 rounded-b-2xl flex-shrink-0">
          {/* Speed */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 mr-1">Speed:</span>
            {(['slow', 'normal', 'fast'] as const).map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  speed === s ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1" />

          {/* Playback */}
          <div className="flex items-center gap-1.5">
            <button onClick={handleReset} title="Reset" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={handlePrev} disabled={currentIdx === 0 && !completed} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {playing ? (
              <button onClick={handlePause} className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm">
                <Pause className="h-4 w-4" /> Pause
              </button>
            ) : (
              <button onClick={completed ? handleReset : handlePlay} className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm">
                {completed ? <><RotateCcw className="h-4 w-4" /> Run Again</> : currentIdx === 0 ? <><Play className="h-4 w-4" /> Run Test</> : <><Play className="h-4 w-4" /> Resume</>}
              </button>
            )}
            <button onClick={handleNext} disabled={completed} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1" />
          <p className="text-[10px] text-gray-400 text-right leading-tight">Using example data<br />Real emails are not sent</p>
        </div>
      </div>
    </div>
  );
}
