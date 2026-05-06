'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare, Plus, ListTodo, Users, Building2, LayoutGrid, Layers,
  BookTemplate, Loader2, RefreshCw,
} from 'lucide-react';
import MyTasksView from './views/MyTasksView';
import AllTasksView from './views/AllTasksView';
import ByClientView from './views/ByClientView';
import ByTeamView from './views/ByTeamView';
import ByTypeView from './views/ByTypeView';
import TemplateLibrary from './TemplateLibrary';
import TaskDetailPanel from './TaskDetailPanel';
import CreateTaskModal, { type CreateTaskData } from './CreateTaskModal';
import TemplateBuilder, { type TemplateData } from './TemplateBuilder';
import AITemplateBuilder from './AITemplateBuilder';
import type {
  Task, TaskStatus, TaskStep, TaskTemplate, DefaultTemplate,
} from '@/types';

type ViewId = 'my' | 'all' | 'by-client' | 'by-team' | 'by-type' | 'templates';

interface TeamMember { id: string; full_name: string | null; email: string }
interface ClientRef { id: string; name: string; client_ref: string }

const NAV_ITEMS: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: 'my',        label: 'My Tasks',      icon: ListTodo },
  { id: 'all',       label: 'All Tasks',     icon: LayoutGrid },
  { id: 'by-client', label: 'By Client',     icon: Building2 },
  { id: 'by-team',   label: 'By Team',       icon: Users },
  { id: 'by-type',   label: 'By Type',       icon: Layers },
];

export default function TasksPage() {
  const [view, setView] = useState<ViewId>('my');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  // Modals
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplateBuilder, setShowTemplateBuilder] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [aiBuilderInitialData, setAiBuilderInitialData] = useState<TemplateData | null>(null);
  const [showAIBuilder, setShowAIBuilder] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setClientFilter('');
    setAssigneeFilter('');
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
        const d = await profileRes.value.json(); setCurrentUserId(d.userId ?? '');
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

  async function handleUpdate(taskId: string, updates: Partial<Task>) {
    const r = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update task');
    await refreshTasks();
    // Refresh selectedTask
    const updated = await fetch(`/api/tasks/${taskId}`);
    if (updated.ok) { const d = await updated.json(); setSelectedTask(d.task); }
  }

  async function handleStepUpdate(taskId: string, stepId: string, updates: Partial<TaskStep>) {
    const r = await fetch(`/api/tasks/${taskId}/steps/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error('Failed to update step');
    // Refresh the selected task
    const updated = await fetch(`/api/tasks/${taskId}`);
    if (updated.ok) { const d = await updated.json(); setSelectedTask(d.task); setTasks(prev => prev.map(t => t.id === taskId ? d.task : t)); }
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

  async function handleCreateFromDefault(t: DefaultTemplate) {
    setTemplateError(null);
    const r = await fetch('/api/tasks/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: t.name,
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

  // Task counts per status for "My Tasks" badge
  const myTaskCount = tasks.filter(t =>
    (t.created_by === currentUserId || t.steps?.some(s => s.assignee_id === currentUserId)) &&
    t.status !== 'complete'
  ).length;

  const viewProps = {
    tasks, currentUserId, search, onSearchChange: setSearch,
    statusFilter, onStatusChange: setStatusFilter,
    clientFilter, onClientChange: setClientFilter,
    assigneeFilter, onAssigneeChange: setAssigneeFilter,
    clients, teamMembers, onClearFilters: clearFilters,
    onTaskClick: setSelectedTask,
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
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 text-white text-sm py-2 rounded-lg hover:bg-indigo-700 font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Task
          </button>
        </div>

        <nav className="flex-1 py-2">
          {NAV_ITEMS.map(item => {
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
        </nav>

        <div className="border-t border-gray-100 py-2">
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
      <main className="flex-1 overflow-y-auto p-6 min-w-0">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            {view === 'my'        && <MyTasksView    {...viewProps} />}
            {view === 'all'       && <AllTasksView   {...viewProps} />}
            {view === 'by-client' && <ByClientView   {...viewProps} />}
            {view === 'by-team'   && <ByTeamView     {...viewProps} />}
            {view === 'by-type'   && <ByTypeView     {...viewProps} />}
            {view === 'templates' && (
              <div className="space-y-4">
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
                />
              </div>
            )}
          </>
        )}
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
        />
      )}

      {/* Create task modal */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          clients={clients}
          teamMembers={teamMembers}
          firmTemplates={templates}
        />
      )}

      {/* Template builder */}
      {showTemplateBuilder && (
        <TemplateBuilder
          template={editingTemplate}
          initialData={aiBuilderInitialData}
          teamMembers={teamMembers}
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
    </div>
  );
}
