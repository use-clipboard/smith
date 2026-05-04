'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import TaskCard from '../TaskCard';
import TaskFilters from '../TaskFilters';
import type { Task, TaskStatus } from '@/types';

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

export default function ByClientView({ tasks, currentUserId, search, onSearchChange, statusFilter, onStatusChange, clientFilter, onClientChange, assigneeFilter, onAssigneeChange, clients, teamMembers, onClearFilters, onTaskClick }: Props) {
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [showHistoryFor, setShowHistoryFor] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (assigneeFilter && !t.steps?.some(s => s.assignee_id === assigneeFilter)) return false;
    return true;
  }), [tasks, search, statusFilter, assigneeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; active: Task[]; history: Task[] }>();
    filtered.forEach(t => {
      const key = t.client_id ?? '__internal__';
      const label = t.client?.name ?? 'Internal / No Client';
      if (!map.has(key)) map.set(key, { label, active: [], history: [] });
      const bucket = map.get(key)!;
      if (t.status === 'complete') bucket.history.push(t);
      else bucket.active.push(t);
    });
    return Array.from(map.entries()).sort(([, a], [, b]) => a.label.localeCompare(b.label));
  }, [filtered]);

  function toggle(key: string) {
    setExpandedClients(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  function toggleHistory(key: string) {
    setShowHistoryFor(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
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
        grouped.map(([key, { label, active, history }]) => {
          const isExpanded = expandedClients.has(key) || active.length <= 3;
          const showHistory = showHistoryFor.has(key);
          const totalCount = active.length + history.length;

          return (
            <div key={key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-gray-900">{label}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {active.length} active{history.length > 0 ? `, ${history.length} complete` : ''}
                  </span>
                </div>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  {active.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3">No active tasks.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3">
                      {active.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} />)}
                    </div>
                  )}

                  {history.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => toggleHistory(key)}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
                      >
                        <History className="h-3.5 w-3.5" />
                        {showHistory ? 'Hide' : 'Show'} {history.length} completed task{history.length !== 1 ? 's' : ''}
                      </button>
                      {showHistory && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                          {history.map(t => <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} currentUserId={currentUserId} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
