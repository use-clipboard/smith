'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePersistedColumns } from '@/lib/usePersistedColumns';
import {
  Receipt, Plus, Search, Download, FolderOpen, Trash2, Loader2,
  ChevronUp, ChevronDown, ChevronsUpDown, SlidersHorizontal, User as UserIcon,
  X, AlertTriangle, Filter, CheckSquare, ChevronRight, Mail,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import HistoryActions from '@/components/ui/HistoryActions';
import { downloadCsv, csvFilename } from '@/utils/exportToCsv';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import { logAuditClient } from '@/utils/auditClient';

// ── Types ──────────────────────────────────────────────────────────────────
export interface HistoryUser { id: string; full_name: string | null; email: string }
export interface HistoryClient { id: string; name: string; client_ref: string | null; vat_number?: string | null }

export interface P32HistoryRow {
  id: string;
  feature: string;
  client_id: string | null;
  client_name: string | null;
  user_id: string | null;
  transaction_count: number | null; // emailBody length
  source_filenames: string[] | null;
  created_at: string;
  user: HistoryUser | null;
  client: HistoryClient | null;
}

export interface P32Seed {
  id: string;
  client: HistoryClient | null;
  emailBody: string;
}

interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onNew: () => void;
  onOpen: (seed: P32Seed) => void;
}

type SortKey = 'created_at' | 'client_name';

interface ColumnConfig {
  key: 'date' | 'user' | 'client' | 'source_file';
  label: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'date',        label: 'Date',         defaultVisible: true },
  { key: 'user',        label: 'User',         defaultVisible: true },
  { key: 'client',      label: 'Client',       defaultVisible: true },
  { key: 'source_file', label: 'Source file',  defaultVisible: true },
];

const COLUMN_PREF_KEY = 'smith.p32.history.columns';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function downloadEmailBodyAsTxt(emailBody: string, filename: string) {
  const blob = new Blob([emailBody], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function P32History({ currentUserId, isAdmin, onNew, onOpen }: Props) {
  const [rows, setRows]         = useState<P32HistoryRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [search, setSearch]     = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [visibleCols, setVisibleCols] = usePersistedColumns(
    COLUMN_PREF_KEY,
    COLUMNS.map(c => c.key),
    COLUMNS.filter(c => c.defaultVisible).map(c => c.key),
  );
  const [showColMenu, setShowColMenu] = useState(false);



  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  // Lazy-fetched detail (email body preview) for the expanded panel
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [rowDetail, setRowDetail] = useState<Record<string, { loading: boolean; error?: string; emailBody?: string }>>({});

  const fetchOutput = useCallback(async (id: string) => {
    const res = await fetch(`/api/outputs/${id}`);
    if (!res.ok) throw new Error('Failed to fetch summary');
    const { output } = await res.json();
    return output as { result_data: Record<string, unknown>; client: HistoryClient | null; client_name: string | null; created_at: string };
  }, []);

  const toggleExpand = async (id: string) => {
    const isOpen = expandedIds.has(id);
    setExpandedIds(prev => {
      const next = new Set(prev);
      isOpen ? next.delete(id) : next.add(id);
      return next;
    });
    if (isOpen) return;
    if (rowDetail[id]?.emailBody !== undefined) return;
    setRowDetail(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const output = await fetchOutput(id);
      const rd = output.result_data as { emailBody?: string };
      setRowDetail(prev => ({ ...prev, [id]: { loading: false, emailBody: rd.emailBody ?? '' } }));
    } catch (e) {
      setRowDetail(prev => ({ ...prev, [id]: { loading: false, error: e instanceof Error ? e.message : 'Failed to load' } }));
    }
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({
      feature: 'p32_summary',
      sort: sortKey,
      dir: sortDir,
    });
    if (search.trim()) params.set('search', search.trim());
    if (mineOnly)      params.set('mine_only', '1');
    if (dateFrom)      params.set('date_from', dateFrom);
    if (dateTo)        params.set('date_to', dateTo);

    try {
      const res = await fetch(`/api/outputs?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to load history');
      }
      const data = await res.json();
      setRows(data.outputs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, mineOnly, dateFrom, dateTo, sortKey, sortDir]);

  useEffect(() => { void load(); }, [load]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (r.client_name?.toLowerCase().includes(q)) return true;
      if (r.client?.name?.toLowerCase().includes(q)) return true;
      if (r.client?.client_ref?.toLowerCase().includes(q)) return true;
      if (r.user?.full_name?.toLowerCase().includes(q)) return true;
      if (r.user?.email?.toLowerCase().includes(q)) return true;
      if (r.source_filenames?.some(f => f.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [rows, search]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th
        onClick={() => handleSort(k)}
        className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'} text-left`}
      >
        <div className="flex items-center gap-1">
          {label}<Icon size={11} className={active ? 'text-[var(--accent)]' : 'opacity-40'} />
        </div>
      </th>
    );
  };
  const StaticHeader = ({ label }: { label: string }) => (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] text-left">{label}</th>
  );

  const downloadOutputAsTxt = async (id: string, output?: { result_data: Record<string, unknown>; client: HistoryClient | null; client_name: string | null; created_at: string }) => {
    const data = output ?? await fetchOutput(id);
    const rd = data.result_data as { emailBody?: string };
    const body = rd.emailBody ?? '';
    if (!body.trim()) { alert('This summary has no email body to download.'); return; }
    const dateStr = new Date(data.created_at).toISOString().slice(0, 10);
    const clientPart = data.client?.client_ref || data.client_name || 'p32';
    downloadEmailBodyAsTxt(body, `${clientPart}_p32_summary_${dateStr}.txt`);
  };

  const handleDownload = async (id: string) => {
    setBusyId(id);
    try {
      await downloadOutputAsTxt(id);
      void logAuditClient({ tool: 'p32_summary', action: 'downloaded', entityId: id, summary: 'Downloaded the P32 summary' });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleOpen = async (id: string) => {
    setBusyId(id);
    try {
      const output = await fetchOutput(id);
      const rd = output.result_data as { emailBody?: string };
      onOpen({
        id,
        client: output.client,
        emailBody: rd.emailBody ?? '',
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Open failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/outputs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Delete failed');
      }
      setRows(prev => prev.filter(r => r.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const clearSelection = () => { setSelectedIds(new Set()); setBulkConfirm(false); };

  const handleBulkDownload = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      for (const id of ids) {
        try { await downloadOutputAsTxt(id); await new Promise(r => setTimeout(r, 200)); }
        catch {/* skip */}
      }
    } finally { setBulkBusy(false); }
  };

  const handleBulkDelete = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.allSettled(
        ids.map(id => fetch(`/api/outputs/${id}`, { method: 'DELETE' }).then(r => ({ id, ok: r.ok })))
      );
      const deleted = new Set(
        results
          .filter(r => r.status === 'fulfilled' && r.value.ok)
          .map(r => (r as PromiseFulfilledResult<{ id: string; ok: boolean }>).value.id)
      );
      setRows(prev => prev.filter(r => !deleted.has(r.id)));
      setSelectedIds(prev => { const next = new Set(prev); deleted.forEach(id => next.delete(id)); return next; });
      setBulkConfirm(false);
      const failed = ids.length - deleted.size;
      if (failed > 0) alert(`${failed} could not be deleted (you may not have permission).`);
    } finally { setBulkBusy(false); }
  };

  const toggleCol = (key: string) => {
    setVisibleCols(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };
  const colVisible = (k: string) => visibleCols.has(k);

  const visibleColCount = COLUMNS.filter(c => colVisible(c.key)).length;
  const totalColSpan = visibleColCount + 3; // expand + select + actions

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(r.id));
  const someVisibleSelected = !allVisibleSelected && filteredRows.some(r => selectedIds.has(r.id));
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => { const next = new Set(prev); filteredRows.forEach(r => next.delete(r.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); filteredRows.forEach(r => next.add(r.id)); return next; });
    }
  };

  const hasActiveFilters = !!(mineOnly || dateFrom || dateTo);

  const exportCsv = () => {
    const headers = ['Date', 'User', 'Client', 'Client ref', 'Source file'];
    const csvRows = filteredRows.map(row => {
      const userName = row.user?.full_name ?? row.user?.email ?? 'Unknown';
      const clientName = row.client?.name ?? row.client_name ?? '';
      const clientRef = row.client?.client_ref ?? '';
      const sourceFile = row.source_filenames?.[0] ?? '';
      return [formatDate(row.created_at), userName, clientName, clientRef, sourceFile];
    });
    downloadCsv(csvFilename('p32_summaries'), headers, csvRows);
  };

  return (
    <ToolLayout title="P32 Summary" icon={Receipt} iconColor="#CA8A04" wide>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, user, or filename…"
            className="input-base w-full pl-9 pr-9"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
              <X size={13} />
            </button>
          )}
        </div>

        <Tooltip label={mineOnly ? 'Showing only your summaries' : 'Show only my summaries'}>
          <button
            onClick={() => setMineOnly(v => !v)}
            aria-label="Toggle mine only"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold transition-colors ${
              mineOnly ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                       : 'bg-white border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <UserIcon size={13} />
            <span>Mine</span>
          </button>
        </Tooltip>

        <Tooltip label="Filters">
          <button
            onClick={() => setShowFilters(v => !v)}
            aria-label="Toggle filters"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/30'
                : 'bg-white border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <Filter size={13} />
            <span>Filter{hasActiveFilters ? ' ·' : ''}</span>
            {hasActiveFilters && <span className="text-[10px] font-bold">on</span>}
          </button>
        </Tooltip>

        <div className="relative">
          <Tooltip label="Show / hide columns">
            <button
              onClick={() => setShowColMenu(v => !v)}
              aria-label="Show or hide columns"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border bg-white border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] text-xs font-semibold transition-colors"
            >
              <SlidersHorizontal size={13} />
              <span>Columns</span>
            </button>
          </Tooltip>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowColMenu(false)} />
              <div className="absolute right-0 mt-2 z-40 w-52 bg-white border border-[var(--border)] rounded-xl shadow-xl p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] px-2 py-1">Columns</p>
                {COLUMNS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] cursor-pointer">
                    <input type="checkbox" checked={colVisible(c.key)} onChange={() => toggleCol(c.key)} className="rounded" />
                    <span className="text-sm text-[var(--text-primary)]">{c.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <HistoryActions onExport={exportCsv} exportDisabled={filteredRows.length === 0} audit={{ tool: 'p32_summary', isAdmin }} />
          <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
            <Plus size={14} />
            New Summary
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-4 p-4 bg-[var(--bg-nav-hover)] border border-[var(--border)] rounded-xl flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base text-sm h-9" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base text-sm h-9" />
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setMineOnly(false); }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded-xl">
          <CheckSquare size={15} className="text-[var(--accent)]" />
          <span className="text-sm font-medium text-[var(--accent)]">{selectedIds.size} selected</span>
          <div className="flex-1" />
          {bulkConfirm ? (
            <>
              <span className="text-xs text-red-600 font-medium">Delete {selectedIds.size}?</span>
              <button onClick={() => void handleBulkDelete()} disabled={bulkBusy} className="px-3 py-1 text-xs bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : null} Yes, delete
              </button>
              <button onClick={() => setBulkConfirm(false)} disabled={bulkBusy} className="px-3 py-1 text-xs border border-[var(--border)] text-[var(--text-muted)] rounded-full hover:bg-white">Cancel</button>
            </>
          ) : (
            <>
              <Tooltip label="Download selected as .txt">
                <button onClick={() => void handleBulkDownload()} disabled={bulkBusy} aria-label="Download selected" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-emerald-600 hover:border-emerald-300 disabled:opacity-50">
                  {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Download
                </button>
              </Tooltip>
              <Tooltip label="Delete selected (admin or owner only)">
                <button onClick={() => setBulkConfirm(true)} disabled={bulkBusy} aria-label="Delete selected" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-red-600 hover:border-red-300 disabled:opacity-50">
                  <Trash2 size={12} /> Delete
                </button>
              </Tooltip>
              <button onClick={clearSelection} disabled={bulkBusy} aria-label="Clear selection" className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-xs font-medium text-[var(--text-muted)] hover:bg-white">
                <X size={12} /> Clear
              </button>
            </>
          )}
        </div>
      )}

      <div className="bg-white/85 backdrop-blur-md border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-[var(--border)]">
              <tr>
                <th className="px-2 py-3 w-7"></th>
                <th className="px-3 py-3 w-9">
                  <button
                    onClick={toggleAllVisible}
                    aria-label={allVisibleSelected ? 'Deselect all' : 'Select all'}
                    className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                      ${allVisibleSelected ? 'bg-[var(--accent)] border-[var(--accent)]'
                        : someVisibleSelected ? 'bg-[var(--accent-light)] border-[var(--accent)]'
                        : 'border-gray-300 hover:border-[var(--accent)] bg-white'}`}
                  >
                    {allVisibleSelected && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                    {someVisibleSelected && !allVisibleSelected && <div className="w-2 h-0.5 bg-[var(--accent)] rounded" />}
                  </button>
                </th>
                {colVisible('date')        && <SortHeader label="Date" k="created_at" />}
                {colVisible('user')        && <StaticHeader label="User" />}
                {colVisible('client')      && <SortHeader label="Client" k="client_name" />}
                {colVisible('source_file') && <StaticHeader label="Source file" />}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={totalColSpan} className="text-center py-12 text-[var(--text-muted)]">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  Loading P32 summaries…
                </td></tr>
              )}

              {!loading && error && (
                <tr><td colSpan={totalColSpan} className="text-center py-10">
                  <div className="inline-flex items-center gap-2 text-red-600 text-sm">
                    <AlertTriangle size={14} />{error}
                  </div>
                </td></tr>
              )}

              {!loading && !error && filteredRows.length === 0 && (
                <tr><td colSpan={totalColSpan} className="text-center py-12">
                  <Receipt size={28} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    {hasActiveFilters || search ? 'No P32 summaries match your filters.' : 'No P32 summaries yet. Run your first one to get started.'}
                  </p>
                  <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
                    <Plus size={14} /> New Summary
                  </button>
                </td></tr>
              )}

              {!loading && !error && filteredRows.map(row => {
                const isBusy = busyId === row.id;
                const confirming = confirmDeleteId === row.id;
                const canDelete = isAdmin || row.user_id === currentUserId;
                const userName = row.user?.full_name ?? row.user?.email ?? 'Unknown';
                const fileCount = row.source_filenames?.length ?? 0;
                const isSelected = selectedIds.has(row.id);
                const isExpanded = expandedIds.has(row.id);
                const detail = rowDetail[row.id];

                return (
                  <>
                    <tr key={row.id} className={`border-b border-gray-100 last:border-0 transition-colors ${isSelected ? 'bg-[var(--accent-light)]/40' : 'hover:bg-indigo-50/30'}`}>
                      <td className="px-2 py-3 w-7">
                        <button
                          onClick={() => void toggleExpand(row.id)}
                          aria-label={isExpanded ? 'Collapse' : 'Expand to see email preview'}
                          className={`p-1 rounded text-gray-400 hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-all ${isExpanded ? 'rotate-90 text-[var(--accent)]' : ''}`}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </td>
                      <td className="px-3 py-3 w-9">
                        <button
                          onClick={() => toggleRow(row.id)}
                          aria-label={isSelected ? 'Deselect row' : 'Select row'}
                          className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all
                            ${isSelected ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-gray-300 hover:border-[var(--accent)] bg-white'}`}
                        >
                          {isSelected && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                        </button>
                      </td>
                      {colVisible('date') && (
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-[var(--text-secondary)]">{formatDate(row.created_at)}</td>
                      )}
                      {colVisible('user') && (
                        <td className="px-4 py-3">
                          {row.user ? (
                            <Tooltip label={userName}>
                              <div className="inline-flex items-center gap-2">
                                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${avatarColour(row.user.id)}`}>
                                  {initials(row.user.full_name, row.user.email)}
                                </div>
                                <span className="text-sm text-[var(--text-secondary)] truncate max-w-[120px]">
                                  {row.user.full_name?.split(' ')[0] ?? row.user.email}
                                </span>
                              </div>
                            </Tooltip>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      )}
                      {colVisible('client') && (
                        <td className="px-4 py-3 max-w-[220px]">
                          {row.client ? (
                            <div className="min-w-0">
                              <span className="text-sm text-[var(--text-primary)] font-medium truncate block">{row.client.name}</span>
                              {row.client.client_ref && <span className="text-[10px] font-mono text-gray-400">{row.client.client_ref}</span>}
                            </div>
                          ) : row.client_name ? (
                            <span className="text-sm text-[var(--text-secondary)]">{row.client_name}</span>
                          ) : <span className="text-xs text-gray-400 italic">No client</span>}
                        </td>
                      )}
                      {colVisible('source_file') && (
                        <td className="px-4 py-3 max-w-[260px]">
                          {fileCount > 0 ? (
                            <span className="text-xs text-[var(--text-muted)] truncate block">
                              {row.source_filenames?.[0]}
                            </span>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      )}

                      <td className="px-4 py-3">
                        {confirming ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-xs text-red-600 font-medium">Delete?</span>
                            <button onClick={() => void handleDelete(row.id)} disabled={isBusy} className="px-2.5 py-1 text-xs bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50">
                              {isBusy ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Yes'}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} className="px-2.5 py-1 text-xs border border-[var(--border)] text-[var(--text-muted)] rounded-full hover:bg-[var(--bg-nav-hover)]">No</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip label="Open in tool to edit">
                              <button onClick={() => void handleOpen(row.id)} disabled={isBusy} aria-label="Open in tool" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors">
                                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
                              </button>
                            </Tooltip>
                            <Tooltip label="Download as .txt">
                              <button onClick={() => void handleDownload(row.id)} disabled={isBusy} aria-label="Download as text" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors">
                                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                              </button>
                            </Tooltip>
                            {canDelete && (
                              <Tooltip label="Delete">
                                <button onClick={() => setConfirmDeleteId(row.id)} aria-label="Delete summary" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* ── Expanded panel: email body preview ── */}
                    {isExpanded && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={totalColSpan} className="px-0 py-0 bg-gray-50/70">
                          <div className="mx-4 mb-3 mt-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            {detail?.loading && (
                              <div className="p-6 text-center text-sm text-[var(--text-muted)]">
                                <Loader2 size={18} className="animate-spin mx-auto mb-2" />
                                Loading email…
                              </div>
                            )}
                            {detail?.error && (
                              <div className="p-6 text-center text-sm text-red-600">
                                <AlertTriangle size={14} className="inline mr-1.5" />{detail.error}
                              </div>
                            )}
                            {detail && !detail.loading && !detail.error && (
                              <>
                                <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                                  <Mail size={14} className="text-gray-500" />
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Generated email</span>
                                </div>
                                <div className="px-4 py-3">
                                  {detail.emailBody?.trim() ? (
                                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{detail.emailBody}</pre>
                                  ) : (
                                    <p className="text-xs text-gray-400 italic">(empty)</p>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </ToolLayout>
  );
}
