'use client';

import { Search, X } from 'lucide-react';
import type { TaskStatus } from '@/types';

interface TaskFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all';
  onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string;
  onClientChange: (v: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];
  teamMembers: { id: string; full_name: string | null; email: string }[];
  onClear: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all',              label: 'All Statuses' },
  { value: 'not_started',      label: 'Not Started' },
  { value: 'in_progress',      label: 'In Progress' },
  { value: 'waiting_on_client',label: 'Waiting on Client' },
  { value: 'review',           label: 'Review' },
  { value: 'complete',         label: 'Complete' },
];

export default function TaskFilters({
  search, onSearchChange,
  statusFilter, onStatusChange,
  clientFilter, onClientChange,
  assigneeFilter, onAssigneeChange,
  clients, teamMembers, onClear,
}: TaskFiltersProps) {
  const hasFilters = search || statusFilter !== 'all' || clientFilter || assigneeFilter;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search tasks…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md w-52 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Status */}
      <select
        value={statusFilter}
        onChange={e => onStatusChange(e.target.value as TaskStatus | 'all')}
        className="py-1.5 pl-2.5 pr-7 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
      >
        {STATUS_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Client */}
      <select
        value={clientFilter}
        onChange={e => onClientChange(e.target.value)}
        className="py-1.5 pl-2.5 pr-7 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
      >
        <option value="">All Clients</option>
        <option value="internal">Internal Only</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {/* Assignee */}
      <select
        value={assigneeFilter}
        onChange={e => onAssigneeChange(e.target.value)}
        className="py-1.5 pl-2.5 pr-7 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
      >
        <option value="">All Team Members</option>
        {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
      </select>

      {hasFilters && (
        <button onClick={onClear} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 py-1.5 px-2 rounded hover:bg-gray-100">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
