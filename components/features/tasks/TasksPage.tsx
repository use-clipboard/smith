'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare, Plus, ListTodo, Users, Building2, LayoutGrid, Layers,
  BookTemplate, Loader2, RefreshCw, FileStack, PlayCircle, List,
  CalendarDays, CalendarRange,
} from 'lucide-react';
import MyTasksView from './views/MyTasksView';
import MyWeekView from './views/MyWeekView';
import MyMonthView from './views/MyMonthView';
import AllTasksView from './views/AllTasksView';
import ByClientView from './views/ByClientView';
import ByTeamView from './views/ByTeamView';
import ByTypeView from './views/ByTypeView';
import TemplateLibrary from './TemplateLibrary';
import TaskDetailPanel from './TaskDetailPanel';
import CreateTaskModal, { type CreateTaskData } from './CreateTaskModal';
import TemplateBuilder, { type TemplateData, type TaskCreationOutput } from './TemplateBuilder';
import AITemplateBuilder from './AITemplateBuilder';
import BulkTaskModal from './BulkTaskModal';
import TaskTypeSelector from './TaskTypeSelector';
import QuickTaskModal from './QuickTaskModal';
import type {
  Task, TaskStatus, TaskStep, TaskTemplate, DefaultTemplate,
} from '@/types';

type ViewId = 'my' | 'my-week' | 'my-month' | 'all' | 'by-client' | 'by-team' | 'by-type' | 'templates' | 'drafts';

interface TeamMember { id: string; full_name: string | null; email: string }
interface ClientRef  { id: string; name: string; client_ref: string; business_type?: string | null; status?: string | null; }

const MY_NAV_ITEMS: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: 'my',       label: 'My Tasks',  icon: ListTodo },
  { id: 'my-week',  label: 'My Week',   icon: CalendarDays },
  { id: 'my-month', label: 'My Month',  icon: CalendarRange },
];

const FIRM_NAV_ITEMS: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: 'all',       label: 'All Tasks',  icon: LayoutGrid },
  { id: 'by-client', label: 'By Client',  icon: Building2 },
  { id: 'by-team',   label: 'By Team',    icon: Users },
  { id: 'by-type',   label: 'By Type',    icon: Layers },
];

export default function TasksPage() {
  const [view, setView] = useState<ViewId>('my');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'staff'>('staff');
  const [currentUserName, setCurrentUserName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [loading, setLoading] = useState(true);

  // Bulk tasks modal
  const [showBulkTask, setShowBulkTask] = useState(false);

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
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  // Modals
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
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

  // When switching to My Tasks, pre-select the current user in the assignee filter.
  // When leaving My Tasks (and personal week/month views), reset it so other views show everyone by default.
  useEffect(() => {
    if (view === 'my' && currentUserId) {
      setAssigneeFilter(currentUserId);
    } else if (view !== 'my' && view !== 'my-week' && view !== 'my-month') {
      setAssigneeFilter('');
    }
  }, [view, currentUserId]);

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setClientFilter('');
    // On My Tasks keep the filter on the current user; on other views clear it
    setAssigneeFilter(view === 'my' ? currentUserId : '');
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async function loadAll() {
    setLoading(true);
    try {
      // Use allSettled so one failing route doesn't crash the whole page
      const [tasksRes, templatesRes, teamRes, clientsRes, profileRes] = await Promise.allSettled([
        fetch('/api/tasks'),
        fetch('/api/tasks/templates'),
        fetch('/api/users/team'),
        fetch('/api/clients'),
        fetch('/api/users/me'),
      ]);

      if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
        const d = await tasksRes.value.json(); setTasks(d.tasks ?? []);
      }
      if (templatesRes.status === 'fulfilled' && templatesRes.value.ok) {
        const d = await templatesRes.value.json(); setTemplates(d.templates ?? []);
      }
      if (teamRes.status === 'fulfilled' && teamRes.value.ok) {
        const d = await teamRes.value.json(); setTeamMembers(d.members ?? []);
      }
      if (clientsRes.status === 'fulfilled' && clientsRes.value.ok) {
        const d = await clientsRes.value.json(); setClients(d.clients ?? []);
      }
      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        const d = await profileRes.value.json();
        setCurrentUserId(d.userId ?? '');
        setCurrentUserRole(d.userRole === 'admin' ? 'admin' : 'staff');
        setCurrentUserName(d.full_name ?? '');
        setFirmName(d.firm_name ?? '');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function refreshTasks() {
    const r = await fetch('/api/tasks');
    if (r.ok) { const d = await r.json(); setTasks(d.tasks ?? []); }
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
    setSelectedTask(null);
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }

  async function handleStopRecurrence(taskId: string) {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurrence_type: null }),
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

  // Task counts per status for badges
  const myTaskCount = tasks.filter(t =>
    t.status !== 'complete' && t.status !== 'draft' &&
    t.steps?.some(s => s.assignee_id === currentUserId && s.status !== 'complete' && s.status !== 'skipped')
  ).length;

  const draftTasks = tasks.filter(t => t.status === 'draft');
  const draftCount = draftTasks.length;

  function handleSetViewMode(mode: 'grid' | 'list') {
    setViewMode(mode);
    sessionStorage.setItem('tasks_view_mode', mode);
  }

  const isAdmin = currentUserRole === 'admin';

  const viewProps = {
    tasks, currentUserId, search, onSearchChange: setSearch,
    statusFilter, onStatusChange: setStatusFilter,
    clientFilter, onClientChange: setClientFilter,
    assigneeFilter, onAssigneeChange: setAssigneeFilter,
    clients, teamMembers, onClearFilters: clearFilters,
    onTaskClick: setSelectedTask,
    onStepUpdate: handleStepUpdate,
    onTaskUpdate: handleUpdate,
    viewMode,
    isAdmin,
    onDelete: handleDelete,
    onStopRecurrence: handleStopRecurrence,
  };

  return (
    <div className="flex h-full bg-gray-50">
      {/* Sidebar nav */}
      <aside className="w-52 border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <CheckSquare className="h-5 w-5 text-indigo-600" />
            <h1 className="text-base font-bold text-gray-900">Tasks</h1>
          </div>
          <button
            onClick={() => setShowTaskTypeSelector(true)}
            className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 text-white text-sm py-2 rounded-lg hover:bg-indigo-700 font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Task
          </button>
          {currentUserRole === 'admin' && (
            <button
              onClick={() => setShowBulkTask(true)}
              className="mt-2 w-full flex items-center justify-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-sm py-2 rounded-lg hover:bg-gray-50 font-medium transition-colors"
            >
              <FileStack className="h-4 w-4 text-indigo-500" /> Bulk Tasks
            </button>
          )}
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {/* Personal group */}
          <div className="px-4 pt-3 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">
              {currentUserName || 'My Work'}
            </p>
          </div>
          {MY_NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700 font-semibold border-r-2 border-indigo-500' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                <span className="truncate">{item.label}</span>
                {item.id === 'my' && myTaskCount > 0 && (
                  <span className="ml-auto text-xs bg-indigo-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                    {myTaskCount > 99 ? '99+' : myTaskCount}
                  </span>
                )}
              </button>
            );
          })}

          {/* Firm group */}
          <div className="px-4 pt-4 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">
              {firmName || 'My Firm'}
            </p>
          </div>
          {FIRM_NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700 font-semibold border-r-2 border-indigo-500' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-gray-100 py-2">
          {currentUserRole === 'admin' && (
            <button
              onClick={() => setView('drafts')}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                view === 'drafts' ? 'bg-indigo-50 text-indigo-700 font-semibold border-r-2 border-indigo-500' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileStack className={`h-4 w-4 flex-shrink-0 ${view === 'drafts' ? 'text-indigo-600' : 'text-gray-400'}`} />
              <span>Drafts</span>
              {draftCount > 0 && (
                <span className="ml-auto text-xs bg-amber-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                  {draftCount > 99 ? '99+' : draftCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setView('templates')}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
              view === 'templates' ? 'bg-indigo-50 text-indigo-700 font-semibold border-r-2 border-indigo-500' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <BookTemplate className={`h-4 w-4 flex-shrink-0 ${view === 'templates' ? 'text-indigo-600' : 'text-gray-400'}`} />
            <span>Templates</span>
            <span className="ml-auto text-xs text-gray-400">{templates.length}</span>
          </button>
        </div>

        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={loadAll} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Fixed top bar: grid/list toggle — never scrolls */}
        {!loading && !['templates', 'drafts'].includes(view) && (
          <div className="flex-shrink-0 flex justify-end px-6 pt-5 pb-3 bg-gray-50">
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => handleSetViewMode('grid')}
                title="Card view"
                className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleSetViewMode('list')}
                title="List view"
                className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            {view === 'my'        && <MyTasksView    {...viewProps} />}
            {view === 'my-week'   && <MyWeekView     tasks={tasks} currentUserId={currentUserId} onTaskClick={setSelectedTask} onStepUpdate={handleStepUpdate} onTaskUpdate={handleUpdate} viewMode={viewMode} isAdmin={isAdmin} onDelete={handleDelete} onStopRecurrence={handleStopRecurrence} />}
            {view === 'my-month'  && <MyMonthView    tasks={tasks} currentUserId={currentUserId} onTaskClick={setSelectedTask} onStepUpdate={handleStepUpdate} onTaskUpdate={handleUpdate} viewMode={viewMode} isAdmin={isAdmin} onDelete={handleDelete} onStopRecurrence={handleStopRecurrence} />}
            {view === 'all'       && <AllTasksView   {...viewProps} />}
            {view === 'by-client' && <ByClientView   {...viewProps} />}
            {view === 'by-team'   && <ByTeamView     {...viewProps} />}
            {view === 'by-type'   && <ByTypeView     {...viewProps} />}
            {view === 'drafts'    && (
              <div className="pt-5">
                <DraftsView
                  tasks={draftTasks}
                  clients={clients}
                  onActivate={handleActivateDraft}
                  onDelete={handleDelete}
                />
              </div>
            )}
            {view === 'templates' && (
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
                />
              </div>
            )}
          </>
        )}
        </div>
      </main>

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
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <FileStack className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm font-medium">No draft tasks</p>
        <p className="text-xs mt-1">Tasks created via Bulk Tasks in draft mode will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Draft Tasks</h2>
          <p className="text-xs text-gray-500 mt-0.5">{tasks.length} task{tasks.length !== 1 ? 's' : ''} awaiting activation</p>
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
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
                  <td className="px-4 py-3 text-gray-500">
                    {task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="text-gray-400">—</span>}
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
