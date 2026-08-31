'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { OPEN_TASK_EVENT, OPEN_TASK_KEY } from '@/lib/notificationTarget';
import {
  CheckSquare, Plus, Loader2, FileStack, PlayCircle,
  BarChart3, X,
} from 'lucide-react';
import ViewModeToggle, { ViewModeProvider } from './ViewModeToggle';
import TasksSlimRail from './TasksSlimRail';
import TasksKpiStrip from './TasksKpiStrip';
import TasksRightRail from './TasksRightRail';
import HistoryView from './views/HistoryView';
import DepartmentView from './views/DepartmentView';
import GroupedTasksView, { type GroupBy } from './views/GroupedTasksView';
import BoardView from './views/BoardView';
import CalendarView from './views/CalendarView';
import TimelineView from './views/TimelineView';
import TaskFilters from './TaskFilters';
import DueWindowChips from './DueWindowChips';
import ExportTasksButton from './ExportTasksButton';
import { classifyTasks, applyDueFilter, type DueWindow } from './dueWindow';
import { List, Kanban, CalendarDays, GanttChartSquare, Layers, ChevronDown } from 'lucide-react';
import TemplateLibrary from './TemplateLibrary';
import DueDatePill from './DueDatePill';
import TaskDetailPanel from './TaskDetailPanel';
import CreateTaskModal, { type CreateTaskData } from './CreateTaskModal';
import TemplateBuilder, { type TemplateData, type TaskCreationOutput } from './TemplateBuilder';
import AITemplateBuilder from './AITemplateBuilder';
import BulkTaskModal from './BulkTaskModal';
import TaskDeadlineLinksProvider, { triggerDeadlineLinksRefetch } from './TaskDeadlineLinksProvider';
import TaskClientStatusPolicyProvider from './TaskClientStatusPolicyProvider';
import TaskTypeSelector from './TaskTypeSelector';
import QuickTaskModal from './QuickTaskModal';
import { useTaskCountsOrZero } from '@/components/ui/TasksCountProvider';
import type {
  Task, TaskStatus, TaskStep, TaskTemplate, DefaultTemplate,
} from '@/types';

// The unified list ('list') replaces the old my / all / by-client / by-team /
// by-type / my-week / my-month views — those are now Scope + Group-by + the
// Calendar layout. Departments / History / Templates / Drafts keep dedicated views.
type ViewId = 'list' | 'history' | 'department' | 'templates' | 'drafts';

interface TeamMember { id: string; full_name: string | null; email: string }
interface ClientRef  { id: string; name: string; client_ref: string; business_type?: string | null; status?: string | null; }

export default function TasksPage() {
  const [view, setView] = useState<ViewId>('list');
  // Unified list controls: who (scope), how it's grouped, and the due-window chip.
  const [scope, setScope] = useState<'me' | 'firm'>('me');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [dueFilter, setDueFilter] = useState<DueWindow>('all');
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [departments, setDepartments] = useState<{ category: string; count: number }[]>([]);

  // Collapsible sidebar sections — persisted per browser.
  const [tasks, setTasks] = useState<Task[]>([]);
  // Set after deleting a task linked to a client Service — prompts to end it too.
  const [endServicePrompt, setEndServicePrompt] = useState<{ id: string; name: string; clientId: string } | null>(null);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'staff'>('staff');
  const [loading, setLoading] = useState(true);

  // Bulk tasks modal
  const [showBulkTask, setShowBulkTask] = useState(false);
  // Right insight rail — overlay drawer on narrow screens (auto-collapsed by CSS).
  const [railOpen, setRailOpen] = useState(false);

  // Grid vs list view mode.
  // Priority: sessionStorage (session override) → localStorage default preference → 'list'
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      const session = sessionStorage.getItem('tasks_view_mode') as 'grid' | 'list' | null;
      if (session) return session;
      const persisted = localStorage.getItem('smith:tasks_default_view') as 'grid' | 'list' | null;
      if (persisted) return persisted;
    }
    return 'list';
  });

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all' | 'open'>('open');
  const [clientFilter, setClientFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  // Modals
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Deep-link: open a specific task when its notification is clicked. The Tasks
  // tab stays mounted once opened, so handle BOTH a cold open (sessionStorage
  // handoff) and a live click while already on screen (window event).
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;
  useEffect(() => {
    async function openById(id: string) {
      if (!id) return;
      const existing = tasksRef.current.find(t => t.id === id);
      if (existing) { setSelectedTask(existing); return; }
      try {
        const r = await fetch(`/api/tasks/${id}`);
        if (r.ok) { const d = await r.json(); if (d?.task) setSelectedTask(d.task as Task); }
      } catch { /* ignore */ }
    }
    try {
      const pending = sessionStorage.getItem(OPEN_TASK_KEY);
      if (pending) { sessionStorage.removeItem(OPEN_TASK_KEY); void openById(pending); }
    } catch { /* ignore */ }
    const onOpen = (e: Event) => {
      try { sessionStorage.removeItem(OPEN_TASK_KEY); } catch { /* ignore */ }
      void openById((e as CustomEvent<string>).detail);
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TASK_EVENT, onOpen);
  }, []);
  // Task creation flow: selector → quick or full (wizard or builder)
  const [showTaskTypeSelector, setShowTaskTypeSelector] = useState(false);
  const [showQuickTask, setShowQuickTask]               = useState(false);
  const [showCreate, setShowCreate]                     = useState(false); // Full Task wizard
  const [showTaskBuilder, setShowTaskBuilder]           = useState(false); // Full Task visual builder
  const [taskBuilderInitialData, setTaskBuilderInitialData] = useState<TemplateData | null>(null);
  // Template editing
  const [showTemplateBuilder, setShowTemplateBuilder] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [aiBuilderInitialData, setAiBuilderInitialData] = useState<TemplateData | null>(null);
  const [showAIBuilder, setShowAIBuilder] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // "Mine" is now the Scope control (scope === 'me'), which filters by step
  // assignee directly — the assignee dropdown is a separate, optional filter.
  function clearFilters() {
    setSearch('');
    setStatusFilter('open');
    setClientFilter('');
    setAssigneeFilter('');
    setDueFilter('all');
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async function loadAll() {
    setLoading(true);
    try {
      // CRITICAL PATH — only the two things the task list needs to render:
      // the tasks themselves, and the current user's profile (drives the "My
      // Tasks" view + permission gating). We unblock the UI as soon as these
      // land instead of waiting on the four heavier/secondary fetches below.
      // allSettled so one failure doesn't crash the page.
      const [tasksRes, profileRes] = await Promise.allSettled([
        fetch('/api/tasks'),
        fetch('/api/users/me'),
      ]);

      if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
        const d = await tasksRes.value.json(); setTasks(d.tasks ?? []);
      }
      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        const d = await profileRes.value.json();
        setCurrentUserId(d.userId ?? '');
        setCurrentUserRole(d.userRole === 'admin' ? 'admin' : 'staff');
      }
    } finally {
      setLoading(false);
    }

    // SECONDARY — templates, team, clients and department counts only feed
    // filters, the sidebar badges and the create/edit modals. The task cards
    // carry their own embedded client + assignee data, so none of this blocks
    // the list. Fire them in the background and populate as each arrives.
    fetch('/api/tasks/templates')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setTemplates(d.templates ?? []); })
      .catch(() => { /* non-critical */ });
    fetch('/api/users/team')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setTeamMembers(d.members ?? []); })
      .catch(() => { /* non-critical */ });
    fetch('/api/clients')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setClients(d.clients ?? []); })
      .catch(() => { /* non-critical */ });
    fetch('/api/tasks/departments')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setDepartments(d.departments ?? []); })
      .catch(() => { /* non-critical */ });
  }

  useEffect(() => { loadAll(); }, []);

  async function refreshTasks() {
    const r = await fetch('/api/tasks');
    if (r.ok) { const d = await r.json(); setTasks(d.tasks ?? []); }
    // Refresh department counts in the background — non-blocking
    fetch('/api/tasks/departments')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDepartments(d.departments ?? []); })
      .catch(() => { /* non-critical */ });
    // Newly-created tasks may carry CH-deadline links — tell the provider
    // to reload its cache so the inline icon + meta line render straight
    // away instead of waiting for a page refresh.
    triggerDeadlineLinksRefetch();
  }

  async function refreshTemplates() {
    const r = await fetch('/api/tasks/templates');
    if (r.ok) { const d = await r.json(); setTemplates(d.templates ?? []); }
  }

  // ── Task CRUD ───────────────────────────────────────────────────────────────

  async function handleCreate(data: CreateTaskData) {
    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error('Failed to create task');
    await refreshTasks();
  }

  /** Called when the visual task builder (TemplateBuilder in task mode) saves */
  async function handleTaskBuilderCreate(data: TaskCreationOutput, saveAsTemplate: boolean, templateData: TemplateData) {
    // Create the task
    await handleCreate(data as CreateTaskData);
    // Optionally also save as a reusable template
    if (saveAsTemplate) {
      await handleSaveTemplate(templateData);
    }
    setShowTaskBuilder(false);
    setTaskBuilderInitialData(null);
  }

  /** Called when the Full Task wizard wants to open the visual builder (from scratch or customise) */
  function handleGoToBuilder(initialData?: TemplateData | null) {
    setShowCreate(false);
    setTaskBuilderInitialData(initialData ?? null);
    setShowTaskBuilder(true);
  }

  async function handleUpdate(taskId: string, updates: Partial<Task>) {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update task');
    await refreshTasks();
    // Only refresh the detail panel if it is already open for this task
    if (selectedTask?.id === taskId) {
      const updated = await fetch(`/api/tasks/${taskId}`);
      if (updated.ok) { const d = await updated.json(); setSelectedTask(d.task); }
    }
  }

  async function handleStepUpdate(taskId: string, stepId: string, updates: Partial<TaskStep>) {
    const r = await fetch(`/api/tasks/${taskId}/steps/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update step');
    // Refresh task in the list; only update the detail panel if it's already open for this task
    const updated = await fetch(`/api/tasks/${taskId}`);
    if (updated.ok) {
      const d = await updated.json();
      setTasks(prev => prev.map(t => t.id === taskId ? d.task : t));
      if (selectedTask?.id === taskId) setSelectedTask(d.task);
    }
  }

  async function handleLogTime(taskId: string, entry: { step_id?: string; started_at: string; ended_at: string; notes?: string }) {
    const r = await fetch(`/api/tasks/${taskId}/time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!r.ok) throw new Error('Failed to log time');
    const updated = await fetch(`/api/tasks/${taskId}`);
    if (updated.ok) { const d = await updated.json(); setSelectedTask(d.task); setTasks(prev => prev.map(t => t.id === taskId ? d.task : t)); }
  }

  async function handleDelete(taskId: string) {
    const r = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete task');
    const d = await r.json().catch(() => ({}));
    setSelectedTask(null);
    setTasks(prev => prev.filter(t => t.id !== taskId));
    if (d?.linkedService) setEndServicePrompt(d.linkedService);
  }

  async function handleStopRecurrence(taskId: string) {
    const task = tasks.find(t => t.id === taskId);
    const label = task?.recurrence_type ? task.recurrence_type.replace(/-/g, ' ') : 'recurring';
    const title = task?.title ?? 'this task';
    const ok = window.confirm(
      `Stop the ${label} recurrence for "${title}"?\n\nThis task will no longer repeat after the current occurrence. You can turn it back on at any time from the task detail panel.`
    );
    if (!ok) return;
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurrence_type: null, recurrence_interval_days: null }),
    });
    if (!r.ok) throw new Error('Failed to stop recurrence');
    await refreshTasks();
    if (selectedTask?.id === taskId) {
      const updated = await fetch(`/api/tasks/${taskId}`);
      if (updated.ok) { const d = await updated.json(); setSelectedTask(d.task); }
    }
  }

  async function handleActivateDraft(taskId: string) {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_started' }),
    });
    if (!r.ok) throw new Error('Failed to activate draft');
    await refreshTasks();
  }

  // ── Template CRUD ───────────────────────────────────────────────────────────

  async function handleSaveTemplate(data: TemplateData) {
    const url = editingTemplate ? `/api/tasks/templates/${editingTemplate.id}` : '/api/tasks/templates';
    const method = editingTemplate ? 'PUT' : 'POST';
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to save template');
    }
    await refreshTemplates();
    setEditingTemplate(null);
    setShowTemplateBuilder(false);
  }

  async function handleCreateFromDefault(t: DefaultTemplate, nameOverride?: string) {
    setTemplateError(null);
    const r = await fetch('/api/tasks/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameOverride ?? t.name,
        description: t.description,
        category: t.category,
        recurrence_type: t.recurrence_type,
        estimated_duration_days: t.estimated_duration_days,
        is_firm_wide: true,
        steps: t.steps.map(s => ({
          step_key: s.step_key,
          title: s.title,
          description: s.description,
          assignee_role: s.assignee_role,
          tool_module_id: s.tool_module_id,
          email_reminder_enabled: s.email_reminder_enabled ?? false,
          email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
          position_x: s.position_x,
          position_y: s.position_y,
          step_type: s.step_type ?? 'regular',
          start_trigger_config: ('start_trigger_config' in s ? s.start_trigger_config : null) ?? null,
          end_config: ('end_config' in s ? s.end_config : null) ?? null,
        })),
        edges: t.edges,
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const msg = body.error ?? 'Failed to import template';
      setTemplateError(msg);
      return; // don't throw — prevents full-page crash
    }
    await refreshTemplates();
  }

  async function handleDeleteTemplate(id: string) {
    const r = await fetch(`/api/tasks/templates/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed to delete template');
    await refreshTemplates();
  }

  async function handleCopyTemplate(t: TaskTemplate, newName: string) {
    const r = await fetch('/api/tasks/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        description: t.description ?? null,
        category: t.category ?? 'general',
        recurrence_type: t.recurrence_type ?? null,
        recurrence_interval_days: t.recurrence_interval_days ?? null,
        estimated_duration_days: t.estimated_duration_days ?? null,
        is_firm_wide: t.is_firm_wide ?? true,
        steps: (t.steps ?? []).map(s => ({
          step_key: s.step_key,
          title: s.title,
          description: s.description ?? null,
          assignee_role: s.assignee_role ?? 'team_member',
          default_assignee_id: s.default_assignee_id ?? null,
          tool_module_id: s.tool_module_id ?? null,
          email_reminder_enabled: s.email_reminder_enabled ?? false,
          email_reminder_config: s.email_reminder_config ?? { recipients: [], timing: 'on_assign' },
          email_reminder_subject: s.email_reminder_subject ?? null,
          email_reminder_message: s.email_reminder_message ?? null,
          client_instructions: s.client_instructions ?? null,
          client_can_upload: s.client_can_upload ?? false,
          time_estimate_minutes: s.time_estimate_minutes ?? null,
          position_x: s.position_x,
          position_y: s.position_y,
          step_type: s.step_type ?? 'regular',
          start_trigger_config: s.start_trigger_config ?? null,
          end_config: s.end_config ?? null,
        })),
        edges: (t.edges ?? []).map(e => ({
          from_step_key: e.from_step_key,
          to_step_key: e.to_step_key,
          label: e.label ?? null,
          condition_type: e.condition_type ?? null,
          condition_config: e.condition_config ?? null,
          source_handle: e.source_handle ?? null,
          target_handle: e.target_handle ?? null,
        })),
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to copy template');
    }
    await refreshTemplates();
  }

  // "My Tasks" badge mirrors the main sidebar Tasks badge exactly — both read
  // the shared TasksCountProvider (one source of truth, pushed in real time), so
  // they always show the same number and change together.
  const myTaskCount = useTaskCountsOrZero().count;

  const draftTasks = tasks.filter(t => t.status === 'draft');
  const draftCount = draftTasks.length;

  // The unified list ('list') carries the KPI strip, view tabs and right rail;
  // Departments / History / Templates / Drafts are their own full-width views.
  const isTaskListView = view === 'list';

  // Layout tabs (List / Board / Calendar / Timeline).
  const [layout, setLayout] = useState<'list' | 'board' | 'calendar' | 'timeline'>('list');

  // Scope (me/firm) + text/status/client/assignee filters. Feeds the due-window
  // chips (counts), the due filter, and every layout.
  const scopedFiltered = useMemo(() => {
    const base = scope === 'me' ? tasks.filter(t => t.steps?.some(s => s.assignee_id === currentUserId)) : tasks;
    return base.filter(t => {
      if (search) { const n = search.toLowerCase(); if (!`${t.title} ${t.client?.name ?? ''} ${t.client?.client_ref ?? ''}`.toLowerCase().includes(n)) return false; }
      if (statusFilter === 'open' ? t.status === 'complete' : (statusFilter !== 'all' && t.status !== statusFilter)) return false;
      if (clientFilter === 'internal' && !t.is_internal) return false;
      if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
      if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
      return true;
    });
  }, [tasks, scope, currentUserId, search, statusFilter, clientFilter, assigneeFilter]);

  const { classMap: dueClassMap, counts: dueCounts } = useMemo(() => classifyTasks(scopedFiltered), [scopedFiltered]);
  const visibleTasks = useMemo(() => applyDueFilter(scopedFiltered, dueClassMap, dueFilter), [scopedFiltered, dueClassMap, dueFilter]);

  function handleSetViewMode(mode: 'grid' | 'list') {
    setViewMode(mode);
    sessionStorage.setItem('tasks_view_mode', mode);
  }

  const isAdmin = currentUserRole === 'admin';

  return (
    <TaskDeadlineLinksProvider>
    <TaskClientStatusPolicyProvider>
    <ViewModeProvider viewMode={viewMode} setViewMode={handleSetViewMode}>
    {endServicePrompt && (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setEndServicePrompt(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Task deleted</h3>
          <p className="text-sm text-[var(--text-secondary)]">This task was linked to the service <strong>&ldquo;{endServicePrompt.name}&rdquo;</strong>. Do you also want to <strong>end that service</strong>?</p>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEndServicePrompt(null)} className="btn-ghost text-xs">Keep service active</button>
            <button
              onClick={async () => { const p = endServicePrompt; setEndServicePrompt(null); await fetch(`/api/clients/${p.clientId}/services/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ended' }) }).catch(() => {}); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              End the service too
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="flex h-full">
      {/* Slim hybrid icon rail — replaces the fat Tasks sub-sidebar. Every
          destination stays one click / popover away. */}
      <TasksSlimRail
        view={view}
        setView={(v) => setView(v as ViewId)}
        scope={scope}
        setScope={setScope}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        layout={layout}
        setLayout={setLayout}
        activeDepartment={activeDepartment}
        onSelectDepartment={(c) => { setActiveDepartment(c); setView('department'); }}
        departments={departments}
        myCount={myTaskCount}
        draftCount={draftCount}
        templatesCount={templates.length}
        isAdmin={isAdmin}
        onRefresh={loadAll}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Page header — title + New Task (New Task / Bulk relocated here) */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-indigo-600 grid place-items-center text-white flex-shrink-0"><CheckSquare className="h-5 w-5" /></span>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">Tasks</h1>
              <p className="text-xs text-gray-500">Stay on top of work across your firm.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowTaskTypeSelector(true)}
              className="inline-flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-indigo-700 font-semibold transition-colors"
            >
              <Plus className="h-4 w-4" /> New Task
            </button>
            {currentUserRole === 'admin' && (
              <button
                onClick={() => setShowBulkTask(true)}
                className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-sm px-3 py-2 rounded-lg hover:bg-gray-50 font-semibold transition-colors"
              >
                <FileStack className="h-4 w-4 text-indigo-500" /> Bulk
              </button>
            )}
          </div>
        </div>

        {/* KPI strip — click a card to filter the list */}
        {isTaskListView && (
          <div className="px-6 pt-4 flex-shrink-0">
            <TasksKpiStrip
              tasks={tasks}
              onSelect={(f) => {
                setLayout('list');
                if (f === 'open') { setScope('firm'); setDueFilter('all'); setStatusFilter('open'); }
                else { setScope('firm'); setDueFilter(f); }
              }}
            />
          </div>
        )}

        {/* Unified toolbar — Scope · View tabs · Group by · filters · due chips */}
        {isTaskListView && (
          <div className="px-6 pt-3 flex-shrink-0 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex bg-gray-100 border border-gray-200 rounded-lg p-0.5">
                {(['me', 'firm'] as const).map(s => (
                  <button key={s} onClick={() => setScope(s)}
                    className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${scope === s ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {s === 'me' ? 'My Work' : 'Firm'}
                  </button>
                ))}
              </div>
              <div className="inline-flex bg-gray-100 border border-gray-200 rounded-lg p-0.5">
                {([
                  { id: 'list', label: 'List', Icon: List },
                  { id: 'board', label: 'Board', Icon: Kanban },
                  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
                  { id: 'timeline', label: 'Timeline', Icon: GanttChartSquare },
                ] as const).map(({ id, label, Icon }) => (
                  <button key={id} onClick={() => setLayout(id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${layout === id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              {layout === 'list' && <GroupByControl value={groupBy} onChange={setGroupBy} />}
              {layout === 'list' && <ViewModeToggle />}
              <ExportTasksButton tasks={visibleTasks} filename="tasks" />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TaskFilters
                search={search} onSearchChange={setSearch}
                statusFilter={statusFilter} onStatusChange={setStatusFilter}
                clientFilter={clientFilter} onClientChange={setClientFilter}
                assigneeFilter={assigneeFilter} onAssigneeChange={setAssigneeFilter}
                clients={clients} teamMembers={teamMembers} onClear={clearFilters}
              />
              <span className="text-xs font-bold text-[var(--text-primary)] tabular-nums">{visibleTasks.length} task{visibleTasks.length !== 1 ? 's' : ''}</span>
            </div>
            <DueWindowChips value={dueFilter} onChange={setDueFilter} totalCount={scopedFiltered.length} counts={dueCounts} />
          </div>
        )}

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pt-5 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-[#5b21b6]" />
          </div>
        ) : view === 'list' ? (
          layout === 'list' ? (
            <GroupedTasksView
              tasks={visibleTasks} currentUserId={currentUserId}
              clients={clients} teamMembers={teamMembers} templates={templates}
              groupBy={groupBy} viewMode={viewMode} isAdmin={isAdmin}
              onTaskClick={setSelectedTask} onStepUpdate={handleStepUpdate} onTaskUpdate={handleUpdate}
              onDelete={handleDelete} onStopRecurrence={handleStopRecurrence}
            />
          ) : layout === 'board' ? (
            <BoardView tasks={visibleTasks} currentUserId={currentUserId} onTaskClick={setSelectedTask} isAdmin={isAdmin} onDelete={handleDelete} onStopRecurrence={handleStopRecurrence} />
          ) : layout === 'calendar' ? (
            <CalendarView tasks={visibleTasks} currentUserId={currentUserId} onTaskClick={setSelectedTask} onStepUpdate={handleStepUpdate} onTaskUpdate={handleUpdate} viewMode={viewMode} isAdmin={isAdmin} teamMembers={teamMembers} onDelete={handleDelete} onStopRecurrence={handleStopRecurrence} />
          ) : (
            <TimelineView tasks={visibleTasks} onTaskClick={setSelectedTask} />
          )
        ) : view === 'department' && activeDepartment ? (
          <DepartmentView
            category={activeDepartment}
            tasks={tasks}
            templates={templates}
            clients={clients}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onTaskClick={setSelectedTask}
            onStepUpdate={handleStepUpdate}
            onTaskUpdate={handleUpdate}
            onDelete={handleDelete}
            onStopRecurrence={handleStopRecurrence}
          />
        ) : view === 'history' ? (
          <HistoryView />
        ) : view === 'drafts' ? (
          <div className="pt-5">
            <DraftsView tasks={draftTasks} clients={clients} onActivate={handleActivateDraft} onDelete={handleDelete} />
          </div>
        ) : view === 'templates' ? (
          <div className="space-y-4 pt-5">
            {templateError && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
                <span className="font-semibold flex-shrink-0">Import failed:</span>
                <span className="flex-1">{templateError}</span>
                <button onClick={() => setTemplateError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0 font-bold ml-2">✕</button>
              </div>
            )}
            <TemplateLibrary
              firmTemplates={templates}
              onCreateFromDefault={handleCreateFromDefault}
              onEdit={t => { setEditingTemplate(t); setShowTemplateBuilder(true); }}
              onCreateBlank={() => { setEditingTemplate(null); setAiBuilderInitialData(null); setShowTemplateBuilder(true); }}
              onCreateAI={() => setShowAIBuilder(true)}
              onDelete={handleDeleteTemplate}
              onCopy={handleCopyTemplate}
              isAdmin={isAdmin}
            />
          </div>
        ) : null}
        </div>
          </main>

          {/* Right insight rail — auto-collapses below 1180px (see drawer below) */}
          {isTaskListView && (
            <aside className="hidden min-[1180px]:flex flex-col w-[316px] flex-shrink-0 border-l border-gray-200 bg-gray-50/40 px-4 pt-4 pb-6 overflow-hidden">
              <TasksRightRail
                tasks={tasks}
                currentUserId={currentUserId}
                onViewMine={() => { setView('list'); setScope('me'); setLayout('list'); }}
                onExploreTemplates={() => setView('templates')}
                onOpenTask={setSelectedTask}
              />
            </aside>
          )}
        </div>
      </div>

      {/* Narrow screens: the right rail collapses to a floating button + drawer */}
      {isTaskListView && (
        <>
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Show insights"
            className="min-[1180px]:hidden fixed right-4 bottom-4 z-30 w-12 h-12 rounded-full bg-indigo-600 text-white grid place-items-center shadow-lg hover:bg-indigo-700 transition-colors"
          >
            <BarChart3 className="h-5 w-5" />
          </button>
          {railOpen && (
            <div className="min-[1180px]:hidden fixed inset-0 z-[70] flex justify-end" onClick={() => setRailOpen(false)}>
              <div className="absolute inset-0 bg-black/30" />
              <div className="relative w-[340px] max-w-[88vw] h-full bg-gray-50 border-l border-gray-200 p-4 overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex justify-end mb-2">
                  <button onClick={() => setRailOpen(false)} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500"><X className="h-4 w-4" /></button>
                </div>
                <TasksRightRail
                  tasks={tasks}
                  currentUserId={currentUserId}
                  onViewMine={() => { setView('list'); setScope('me'); setLayout('list'); setRailOpen(false); }}
                  onExploreTemplates={() => { setView('templates'); setRailOpen(false); }}
                  onOpenTask={(t) => { setSelectedTask(t); setRailOpen(false); }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          currentUserId={currentUserId}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleUpdate}
          onStepUpdate={handleStepUpdate}
          onLogTime={handleLogTime}
          onDelete={handleDelete}
          isAdmin={isAdmin}
          teamMembers={teamMembers}
          onStopRecurrence={handleStopRecurrence}
          onTaskRefetch={async (taskId: string) => {
            // Refetch just this task so the open detail panel reflects step list edits
            const r = await fetch(`/api/tasks/${taskId}`);
            if (r.ok) {
              const d = await r.json();
              setSelectedTask(d.task);
              setTasks(prev => prev.map(t => t.id === taskId ? d.task : t));
            }
          }}
        />
      )}

      {/* Task type selector — shown first on +New Task */}
      {showTaskTypeSelector && (
        <TaskTypeSelector
          onClose={() => setShowTaskTypeSelector(false)}
          onQuickTask={() => { setShowTaskTypeSelector(false); setShowQuickTask(true); }}
          onFullTask={() => { setShowTaskTypeSelector(false); setShowCreate(true); }}
        />
      )}

      {/* Quick Task modal */}
      {showQuickTask && (
        <QuickTaskModal
          onClose={() => setShowQuickTask(false)}
          onCreate={handleCreate}
          teamMembers={teamMembers}
        />
      )}

      {/* Full Task wizard (template → details → assignees → preview) */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          clients={clients}
          teamMembers={teamMembers}
          firmTemplates={templates}
          onGoToBuilder={handleGoToBuilder}
        />
      )}

      {/* Full Task visual builder (from scratch or customise-first) */}
      {showTaskBuilder && (
        <TemplateBuilder
          template={null}
          initialData={taskBuilderInitialData}
          teamMembers={teamMembers}
          existingTemplates={templates.map(t => ({ id: t.id, name: t.name }))}
          onSave={handleSaveTemplate}
          onClose={() => { setShowTaskBuilder(false); setTaskBuilderInitialData(null); }}
          mode="task"
          clients={clients}
          onCreateTask={handleTaskBuilderCreate}
        />
      )}

      {/* Template builder */}
      {showTemplateBuilder && (
        <TemplateBuilder
          template={editingTemplate}
          initialData={aiBuilderInitialData}
          teamMembers={teamMembers}
          existingTemplates={templates.map(t => ({ id: t.id, name: t.name }))}
          onSave={handleSaveTemplate}
          onClose={() => { setShowTemplateBuilder(false); setEditingTemplate(null); setAiBuilderInitialData(null); }}
        />
      )}

      {/* AI Template builder */}
      {showAIBuilder && (
        <AITemplateBuilder
          teamMembers={teamMembers}
          onOpenInEditor={data => {
            setAiBuilderInitialData(data);
            setEditingTemplate(null);
            setShowAIBuilder(false);
            setShowTemplateBuilder(true);
          }}
          onClose={() => setShowAIBuilder(false)}
        />
      )}

      {/* Bulk Task modal (admin only) */}
      {showBulkTask && (
        <BulkTaskModal
          templates={templates}
          clients={clients}
          teamMembers={teamMembers}
          onClose={() => setShowBulkTask(false)}
          onComplete={() => { setShowBulkTask(false); refreshTasks(); }}
        />
      )}

    </div>
    </ViewModeProvider>
    </TaskClientStatusPolicyProvider>
    </TaskDeadlineLinksProvider>
  );
}

// ── Group-by control ──────────────────────────────────────────────────────────

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none',       label: 'No grouping' },
  { value: 'due',        label: 'Due date' },
  { value: 'department', label: 'Department' },
  { value: 'client',     label: 'Client' },
  { value: 'type',       label: 'Type' },
  { value: 'team',       label: 'Team' },
  { value: 'status',     label: 'Status' },
];

function GroupByControl({ value, onChange }: { value: GroupBy; onChange: (g: GroupBy) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const label = GROUP_OPTIONS.find(o => o.value === value)?.label ?? 'No grouping';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-indigo-300 text-gray-700 transition-colors">
        <Layers className="h-3.5 w-3.5 text-gray-400" /> Group: <span className="font-semibold text-gray-900">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-44 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5">
          {GROUP_OPTIONS.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${value === o.value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drafts View ───────────────────────────────────────────────────────────────

interface DraftsViewProps {
  tasks: Task[];
  clients: ClientRef[];
  onActivate: (taskId: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

function DraftsView({ tasks, clients, onActivate, onDelete }: DraftsViewProps) {
  const [activating, setActivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activateAll, setActivateAll] = useState(false);

  const clientMap = new Map(clients.map(c => [c.id, c]));

  async function handleActivate(taskId: string) {
    setActivating(taskId);
    try { await onActivate(taskId); } finally { setActivating(null); }
  }

  async function handleDelete(taskId: string) {
    setDeleting(taskId);
    try { await onDelete(taskId); } finally { setDeleting(null); }
  }

  async function handleActivateAll() {
    setActivateAll(true);
    try {
      for (const t of tasks) { await onActivate(t.id); }
    } finally { setActivateAll(false); }
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-[var(--text-primary)]">
        <FileStack className="h-10 w-10 mb-3 opacity-60" />
        <p className="text-sm font-bold">No draft tasks</p>
        <p className="text-xs mt-1 text-[var(--text-secondary)] font-medium">Tasks created via Bulk Tasks in draft mode will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Draft Tasks</h2>
          <p className="text-xs font-medium text-[var(--text-secondary)] mt-0.5">{tasks.length} task{tasks.length !== 1 ? 's' : ''} awaiting activation</p>
        </div>
        <button
          onClick={handleActivateAll}
          disabled={activateAll}
          className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium transition-colors"
        >
          {activateAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Activate All
        </button>
      </div>

      <div className="bg-white/[0.78] backdrop-blur-md rounded-xl border border-[var(--border)] shadow-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200/60 bg-white/40">
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Task</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Client</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Due Date</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Steps</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {tasks.map(task => {
              const client = task.client_id ? clientMap.get(task.client_id) : null;
              const isActivating = activating === task.id;
              const isDeleting = deleting === task.id;
              return (
                <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{task.title}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {client ? (
                      <span>{client.name}{client.client_ref ? <span className="text-gray-400 ml-1 text-xs">({client.client_ref})</span> : null}</span>
                    ) : (
                      <span className="text-gray-400 italic">No client</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <DueDatePill dueDate={task.due_date} status={task.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{task.steps?.length ?? 0} step{(task.steps?.length ?? 0) !== 1 ? 's' : ''}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => handleActivate(task.id)}
                        disabled={isActivating || isDeleting || activateAll}
                        className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium transition-colors"
                      >
                        {isActivating ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                        Activate
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        disabled={isActivating || isDeleting || activateAll}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
