'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, Search, ChevronRight, Circle, ChevronUp, ChevronDown, ChevronsUpDown, Download, SlidersHorizontal, X, CheckSquare, Trash2 } from 'lucide-react';
import ClientImportModal from '@/components/ui/ClientImportModal';
import ToolLayout from '@/components/ui/ToolLayout';
import { Users } from 'lucide-react';

type ClientStatus = 'active' | 'hold' | 'inactive';

interface Client {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  contact_email: string | null;
  risk_rating: string | null;
  status: ClientStatus;
  created_at: string;
  address: string | null;
  utr_number: string | null;
  registration_number: string | null;
  national_insurance_number: string | null;
  companies_house_id: string | null;
  vat_number: string | null;
  companies_house_auth_code: string | null;
  date_of_birth: string | null;
}

const STATUS_CONFIG: Record<ClientStatus, { dot: string; label: string }> = {
  active:   { dot: 'text-green-500 fill-green-500', label: 'Active' },
  hold:     { dot: 'text-amber-500 fill-amber-500', label: 'On Hold' },
  inactive: { dot: 'text-[var(--text-muted)] fill-[var(--text-muted)]', label: 'Inactive' },
};

const CLIENT_TYPE_LABELS: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership', limited_company: 'Limited Company',
  individual: 'Individual', trust: 'Trust', charity: 'Charity', rental_landlord: 'Rental Landlord',
};

const RISK_STYLES: Record<string, string> = {
  Low: 'bg-green-100 text-green-700',
  Medium: 'bg-amber-100 text-amber-700',
  High: 'bg-red-100 text-red-700',
};

type StatusFilter = 'all' | 'active' | 'hold' | 'inactive';
type SortDir = 'asc' | 'desc';

interface SortConfig { key: keyof Client; dir: SortDir; }

interface ColDef {
  key: string;
  label: string;
  sortKey?: keyof Client;
  always?: boolean;
  defaultHidden?: boolean;
  render: (c: Client) => React.ReactNode;
}

const COLUMNS: ColDef[] = [
  {
    key: 'status', label: 'Status', always: true,
    render: c => <Circle size={9} className={(STATUS_CONFIG[c.status] ?? STATUS_CONFIG.inactive).dot} />,
  },
  {
    key: 'name', label: 'Client', sortKey: 'name', always: true,
    render: c => <span className="font-medium text-[var(--text-primary)]">{c.name}</span>,
  },
  {
    key: 'client_ref', label: 'Ref', sortKey: 'client_ref',
    render: c => <span className="text-[var(--text-muted)] font-mono text-xs">{c.client_ref ?? '—'}</span>,
  },
  {
    key: 'business_type', label: 'Type', sortKey: 'business_type',
    render: c => <span className="text-[var(--text-secondary)]">{c.business_type ? CLIENT_TYPE_LABELS[c.business_type] ?? c.business_type : '—'}</span>,
  },
  {
    key: 'contact_email', label: 'Email',
    render: c => <span className="text-[var(--text-muted)]">{c.contact_email ?? '—'}</span>,
  },
  {
    key: 'risk_rating', label: 'Risk', sortKey: 'risk_rating',
    render: c => c.risk_rating ? (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_STYLES[c.risk_rating] ?? 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>{c.risk_rating}</span>
    ) : <span className="text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'utr_number', label: 'UTR', defaultHidden: true,
    render: c => <span className="text-[var(--text-muted)] font-mono text-xs">{c.utr_number ?? '—'}</span>,
  },
  {
    key: 'vat_number', label: 'VAT No.', defaultHidden: true,
    render: c => <span className="text-[var(--text-muted)] font-mono text-xs">{c.vat_number ?? '—'}</span>,
  },
  {
    key: 'created_at', label: 'Created', sortKey: 'created_at', defaultHidden: true,
    render: c => <span className="text-[var(--text-muted)] text-xs">{new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>,
  },
];

const DEFAULT_VISIBLE = new Set(COLUMNS.filter(c => !c.defaultHidden).map(c => c.key));

function sortClients(clients: Client[], sort: SortConfig): Client[] {
  return [...clients].sort((a, b) => {
    const av = a[sort.key] ?? '';
    const bv = b[sort.key] ?? '';
    const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

function exportToCsv(clients: Client[]) {
  const headers = [
    'Name', 'Client Ref', 'Type', 'Email', 'Status', 'Risk Rating', 'Address',
    'UTR Number', 'Registration Number', 'National Insurance Number',
    'Companies House ID', 'VAT Number', 'Companies House Auth Code', 'Date of Birth', 'Created',
  ];
  const rows = clients.map(c => [
    c.name, c.client_ref ?? '', c.business_type ? (CLIENT_TYPE_LABELS[c.business_type] ?? c.business_type) : '',
    c.contact_email ?? '', (STATUS_CONFIG[c.status] ?? STATUS_CONFIG.inactive).label, c.risk_rating ?? '',
    c.address ?? '', c.utr_number ?? '', c.registration_number ?? '',
    c.national_insurance_number ?? '', c.companies_house_id ?? '',
    c.vat_number ?? '', c.companies_house_auth_code ?? '', c.date_of_birth ?? '',
    new Date(c.created_at).toLocaleDateString('en-GB'),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `clients_export_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function SortIcon({ colKey, sort }: { colKey: keyof Client; sort: SortConfig }) {
  if (sort.key !== colKey) return <ChevronsUpDown size={12} className="text-[var(--text-muted)] opacity-40" />;
  return sort.dir === 'asc' ? <ChevronUp size={12} className="text-[var(--accent)]" /> : <ChevronDown size={12} className="text-[var(--accent)]" />;
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [totalActiveCount, setTotalActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<SortConfig>({ key: 'name', dir: 'asc' });
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  // Selection state (admin only)
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [clientType, setClientType] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [newClientStatus, setNewClientStatus] = useState<ClientStatus>('active');

  const fetchClients = useCallback(async (q: string, status: StatusFilter, type: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: q });
      if (status !== 'all') params.set('status', status);
      if (type) params.set('type', type);
      const res = await fetch(`/api/clients?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
        if (data.userRole) setIsAdmin(data.userRole === 'admin');
      }
    } finally { setLoading(false); }
  }, []);

  // Clear selection whenever the displayed client list changes
  useEffect(() => { setSelectedIds(new Set()); }, [clients]);

  // Fetch total active count — re-runs after any import or create
  const fetchActiveCount = useCallback(async () => {
    try {
      const res = await fetch('/api/clients/count?status=active');
      if (res.ok) { const d = await res.json(); setTotalActiveCount(d.count ?? 0); }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { void fetchActiveCount(); }, [fetchActiveCount]);

  useEffect(() => {
    const timer = setTimeout(() => void fetchClients(search, statusFilter, typeFilter), 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter, typeFilter, fetchClients]);

  // Close col picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    }
    if (showColPicker) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColPicker]);

  const sortedClients = sortClients(clients, sort);
  const allSelected = sortedClients.length > 0 && sortedClients.every(c => selectedIds.has(c.id));
  const someSelected = sortedClients.some(c => selectedIds.has(c.id));

  // Drive indeterminate state on the select-all checkbox
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  function toggleSort(key: keyof Client) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  function toggleCol(key: string) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedClients.map(c => c.id)));
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkStatusChange(status: ClientStatus) {
    setBulkUpdating(true);
    setBulkError(null);
    try {
      const res = await fetch('/api/clients/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      const data = await res.json();
      if (!res.ok) { setBulkError(data.error || 'Failed to update clients'); return; }
      setSelectedIds(new Set());
      await fetchClients(search, statusFilter, typeFilter);
    } catch { setBulkError('An unexpected error occurred'); } finally { setBulkUpdating(false); }
  }

  async function handleBulkDelete() {
    setBulkUpdating(true);
    setBulkError(null);
    try {
      const res = await fetch('/api/clients/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) { setBulkError(data.error || 'Failed to delete clients'); return; }
      setShowDeleteConfirm(false);
      setSelectedIds(new Set());
      await fetchClients(search, statusFilter, typeFilter);
    } catch { setBulkError('An unexpected error occurred'); } finally { setBulkUpdating(false); }
  }

  const visibleColumns = COLUMNS.filter(c => c.always || visibleCols.has(c.key));
  const hasActiveFilters = !!(search || statusFilter !== 'all' || typeFilter);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setFormError(null); setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, client_ref: clientRef, business_type: clientType || undefined, contact_email: contactEmail || undefined, status: newClientStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Failed to create client'); return; }
      setShowModal(false); setName(''); setClientRef(''); setClientType(''); setContactEmail(''); setNewClientStatus('active');
      await Promise.all([fetchClients(search, statusFilter, typeFilter), fetchActiveCount()]);
    } catch { setFormError('An unexpected error occurred'); } finally { setSaving(false); }
  }

  function clearFilters() {
    setSearch(''); setStatusFilter('all'); setTypeFilter('');
  }

  return (
    <ToolLayout title="Clients" description="All client records for your firm." icon={Users} iconColor="#4F46E5">
      <div className="space-y-4">

        {/* Active client count */}
        {totalActiveCount !== null && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-medium">
              <Circle size={7} className="fill-green-500 text-green-500" />
              {totalActiveCount} active client{totalActiveCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Row 1: Search + actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 max-w-sm px-3 py-2 glass-solid rounded-lg border border-[var(--border-input)]">
            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ref…"
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative" ref={colPickerRef}>
              <button onClick={() => setShowColPicker(v => !v)}
                className={`btn-secondary text-xs py-1.5 ${showColPicker ? 'border-[var(--accent)]' : ''}`}>
                <SlidersHorizontal size={13} />Columns
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full mt-2 z-20 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-3 w-48 space-y-1">
                  <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide px-1 mb-2">Show / Hide Columns</p>
                  {COLUMNS.filter(c => !c.always).map(col => (
                    <label key={col.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] cursor-pointer transition-colors">
                      <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)} className="accent-[var(--accent)] w-3.5 h-3.5" />
                      <span className="text-sm text-[var(--text-primary)]">{col.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => exportToCsv(sortedClients)} className="btn-secondary text-xs py-1.5" title="Export to CSV">
              <Download size={13} />Export
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary"><Upload size={14} />Import CSV</button>
            <button onClick={() => { setShowModal(true); setFormError(null); }} className="btn-primary"><Plus size={14} />New Client</button>
          </div>
        </div>

        {/* Row 2: Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 glass-solid rounded-lg border border-[var(--border)] p-1">
            {([['all', 'All'], ['active', 'Active'], ['hold', 'On Hold'], ['inactive', 'Inactive']] as [StatusFilter, string][]).map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusFilter === val ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className={`input-base text-xs py-1.5 ${typeFilter ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}>
            <option value="">All Types</option>
            <option value="sole_trader">Sole Trader</option>
            <option value="partnership">Partnership</option>
            <option value="limited_company">Limited Company</option>
            <option value="individual">Individual</option>
            <option value="trust">Trust</option>
            <option value="charity">Charity</option>
            <option value="rental_landlord">Rental Landlord</option>
          </select>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-2 py-1.5">
              <X size={12} />Clear filters
            </button>
          )}
        </div>

        {/* Bulk action bar — admin only, visible when rows are selected */}
        {isAdmin && someSelected && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded-xl flex-wrap">
            <CheckSquare size={15} className="text-[var(--accent)] shrink-0" />
            <span className="text-sm font-medium text-[var(--accent)]">
              {selectedIds.size} client{selectedIds.size !== 1 ? 's' : ''} selected
            </span>
            <span className="text-[var(--accent)]/40 text-sm">·</span>
            <span className="text-xs text-[var(--text-muted)]">Set status to:</span>
            <div className="flex items-center gap-2">
              {([['active', 'Active', 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200'],
                 ['hold',   'On Hold', 'bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200'],
                 ['inactive', 'Inactive', 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200']] as [ClientStatus, string, string][]).map(([val, label, cls]) => (
                <button key={val} onClick={() => void handleBulkStatusChange(val)} disabled={bulkUpdating}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${cls}`}>
                  {bulkUpdating ? '…' : label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setShowDeleteConfirm(true)} disabled={bulkUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50">
                <Trash2 size={12} />Delete
              </button>
              <button onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X size={12} />Clear selection
              </button>
            </div>
            {bulkError && <p className="w-full text-xs text-red-600 mt-1">{bulkError}</p>}
          </div>
        )}

        {/* Table */}
        <div className="glass-solid rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-[var(--text-muted)] text-sm">Loading clients…</div>
          ) : sortedClients.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm text-[var(--text-muted)]">
                {hasActiveFilters ? 'No clients match your filters.' : 'No clients yet. Add your first client to get started.'}
              </p>
              {!hasActiveFilters && (
                <button onClick={() => setShowModal(true)} className="btn-primary mx-auto"><Plus size={14} />Add Client</button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--border)]">
                  <tr>
                    {/* Checkbox column — admin only */}
                    {isAdmin && (
                      <th className="px-4 py-3 w-10">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="accent-[var(--accent)] w-3.5 h-3.5 cursor-pointer"
                          title={allSelected ? 'Deselect all' : 'Select all'}
                        />
                      </th>
                    )}
                    {visibleColumns.map(col => (
                      <th key={col.key} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                        {col.sortKey ? (
                          <button
                            onClick={() => toggleSort(col.sortKey!)}
                            className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
                          >
                            {col.label}
                            <SortIcon colKey={col.sortKey} sort={sort} />
                          </button>
                        ) : col.label}
                      </th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {sortedClients.map(c => {
                    const checked = selectedIds.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => router.push(`/clients/${c.id}`)}
                        className={`cursor-pointer hover:bg-[var(--bg-nav-hover)] transition-colors group ${c.status === 'inactive' ? 'opacity-60' : ''} ${checked ? 'bg-[var(--accent-light)]' : ''}`}
                      >
                        {/* Checkbox cell — admin only; stops row-click propagation */}
                        {isAdmin && (
                          <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectOne(c.id)}
                              className="accent-[var(--accent)] w-3.5 h-3.5 cursor-pointer"
                            />
                          </td>
                        )}
                        {visibleColumns.map(col => (
                          <td key={col.key} className="px-4 py-3">{col.render(c)}</td>
                        ))}
                        <td className="px-4 py-3 text-right">
                          <ChevronRight size={14} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-60 transition-opacity inline-block" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          {sortedClients.length} client{sortedClients.length !== 1 ? 's' : ''}
          {hasActiveFilters ? ' matching filters' : ''}
          {isAdmin && someSelected && ` · ${selectedIds.size} selected`}
        </p>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="glass-solid rounded-2xl shadow-dropdown w-full max-w-sm border border-[var(--border)] animate-slide-up">
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-100 shrink-0">
                  <Trash2 size={18} className="text-red-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-[var(--text-primary)]">Delete {selectedIds.size} client{selectedIds.size !== 1 ? 's' : ''}?</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">This will permanently delete all selected client records, including their AI outputs, documents, and timeline notes. This cannot be undone.</p>
                </div>
              </div>
              {bulkError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{bulkError}</p>}
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => { setShowDeleteConfirm(false); setBulkError(null); }} disabled={bulkUpdating} className="btn-secondary">Cancel</button>
                <button onClick={() => void handleBulkDelete()} disabled={bulkUpdating}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50">
                  {bulkUpdating ? 'Deleting…' : `Delete ${selectedIds.size} client${selectedIds.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ClientImportModal onClose={() => setShowImport(false)} onImported={() => { void fetchClients(search, statusFilter, typeFilter); void fetchActiveCount(); }} />
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="glass-solid rounded-2xl shadow-dropdown w-full max-w-md border border-[var(--border)] animate-slide-up">
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="font-semibold text-[var(--text-primary)]">New Client</h2>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1">✕</button>
            </div>
            <form onSubmit={e => void handleCreate(e)} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Acme Ltd" className="input-base" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client Reference *</label>
                <input value={clientRef} onChange={e => setClientRef(e.target.value.toUpperCase())} required placeholder="e.g. MM001" className="input-base font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client Type</label>
                <select value={clientType} onChange={e => setClientType(e.target.value)} className="input-base">
                  <option value="">— Select —</option>
                  <option value="sole_trader">Sole Trader</option>
                  <option value="partnership">Partnership</option>
                  <option value="limited_company">Limited Company</option>
                  <option value="individual">Individual</option>
                  <option value="trust">Trust</option>
                  <option value="charity">Charity</option>
                  <option value="rental_landlord">Rental Landlord</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Contact Email</label>
                <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="client@example.com" className="input-base" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Status</label>
                <div className="flex items-center gap-1 glass-solid rounded-lg border border-[var(--border)] p-1">
                  {([['active', 'Active'], ['hold', 'On Hold'], ['inactive', 'Inactive']] as [ClientStatus, string][]).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setNewClientStatus(val)}
                      className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${newClientStatus === val ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {formError && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving || !name || !clientRef} className="btn-primary">
                  {saving ? 'Creating…' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
