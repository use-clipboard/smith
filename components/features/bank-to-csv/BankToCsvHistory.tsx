'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePersistedColumns } from '@/lib/usePersistedColumns';
import {
  ArrowLeftRight, Plus, Search, Download, FolderOpen, Trash2, Loader2,
  ChevronUp, ChevronDown, ChevronsUpDown, SlidersHorizontal, User as UserIcon,
  X, AlertTriangle, Filter, CheckSquare,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import { exportToCsv } from '@/utils/fileUtils';
import type { BankCsvTransaction } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────
export interface HistoryUser { id: string; full_name: string | null; email: string }
export interface HistoryClient { id: string; name: string; client_ref: string | null; vat_number?: string | null }

export interface BankCsvHistoryRow {
  id: string;
  feature: string;
  client_id: string | null;
  client_name: string | null;
  user_id: string | null;
  transaction_count: number | null;
  source_filenames: string[] | null;
  created_at: string;
  user: HistoryUser | null;
  client: HistoryClient | null;
}

export interface BankCsvSeed {
  id: string;
  client: HistoryClient | null;
  transactions: BankCsvTransaction[];
}

interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onNew: () => void;
  onOpen: (seed: BankCsvSeed) => void;
}

type SortKey = 'created_at' | 'client_name' | 'transaction_count';

interface ColumnConfig {
  key: 'date' | 'user' | 'client' | 'tx_count' | 'file_count' | 'files';
  label: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'date',       label: 'Date',         defaultVisible: true },
  { key: 'user',       label: 'User',         defaultVisible: true },
  { key: 'client',     label: 'Client',       defaultVisible: true },
  { key: 'tx_count',   label: '# Tx',         defaultVisible: true },
  { key: 'file_count', label: '# Files',      defaultVisible: false },
  { key: 'files',      label: 'Source files', defaultVisible: false },
];

const COLUMN_PREF_KEY = 'smith.bank-to-csv.history.columns';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────
export default function BankToCsvHistory({ currentUserId, isAdmin, onNew, onOpen }: Props) {
  const [rows, setRows]         = useState<BankCsvHistoryRow[]>([]);
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

  // ── Fetch list ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({
      feature: 'bank_to_csv',
      sort: sortKey,
      dir: sortDir,
    });
    if (search.trim())   params.set('search', search.trim());
    if (mineOnly)        params.set('mine_only', '1');
    if (dateFrom)        params.set('date_from', dateFrom);
    if (dateTo)          params.set('date_to', dateTo);

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

  // ── Sort header ─────────────────────────────────────────────────────────
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const SortHeader = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th
        onClick={() => handleSort(k)}
        className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'} ${right ? 'text-right' : 'text-left'}`}
      >
        <div className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {label}<Icon size={11} className={active ? 'text-[var(--accent)]' : 'opacity-40'} />
        </div>
      </th>
    );
  };
  const StaticHeader = ({ label, right }: { label: string; right?: boolean }) => (
    <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] ${right ? 'text-right' : 'text-left'}`}>{label}</th>
  );

  // ── Re-download CSV from saved data ─────────────────────────────────────
  const downloadCsv = (output: { result_data: Record<string, unknown>; client?: { client_ref?: string | null } | null; client_name?: string | null; created_at: string }) => {
    const rd = output.result_data as { transactions?: BankCsvTransaction[] };
    const txs = rd.transactions ?? [];
    if (txs.length === 0) { alert('This analysis has no transactions to download.'); return; }
    const dateStr = new Date(output.created_at).toISOString().slice(0, 10);
    const clientPart = output.client?.client_ref || output.client_name || 'bank';
    const filename = `${clientPart}_bank_${dateStr}.csv`;
    exportToCsv(txs as unknown as Record<string, unknown>[], filename);
  };

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleDownload = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/outputs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch analysis');
      const { output } = await res.json();
      downloadCsv(output);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleOpen = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/outputs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch analysis');
      const { output } = await res.json();
      onOpen({
        id: output.id,
        client: output.client,
        transactions: output.result_data?.transactions ?? [],
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

  // ── Multi-select ────────────────────────────────────────────────────────
  const toggleRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearSelection = () => { setSelectedIds(new Set()); setBulkConfirm(false); };

  const handleBulkDownload = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      for (const id of ids) {
        const res = await fetch(`/api/outputs/${id}`);
        if (!res.ok) continue;
        const { output } = await res.json();
        downloadCsv(output);
        await new Promise(r => setTimeout(r, 250));
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

  // ── Column toggle ───────────────────────────────────────────────────────
  const toggleCol = (key: string) => {
    setVisibleCols(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };
  const colVisible = (k: string) => visibleCols.has(k);

  const visibleColCount = COLUMNS.filter(c => colVisible(c.key)).length;
  const totalColSpan = visibleColCount + 2;

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

  return (
    <ToolLayout title="Bank to CSV" icon={ArrowLeftRight} iconColor="#0891B2" wide>

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

        <Tooltip label={mineOnly ? 'Showing only your runs' : 'Show only my runs'}>
          <button
            onClick={() => setMineOnly(v => !v)}
            aria-label="Toggle mine only"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold transition-colors ${
              mineOnly
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
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

        <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
          <Plus size={14} />
          New
        </button>
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
              <Tooltip label="Download selected as CSVs">
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
                {colVisible('date')       && <SortHeader label="Date" k="created_at" />}
                {colVisible('user')       && <StaticHeader label="User" />}
                {colVisible('client')     && <SortHeader label="Client" k="client_name" />}
                {colVisible('tx_count')   && <SortHeader label="# Tx" k="transaction_count" right />}
                {colVisible('file_count') && <StaticHeader label="# Files" right />}
                {colVisible('files')      && <StaticHeader label="Source files" />}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={totalColSpan} className="text-center py-12 text-[var(--text-muted)]">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  Loading…
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
                  <ArrowLeftRight size={28} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    {hasActiveFilters || search ? 'No runs match your filters.' : 'No bank statements processed yet.'}
                  </p>
                  <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
                    <Plus size={14} /> New
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

                return (
                  <tr key={row.id} className={`border-b border-gray-100 last:border-0 transition-colors ${isSelected ? 'bg-[var(--accent-light)]/40' : 'hover:bg-indigo-50/30'}`}>
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
                    {colVisible('tx_count') && (
                      <td className="px-4 py-3 text-right tabular-nums text-sm text-[var(--text-secondary)]">{row.transaction_count ?? '—'}</td>
                    )}
                    {colVisible('file_count') && (
                      <td className="px-4 py-3 text-right tabular-nums text-sm text-[var(--text-secondary)]">{fileCount || '—'}</td>
                    )}
                    {colVisible('files') && (
                      <td className="px-4 py-3 max-w-[260px]">
                        {fileCount > 0 ? (
                          <Tooltip label={(row.source_filenames ?? []).join('\n')}>
                            <span className="text-xs text-[var(--text-muted)] truncate block">
                              {row.source_filenames?.[0]}{fileCount > 1 ? ` +${fileCount - 1}` : ''}
                            </span>
                          </Tooltip>
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
                          <Tooltip label="Open in tool">
                            <button onClick={() => void handleOpen(row.id)} disabled={isBusy} aria-label="Open" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors">
                              {isBusy ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
                            </button>
                          </Tooltip>
                          <Tooltip label="Download CSV">
                            <button onClick={() => void handleDownload(row.id)} disabled={isBusy} aria-label="Download CSV" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors">
                              {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                            </button>
                          </Tooltip>
                          {canDelete && (
                            <Tooltip label="Delete">
                              <button onClick={() => setConfirmDeleteId(row.id)} aria-label="Delete" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-colors">
                                <Trash2 size={13} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </ToolLayout>
  );
}
