'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, Play, Pause, ChevronLeft, ChevronRight, RotateCcw,
  Mail, Puzzle, Clock, User, CheckCircle2, Circle, Zap,
  UserCheck, Upload, Eye, ArrowRight, ExternalLink,
  Sparkles, AlertTriangle, AlertCircle, Info, Loader2,
} from 'lucide-react';
import { TaskViewFlowChart } from './TaskFlowChart';
import { MODULES } from '@/config/modules.config';
import { resolveMergeTags, MERGE_TAGS, type MergeTagContext } from '@/lib/emailMergeTags';
import type { TaskStep, TaskStepEdge } from '@/types';
import type { TemplateStepData, TemplateEdgeData } from './TemplateBuilder';
import type { FlowIssue, FlowAnalysis } from '@/app/api/tasks/templates/ai-check/route';

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

// ── Static flow analysis (client-side, instant) ───────────────────────────────

export interface StaticIssue {
  severity: 'error' | 'warning' | 'info';
  step_key: string | null;
  title: string;
  description: string;
  fix: string;
}

export function runStaticAnalysis(steps: TemplateStepData[], edges: TemplateEdgeData[]): StaticIssue[] {
  const issues: StaticIssue[] = [];

  // 1. Timeout edges from team_member steps
  edges.filter(e => e.condition_type === 'timeout').forEach(e => {
    const fromStep = steps.find(s => s.step_key === e.from_step_key);
    if (fromStep && fromStep.assignee_role === 'team_member') {
      issues.push({
        severity: 'warning',
        step_key: e.from_step_key,
        title: `Timeout fires from a team step`,
        description: `The timeout on "${fromStep.title}" will trigger almost immediately — team members complete their steps quickly. The timeout is probably meant to wait for a client to respond.`,
        fix: `Move this timeout edge to start from the client step that follows "${fromStep.title}" instead.`,
      });
    }
  });

  // 2. Dead ends (no outgoing edges, but not a lone step)
  const stepsWithOutgoing = new Set(edges.map(e => e.from_step_key));
  if (steps.length > 1) {
    steps.forEach(s => {
      if (!stepsWithOutgoing.has(s.step_key)) {
        issues.push({
          severity: 'warning',
          step_key: s.step_key,
          title: `"${s.title}" has no next step`,
          description: `This step has no outgoing connections. The workflow will stop here permanently unless this is the intended final step.`,
          fix: `Connect this step to the next step, or confirm it is intentionally the end of the workflow.`,
        });
      }
    });
  }

  // 3. Orphaned steps (no incoming edges, not the first step)
  const stepsWithIncoming = new Set(edges.map(e => e.to_step_key));
  const rootSteps = steps.filter(s => !stepsWithIncoming.has(s.step_key));
  if (rootSteps.length > 1) {
    rootSteps.slice(1).forEach(s => {
      issues.push({
        severity: 'warning',
        step_key: s.step_key,
        title: `"${s.title}" is unreachable`,
        description: `This step has no incoming connections, so the workflow will never reach it.`,
        fix: `Connect this step to its predecessor, or remove it if it is no longer needed.`,
      });
    });
  }

  // 4. Unconfigured edges
  const unconfigured = edges.filter(e => !e.condition_type);
  if (unconfigured.length > 0) {
    issues.push({
      severity: 'error',
      step_key: null,
      title: `${unconfigured.length} connection${unconfigured.length > 1 ? 's' : ''} missing a condition`,
      description: `Connections without a condition type will block the workflow — the system won't know when to move forward.`,
      fix: `Hover over each red dashed connection on the canvas and click "Add Condition" to configure it.`,
    });
  }

  // 5. Email reminders with no recipients
  steps.filter(s => s.email_reminder_enabled && !(s.email_reminder_config?.recipients?.length)).forEach(s => {
    issues.push({
      severity: 'warning',
      step_key: s.step_key,
      title: `Email reminder on "${s.title}" has no recipients`,
      description: `This step has an email reminder enabled but no recipients are selected, so no email will ever be sent.`,
      fix: `Open the Email Reminder editor for this step and select who should receive it.`,
    });
  });

  // 6. Client steps with no instructions
  steps.filter(s => s.assignee_role === 'client' && !s.client_instructions && !s.description).forEach(s => {
    issues.push({
      severity: 'info',
      step_key: s.step_key,
      title: `Client step "${s.title}" has no instructions`,
      description: `When the client opens their portal page for this step they will see a blank description.`,
      fix: `Click this step and open "Edit Client Request" to add instructions for the client.`,
    });
  });

  // 7. Chaser step with no loop-back edge
  const chaserKeys = steps
    .filter(s => s.title.toLowerCase().includes('chas') || s.title.toLowerCase().includes('reminder') || s.title.toLowerCase().includes('chase'))
    .map(s => s.step_key);
  chaserKeys.forEach(key => {
    const hasAlwaysBack = edges.some(e => e.from_step_key === key && e.condition_type === 'always');
    if (!hasAlwaysBack) {
      const step = steps.find(s => s.step_key === key);
      issues.push({
        severity: 'warning',
        step_key: key,
        title: `Chaser step "${step?.title}" has no loop-back`,
        description: `After the chaser is sent, there is no "always" edge returning to the waiting step. The workflow will dead-end after the chaser fires.`,
        fix: `Add an "Always" connection from this chaser step back to the client step it is waiting on.`,
      });
    }
  });

  return issues;
}

// ── Per-step narration ────────────────────────────────────────────────────────

interface Narration {
  headline: string;
  body: string;
  extras: string[];
  perspective: 'team' | 'client';
}

function buildNarration(
  step: TemplateStepData,
  prevStep: TemplateStepData | null,
  connectingEdge: TemplateEdgeData | null,
): Narration {
  let prefix = '';
  if (connectingEdge?.condition_type === 'timeout') {
    const d = connectingEdge.condition_config?.timeout_days;
    const h = connectingEdge.condition_config?.timeout_hours;
    const timeStr = d ? `${d} ${d === 1 ? 'day' : 'days'}` : h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : 'the time limit';
    prefix = `No response after ${timeStr} — `;
  }

  const isClient = step.assignee_role === 'client';

  let headline: string;
  let body: string;

  if (isClient) {
    headline = prefix + 'Waiting for the client';
    const instrText = step.client_instructions ?? step.description;
    body = instrText
      ? (instrText.length > 160 ? instrText.slice(0, 160) + '…' : instrText)
      : 'The client receives a secure link. Once they mark this step complete, the workflow continues.';
  } else {
    headline = prefix + 'Team member action';
    body = step.description
      ? (step.description.length > 160 ? step.description.slice(0, 160) + '…' : step.description)
      : 'A team member works on this step and marks it complete when done.';
  }

  const extras: string[] = [];
  if (step.email_reminder_enabled) {
    const recs = step.email_reminder_config?.recipients ?? [];
    if (recs.includes('client') && recs.includes('assignee')) extras.push('Email sent to client & team member');
    else if (recs.includes('client')) extras.push('Email sent to client');
    else if (recs.includes('assignee')) extras.push('Email notification sent to team member');
  }
  if (step.tool_module_id) {
    const mod = MODULES.find(m => m.id === step.tool_module_id);
    if (mod) extras.push(`${mod.name} tool opens`);
  }
  if (isClient && step.client_can_upload) {
    extras.push('Client can upload files');
  }

  return { headline, body, perspective: isClient ? 'client' : 'team', extras };
}

// ── Issue severity helpers ────────────────────────────────────────────────────

function IssueIcon({ severity }: { severity: StaticIssue['severity'] | FlowIssue['severity'] }) {
  if (severity === 'error')   return <AlertCircle  className="h-4 w-4 text-red-500 flex-shrink-0"    />;
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
  return                              <Info          className="h-4 w-4 text-blue-500 flex-shrink-0"  />;
}

function issueBg(severity: string) {
  if (severity === 'error')   return 'bg-red-50   border-red-200';
  if (severity === 'warning') return 'bg-amber-50 border-amber-200';
  return                             'bg-blue-50  border-blue-200';
}

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
    <div className="fixed inset-0 z-[70] bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 bg-blue-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Mail className="h-4 w-4" />
            <div>
              <p className="text-sm font-bold">Email Preview</p>
              <p className="text-blue-200 text-xs">Sent to: {recipientLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-blue-500 transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-gray-200 px-5 py-3 bg-gray-50 space-y-1 text-xs">
            <div className="flex gap-2"><span className="text-gray-400 w-14 flex-shrink-0">From</span><span className="text-gray-700 font-medium">SMITH &lt;noreply@smithapp.co.uk&gt;</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-14 flex-shrink-0">To</span><span className="text-gray-700">{toAddress}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-14 flex-shrink-0">Subject</span><span className="text-gray-900 font-semibold">{subject}</span></div>
          </div>
          <div className="p-5 bg-white">
            <div className="max-w-[520px] mx-auto border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <div className="bg-indigo-600 px-6 py-5"><h1 className="text-white text-lg font-semibold m-0">SMITH — Task Reminder</h1></div>
              <div className="px-6 py-5 space-y-4 bg-white">
                <p className="text-gray-900 text-base m-0">Hello John Smith,</p>
                <p className="text-gray-600 text-sm">You have a task step that requires your attention:</p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1.5">
                  <p className="text-gray-900 font-semibold text-base">{templateName}</p>
                  <p className="text-gray-500 text-sm">Step: <span className="text-gray-700">{step.title}</span></p>
                  <p className="text-gray-500 text-sm">Client: <span className="text-gray-700 font-medium">Acme Ltd</span></p>
                </div>
                {message && <p className="text-gray-600 text-sm whitespace-pre-line leading-relaxed">{message}</p>}
                <div>
                  {step.assignee_role === 'client' ? (
                    <div className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium"><ExternalLink className="h-3.5 w-3.5" /> View &amp; Complete Task</div>
                  ) : (
                    <div className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium">View Task</div>
                  )}
                </div>
              </div>
              <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
                <p className="text-xs text-gray-400">This reminder was sent from SMITH.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <p className="text-xs text-gray-400">Example data — no real email is sent</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">Close</button>
            <button onClick={onContinue} className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors">
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
    <div className="fixed inset-0 z-[70] bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 bg-amber-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <UserCheck className="h-4 w-4" />
            <div>
              <p className="text-sm font-bold">Client Portal Preview</p>
              <p className="text-amber-200 text-xs">What Acme Ltd sees when they click the link</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-amber-500 transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <header className="bg-white border-b border-gray-200 px-5 py-3.5 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">F</div>
            <span className="text-sm font-semibold text-gray-900">Your Firm Name</span>
            <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Secure link</span>
          </header>
          <div className="p-5 space-y-4">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{templateName} · Acme Ltd</p>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
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
                {instructions ? (
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{instructions}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No client instructions added yet.</p>
                )}
                {step.client_can_upload && (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center bg-gray-50">
                    <Upload className="h-5 w-5 text-gray-300 mx-auto mb-1.5" />
                    <p className="text-sm text-gray-500">Drop files here or <span className="text-indigo-600 font-medium">browse</span></p>
                    <p className="text-xs text-gray-400 mt-0.5">PDF, images, spreadsheets · Max 20 MB each</p>
                  </div>
                )}
                <div className="flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold text-sm shadow-sm">
                  <CheckCircle2 className="h-4 w-4" /> Mark as done
                </div>
                <p className="text-center text-xs text-gray-400">Clicking this will notify your accountant that this step is complete.</p>
              </div>
            </div>
            <p className="text-center text-xs text-gray-400">Secure link · Expires 30 days · Powered by SMITH</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <p className="text-xs text-gray-400">Example data — real page uses live client info</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">Close</button>
            <button onClick={onContinue} className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors">Continue test →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Issues panel ──────────────────────────────────────────────────────────────

function IssuesList({ issues, steps, onStepClick }: {
  issues: (StaticIssue | FlowIssue)[];
  steps: TemplateStepData[];
  onStepClick: (key: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center px-4">
        <CheckCircle2 className="h-8 w-8 text-green-400 mb-2" />
        <p className="text-sm font-semibold text-gray-700">No issues found</p>
        <p className="text-xs text-gray-400 mt-1">This workflow looks well-structured.</p>
      </div>
    );
  }

  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos    = issues.filter(i => i.severity === 'info');
  const sorted   = [...errors, ...warnings, ...infos];

  return (
    <div className="space-y-2 p-3">
      {sorted.map((issue, i) => (
        <div key={i} className={`rounded-lg border p-3 ${issueBg(issue.severity)}`}>
          <div className="flex items-start gap-2 mb-1.5">
            <IssueIcon severity={issue.severity} />
            <p className="text-xs font-semibold text-gray-800 leading-snug">{issue.title}</p>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed mb-2">{issue.description}</p>
          <div className="flex items-start gap-1.5">
            <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500 leading-relaxed">{issue.fix}</p>
          </div>
          {issue.step_key && (
            <button
              onClick={() => onStepClick(issue.step_key!)}
              className="mt-2 text-[11px] text-indigo-600 hover:underline font-medium"
            >
              Jump to step →
            </button>
          )}
        </div>
      ))}
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

type LightboxStage = 'email' | 'client' | null;
type RightTab = 'steps' | 'analysis';
type AnalysisState = 'idle' | 'loading' | 'done' | 'error';

export default function TaskTemplateTestRun({ steps, edges, templateName, onClose }: Props) {
  const sortedSteps = useMemo(() => topoSort(steps, edges), [steps, edges]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [completed, setCompleted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lightbox, setLightbox] = useState<LightboxStage>(null);
  const autoShownRef = useRef<number>(-1);

  // Right panel tabs + AI analysis
  const [rightTab, setRightTab] = useState<RightTab>('steps');
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [analysisResult, setAnalysisResult] = useState<FlowAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');

  // Static analysis (instant, always available)
  const staticIssues = useMemo(() => runStaticAnalysis(steps, edges), [steps, edges]);

  const currentStep = sortedSteps[currentIdx] ?? null;
  const hasEmail  = !!currentStep?.email_reminder_enabled;
  const hasClient = currentStep?.assignee_role === 'client';

  // Find the edge that leads INTO the current step (from the previous step)
  const connectingEdge = useMemo((): TemplateEdgeData | null => {
    if (currentIdx === 0 || !currentStep) return null;
    const prevStep = sortedSteps[currentIdx - 1];
    return edges.find(e => e.from_step_key === prevStep?.step_key && e.to_step_key === currentStep.step_key) ?? null;
  }, [currentIdx, currentStep, sortedSteps, edges]);

  const narration = useMemo((): Narration | null => {
    if (!currentStep) return null;
    const prevStep = currentIdx > 0 ? sortedSteps[currentIdx - 1] : null;
    return buildNarration(currentStep, prevStep, connectingEdge);
  }, [currentStep, currentIdx, sortedSteps, connectingEdge]);

  // Auto-show lightbox when step changes
  useEffect(() => {
    if (completed || !currentStep) return;
    if (autoShownRef.current === currentIdx) return;
    autoShownRef.current = currentIdx;
    if (hasEmail) { setPlaying(false); setLightbox('email'); }
    else if (hasClient) { setPlaying(false); setLightbox('client'); }
    else { setLightbox(null); }
  }, [currentIdx, currentStep, completed, hasEmail, hasClient]);

  // Auto-advance timer
  useEffect(() => {
    if (!playing || lightbox) return;
    timerRef.current = setTimeout(() => {
      if (currentIdx < sortedSteps.length - 1) { setCurrentIdx(i => i + 1); }
      else { setPlaying(false); setCompleted(true); }
    }, SPEEDS[speed]);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, currentIdx, sortedSteps.length, speed, lightbox]);

  // Auto-switch to analysis tab and run analysis on completion
  useEffect(() => {
    if (completed && analysisState === 'idle') {
      setRightTab('analysis');
    }
  }, [completed, analysisState]);

  const runAIAnalysis = useCallback(async () => {
    if (analysisState === 'loading') return;
    setAnalysisState('loading');
    setAnalysisError('');
    try {
      const res = await fetch('/api/tasks/templates/ai-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName, steps, edges }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Analysis failed');
      }
      const data: FlowAnalysis = await res.json();
      setAnalysisResult(data);
      setAnalysisState('done');
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
      setAnalysisState('error');
    }
  }, [analysisState, templateName, steps, edges]);

  const handlePlay  = () => { setCompleted(false); setLightbox(null); setPlaying(true); };
  const handlePause = () => setPlaying(false);
  const handlePrev  = () => {
    setPlaying(false); setLightbox(null); setCompleted(false);
    setCurrentIdx(i => { const next = Math.max(0, i - 1); autoShownRef.current = -1; return next; });
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
    setPlaying(false); setLightbox(null); setCompleted(false);
    const idx = sortedSteps.findIndex(s => s.step_key === stepId);
    if (idx !== -1) { autoShownRef.current = -1; setCurrentIdx(idx); }
  }, [sortedSteps]);

  function handleEmailContinue() {
    if (hasClient) { setLightbox('client'); }
    else { setLightbox(null); setPlaying(true); }
  }
  function handleClientContinue() { setLightbox(null); setPlaying(true); }
  function openPreview(type: LightboxStage) { setPlaying(false); setLightbox(type); }

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
    condition_type: e.condition_type ?? null,
    condition_config: null,
    source_handle: e.source_handle ?? null,
    target_handle: e.target_handle ?? null,
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

  const issueCount = staticIssues.length;
  const errorCount = staticIssues.filter(i => i.severity === 'error').length;

  // Combined issues for the analysis tab
  const allIssues: (StaticIssue | FlowIssue)[] = analysisResult
    ? [...staticIssues, ...analysisResult.issues.filter(ai =>
        !staticIssues.some(s => s.step_key === ai.step_key && s.title === ai.title)
      )]
    : staticIssues;

  return (
    <>
      {/* Animation keyframes */}
      <style>{`
        @keyframes narrationIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .narration-enter { animation: narrationIn 0.35s ease-out forwards; }

        @keyframes stepPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(99,102,241,0);  }
        }
        .step-pulse { animation: stepPulse 2s ease-in-out infinite; }
      `}</style>

      <div className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 bg-indigo-600 text-white rounded-t-2xl flex-shrink-0">
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-indigo-200" />
              <div>
                <h2 className="text-base font-bold">Test Run — {templateName}</h2>
                <p className="text-indigo-200 text-xs mt-0.5">
                  Simulating with example client data &nbsp;·&nbsp; {sortedSteps.length} steps
                  {issueCount > 0 && (
                    <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${errorCount > 0 ? 'bg-red-500/80' : 'bg-amber-400/80 text-amber-900'}`}>
                      {issueCount} issue{issueCount > 1 ? 's' : ''} found
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-indigo-500 transition-colors"><X className="h-5 w-5" /></button>
          </div>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden min-h-0">

            {/* Flowchart panel */}
            <div className="flex-1 relative bg-gray-50 border-r border-gray-200 min-w-0">
              <TaskViewFlowChart steps={viewSteps} edges={viewEdges} onStepClick={handleStepClick} />

              {/* Step label (top-left) */}
              {currentStep && !completed && !lightbox && (
                <div className="absolute top-3 left-3 bg-white border border-indigo-200 rounded-xl shadow-md px-3 py-2 pointer-events-none max-w-[220px]">
                  <p className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wide mb-0.5">
                    Step {currentIdx + 1} of {sortedSteps.length}
                  </p>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{currentStep.title}</p>
                </div>
              )}

              {/* Animated narration card (bottom of canvas) */}
              {currentStep && !completed && !lightbox && narration && (
                <div
                  key={`narration-${currentIdx}`}
                  className="absolute bottom-4 left-4 right-4 pointer-events-none narration-enter"
                >
                  <div className={`rounded-xl border shadow-lg px-4 py-3 max-w-lg mx-auto ${
                    narration.perspective === 'client'
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-indigo-50 border-indigo-200'
                  }`}>
                    {/* Perspective badge */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        narration.perspective === 'client'
                          ? 'bg-amber-200 text-amber-800'
                          : 'bg-indigo-200 text-indigo-800'
                      }`}>
                        {narration.perspective === 'client'
                          ? <><UserCheck className="h-3 w-3" /> Client</>
                          : <><User className="h-3 w-3" /> Team Member</>
                        }
                      </span>
                      <span className={`text-xs font-semibold ${narration.perspective === 'client' ? 'text-amber-800' : 'text-indigo-800'}`}>
                        {narration.headline}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{narration.body}</p>
                    {narration.extras.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {narration.extras.map((e, i) => (
                          <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full ${
                            narration.perspective === 'client'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}>{e}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Preview buttons (top-right) */}
              {currentStep && !completed && !lightbox && (hasEmail || hasClient) && (
                <div className="absolute top-3 right-3 flex flex-col gap-1.5">
                  {hasEmail && (
                    <button onClick={() => openPreview('email')} className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow hover:bg-blue-700 transition-colors">
                      <Eye className="h-3 w-3" /> Preview email
                    </button>
                  )}
                  {hasClient && (
                    <button onClick={() => openPreview('client')} className="flex items-center gap-1.5 bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow hover:bg-amber-700 transition-colors">
                      <Eye className="h-3 w-3" /> Preview client page
                    </button>
                  )}
                </div>
              )}

              {/* Completed overlay */}
              {completed && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                  <div className="text-center">
                    <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="h-10 w-10 text-green-500" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Flow Complete</h3>
                    <p className="text-gray-500 text-sm mt-1">All {sortedSteps.length} steps processed successfully</p>
                    {issueCount > 0 && (
                      <p className={`text-sm mt-2 font-medium ${errorCount > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {issueCount} issue{issueCount > 1 ? 's' : ''} detected — see the Analysis tab →
                      </p>
                    )}
                    <div className="flex items-center gap-2 justify-center mt-5">
                      <button onClick={handleReset} className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                        <RotateCcw className="h-4 w-4" /> Run Again
                      </button>
                      <button
                        onClick={() => { setRightTab('analysis'); if (analysisState === 'idle') runAIAnalysis(); }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                      >
                        <Sparkles className="h-4 w-4" /> AI Analysis
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Lightboxes */}
              {lightbox === 'email' && currentStep && (
                <EmailLightbox step={currentStep} templateName={templateName} onClose={() => setLightbox(null)} onContinue={handleEmailContinue} hasClient={hasClient} />
              )}
              {lightbox === 'client' && currentStep && (
                <ClientPortalLightbox step={currentStep} templateName={templateName} onClose={() => setLightbox(null)} onContinue={handleClientContinue} />
              )}
            </div>

            {/* ── Right panel ──────────────────────────────────────────────── */}
            <div className="w-80 flex flex-col bg-white overflow-hidden flex-shrink-0">

              {/* Tab bar */}
              <div className="flex border-b border-gray-200 flex-shrink-0">
                <button
                  onClick={() => setRightTab('steps')}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${rightTab === 'steps' ? 'border-b-2 border-indigo-500 text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Steps
                </button>
                <button
                  onClick={() => { setRightTab('analysis'); if (analysisState === 'idle') runAIAnalysis(); }}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${rightTab === 'analysis' ? 'border-b-2 border-indigo-500 text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Analysis
                  {issueCount > 0 && (
                    <span className={`text-[10px] px-1 py-0.5 rounded-full font-bold ${errorCount > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                      {issueCount}
                    </span>
                  )}
                </button>
              </div>

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

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto">

                {rightTab === 'steps' && (
                  <>
                    {/* Current step info */}
                    {currentStep && !completed && (
                      <div className="p-4 space-y-3 border-b border-gray-100">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">{currentStep.title}</h3>
                          {currentStep.description && (
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{currentStep.description}</p>
                          )}
                        </div>
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
                        {(hasEmail || hasClient || module) && (
                          <div className="space-y-1.5 pt-1">
                            {hasEmail && (
                              <button onClick={() => openPreview('email')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors text-left">
                                <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="flex-1">Preview email reminder</span>
                                <Eye className="h-3 w-3 text-blue-400 flex-shrink-0" />
                              </button>
                            )}
                            {hasClient && (
                              <button onClick={() => openPreview('client')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors text-left">
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
                          const stepIssues = staticIssues.filter(i => i.step_key === s.step_key);
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
                                {stepIssues.some(i => i.severity === 'error')   && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                                {stepIssues.some(i => i.severity === 'warning') && !stepIssues.some(i => i.severity === 'error') && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
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
                        <div className="flex items-center gap-2 text-[11px] text-gray-500"><span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" /> Issue on step</div>
                      </div>
                    </div>
                  </>
                )}

                {rightTab === 'analysis' && (
                  <div className="p-3 space-y-3">
                    {/* Static issues summary */}
                    {staticIssues.length > 0 && (
                      <div className={`rounded-lg border p-3 text-xs ${errorCount > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                        <p className={`font-semibold mb-1 ${errorCount > 0 ? 'text-red-800' : 'text-amber-800'}`}>
                          {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''} detected` : `${issueCount} warning${issueCount > 1 ? 's' : ''} found`}
                        </p>
                        <p className={errorCount > 0 ? 'text-red-700' : 'text-amber-700'}>
                          {errorCount > 0
                            ? 'These issues will prevent the workflow from running correctly.'
                            : 'These issues are likely unintentional and may cause unexpected behaviour.'}
                        </p>
                      </div>
                    )}

                    {/* AI analysis section */}
                    {analysisState === 'idle' && (
                      <button
                        onClick={runAIAnalysis}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition-colors"
                      >
                        <Sparkles className="h-4 w-4" /> Get AI Suggestions
                      </button>
                    )}
                    {analysisState === 'loading' && (
                      <div className="flex flex-col items-center justify-center py-6 gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                        <p className="text-xs text-gray-400">Analysing workflow…</p>
                      </div>
                    )}
                    {analysisState === 'error' && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                        <p className="font-semibold mb-1">Analysis failed</p>
                        <p className="mb-2">{analysisError}</p>
                        <button onClick={runAIAnalysis} className="text-red-600 hover:underline font-medium">Try again</button>
                      </div>
                    )}
                    {analysisState === 'done' && analysisResult && (
                      <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                          <p className="font-semibold text-indigo-800">AI Assessment</p>
                        </div>
                        <p className="text-indigo-700 leading-relaxed">{analysisResult.summary}</p>
                        <button onClick={runAIAnalysis} className="mt-1.5 text-indigo-500 hover:underline text-[11px]">Re-run analysis</button>
                      </div>
                    )}

                    {/* Issues list */}
                    <IssuesList
                      issues={allIssues}
                      steps={steps}
                      onStepClick={key => {
                        setRightTab('steps');
                        handleStepClick(key);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div className="border-t border-gray-200 px-6 py-3 bg-gray-50 flex items-center gap-3 rounded-b-2xl flex-shrink-0">
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
    </>
  );
}
