'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskFilters from '../TaskFilters';
import type { Task, TaskStatus } from '@/types';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';

interface Props {
  tasks: Task[];
  currentUserId: string;
  search: string; onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all'; onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string; onClientChange: (v: string) => void;
  assigneeFilter: string; onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  onClearFilters: () => void;
  onTaskClick: (task: Task) => void;
}

export default function ByTypeView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (clientFilter === 'internal' && !t.is_internal) return false;
    if (clientFilter && clientFilter !== 'internal' && t.client_id !== clientFilter) return false;
    if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
    return true;
  }), [tasks, search, statusFilter, clientFilter, assigneeFilter]);

  // Group by template name (or "Ad Hoc" if no template)
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    filtered.forEach(t => {
      const key = t.template_id
        ? (t.title.split(' – ')[0] ?? t.title)
        : 'Ad Hoc';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  return (
    <div className="space-y-4">
      <TaskFilters
        search={search} onSearchChange={onSearchChange}
        statusFilter={statusFilter} onStatusChange={onStatusChange}
        clientFilter={clientFilter} onClientChange={onClientChange}
        assigneeFilter={assigneeFilter} onAssigneeChange={onAssigneeChange}
        clients={clients} teamMembers={teamMembers} onClear={onClearFilters}
      />

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-sm">No tasks found.</p></div>
      ) : (
        grouped.map(([key, typeTasks]) => {
          const isOpen = expanded.has(key) || typeTasks.length <= 3;
          const active = typeTasks.filter(t => t.status !== 'complete').length;
          return (
            <div key={key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => toggle(key)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-gray-900">{key}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{active} active · {typeTasks.length} total</span>
                </div>
                {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
                    {typeTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} />)}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
