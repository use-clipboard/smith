'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, Loader2 } from 'lucide-react';
import type { TaskStatus } from '@/types';

interface ClientOption {
  id: string;
  name: string;
  client_ref: string;
  status?: string | null;
}

interface TaskFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: TaskStatus | 'all';
  onStatusChange: (v: TaskStatus | 'all') => void;
  clientFilter: string;
  onClientChange: (v: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  clients: { id: string; name: string }[];          // kept for backwards-compat, no longer used for dropdown
  teamMembers: { id: string; full_name: string | null; email: string }[];
  onClear: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all',               label: 'All Statuses' },
  { value: 'not_started',       label: 'Not Started' },
  { value: 'in_progress',       label: 'In Progress' },
  { value: 'waiting_on_client', label: 'Waiting on Client' },
  { value: 'records_here',      label: 'Records Here' },
  { value: 'review',            label: 'Review' },
  { value: 'complete',          label: 'Complete' },
];

const STATUS_COLOURS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  hold:     'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-500',
};

const PINNED: { value: string; label: string }[] = [
  { value: '',         label: 'All Clients' },
  { value: 'internal', label: 'Internal Only' },
];

export default function TaskFilters({
  search, onSearchChange,
  statusFilter, onStatusChange,
  clientFilter, onClientChange,
  assigneeFilter, onAssigneeChange,
  teamMembers, onClear,
}: TaskFiltersProps) {
  // ── Client live-search state ──────────────────────────────────────────────
  const [clientOpen, setClientOpen]       = useState(false);
  const [clientSearch, setClientSearch]   = useState('');
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [selectedName, setSelectedName]   = useState('');
  const clientRef = useRef<HTMLDivElement>(null);
  const clientInputRef = useRef<HTMLInputElement>(null);

  // Sync display label when filter is reset externally (e.g. "Clear" button)
  useEffect(() => {
    if (!clientFilter)            setSelectedName('');
    if (clientFilter === 'internal') setSelectedName('Internal Only');
  }, [clientFilter]);

  const fetchClients = useCallback(async (q: string) => {
    setClientLoading(true);
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}`);
      if (r.ok) {
        const d = await r.json();
        setClientOptions(d.clients ?? []);
      }
    } finally {
      setClientLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!clientOpen) return;
    const t = setTimeout(() => void fetchClients(clientSearch), 200);
    return () => clearTimeout(t);
  }, [clientOpen, clientSearch, fetchClients]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientRef.current && !clientRef.current.contains(e.target as Node))
        setClientOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function openClientDrop() {
    setClientSearch('');
    setClientOpen(true);
    setTimeout(() => clientInputRef.current?.focus(), 40);
  }

  function selectClient(id: string, label: string) {
    onClientChange(id);
    setSelectedName(label);
    setClientOpen(false);
    setClientSearch('');
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const hasFilters = search || statusFilter !== 'all' || clientFilter || assigneeFilter;

  const clientLabel = clientFilter === ''         ? 'All Clients'
                    : clientFilter === 'internal' ? 'Internal Only'
                    : selectedName || 'Client selected';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search task, client, or code…"
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

      {/* Client live-search picker */}
      <div ref={clientRef} className="relative">
        <button
          type="button"
          onClick={openClientDrop}
          className={`flex items-center gap-2 py-1.5 pl-2.5 pr-2 text-sm border rounded-md bg-white transition-colors min-w-[160px] max-w-[260px] ${
            clientFilter ? 'border-indigo-400 text-indigo-700' : 'border-gray-200 text-gray-700'
          } hover:border-indigo-400`}
        >
          <span className="flex-1 text-left truncate">{clientLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        </button>

        {clientOpen && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden w-80">
            {/* Search input */}
            <div className="p-2 border-b border-gray-100">
              <div className="flex items-center gap-2 px-2 py-1 border border-gray-200 rounded-lg bg-gray-50">
                <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                <input
                  ref={clientInputRef}
                  type="text"
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="Search clients…"
                  className="flex-1 text-sm bg-transparent outline-none text-gray-800 placeholder-gray-400 min-w-0"
                />
                {clientLoading && <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin flex-shrink-0" />}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {/* Pinned options */}
              {!clientSearch && PINNED.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => selectClient(p.value, p.label)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2 ${
                    clientFilter === p.value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}

              {/* Divider after pinned */}
              {!clientSearch && <div className="border-t border-gray-100 mx-2" />}

              {/* Live results */}
              {!clientLoading && clientOptions.length === 0 && clientSearch ? (
                <p className="text-xs text-center text-gray-400 py-5">No clients found</p>
              ) : (
                clientOptions.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectClient(c.id, c.name)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2 ${
                      clientFilter === c.id ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <span className="flex-1 font-medium text-gray-900 truncate">{c.name}</span>
                    <span className="text-xs text-gray-400 font-mono flex-shrink-0">{c.client_ref}</span>
                    {c.status && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLOURS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {c.status === 'hold' ? 'On Hold' : c.status}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

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
