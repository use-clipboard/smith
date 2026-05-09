'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp, Plus, Search, Download, FolderOpen, Trash2, Loader2,
  ChevronUp, ChevronDown, ChevronsUpDown, SlidersHorizontal, User as UserIcon,
  X, AlertTriangle, Filter, CheckSquare, ChevronRight, Check,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import { generatePdfBlob, downloadBlob } from '@/utils/pdfFromHtml';

// ── Section catalog (kept in sync with PERFORMANCE_SECTIONS in /app/(app)/performance/page.tsx) ──
const SECTION_LABELS: Record<string, string> = {
  executive_summary:    'Executive Summary',
  financial_performance:'Financial Performance',
  margin_analysis:      'Margin Analysis',
  comparative:          'Year-on-Year Comparison',
  kpi_dashboard:        'KPI Dashboard',
  industry_benchmarking:'Actual vs Industry Averages',
  swot:                 'SWOT Analysis',
  budget_vs_actual:     'Budget vs Actual',
  cashflow_forecast:    'Rolling Cashflow Forecast',
  projections:          'Forecasts & Projections',
  strategy_advice:      'Performance Strategy Advice',
  tax_strategy:         'Tax Strategy Planning',
};

const PERIOD_LABELS: Record<string, string> = {
  yearly: 'Yearly', quarterly: 'Quarterly', monthly: 'Monthly', custom: 'Custom',
};

// ── Types ──────────────────────────────────────────────────────────────────
export interface HistoryUser { id: string; full_name: string | null; email: string }
export interface HistoryClient { id: string; name: string; client_ref: string | null; vat_number?: string | null; business_type?: string | null }

export interface PerformanceHistoryRow {
  id: string;
  feature: string;
  target_software: string | null; // we re-use this for analysis period type
  client_id: string | null;
  client_name: string | null;
  user_id: string | null;
  transaction_count: number | null; // # selected sections
  source_filenames: string[] | null;
  created_at: string;
  user: HistoryUser | null;
  client: HistoryClient | null;
}

export interface PerformanceSeed {
  id: string;
  client: HistoryClient | null;
  paBusinessName: string;
  paBusinessType: string;
  paBusinessTrade: string;
  paTradingLocation: string;
  paRelevantInfo: string;
  paAnalysisPeriod: string;
  paAnalysisPeriodDescription: string;
  selectedSections: string[];
  reportHtml: string;
  editorHtml: string;
  titlePageHtml: string;
}

interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onNew: () => void;
  onOpen: (seed: PerformanceSeed) => void;
}

type SortKey = 'created_at' | 'client_name' | 'transaction_count';

interface ColumnConfig {
  key: 'date' | 'user' | 'client' | 'period_type' | 'period_desc' | 'section_count' | 'file_count' | 'files';
  label: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'date',          label: 'Date',           defaultVisible: true },
  { key: 'user',          label: 'User',           defaultVisible: true },
  { key: 'client',        label: 'Client',         defaultVisible: true },
  { key: 'period_type',   label: 'Period',         defaultVisible: true },
  { key: 'period_desc',   label: 'Period covered', defaultVisible: true },
  { key: 'section_count', label: '# Sections',     defaultVisible: true },
  { key: 'file_count',    label: '# Files',        defaultVisible: false },
  { key: 'files',         label: 'Source files',   defaultVisible: false },
];

const COLUMN_PREF_KEY = 'smith.performance.history.columns';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────
export default function PerformanceHistory({ currentUserId, isAdmin, onNew, onOpen }: Props) {
  const [rows, setRows]         = useState<PerformanceHistoryRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [search, setSearch]     = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );
  const [colsHydrated, setColsHydrated] = useState(false);
  const [showColMenu, setShowColMenu] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLUMN_PREF_KEY);
      if (stored) setVisibleCols(new Set(JSON.parse(stored) as string[]));
    } catch {/* ignore */}
    setColsHydrated(true);
  }, []);

  useEffect(() => {
    if (!colsHydrated) return;
    try { window.localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify([...visibleCols])); } catch {/* ignore */}
  }, [visibleCols, colsHydrated]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [rowDetail, setRowDetail] = useState<Record<string, { loading: boolean; error?: string; sections?: string[]; periodDesc?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({
      feature: 'performance_analysis',
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
      if (r.target_software?.toLowerCase().includes(q)) return true;
      if (r.source_filenames?.some(f => f.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [rows, search]);

  const fetchOutput = useCallback(async (id: string) => {
    const res = await fetch(`/api/outputs/${id}`);
    if (!res.ok) throw new Error('Failed to fetch report');
    const { output } = await res.json();
    return output as { result_data: Record<string, unknown>; client: HistoryClient | null; client_name: string | null; created_at: string };
  }, []);

  // Lazy-fetch period description + sections for the row's expanded panel
  const toggleExpand = async (id: string) => {
    const isOpen = expandedIds.has(id);
    setExpandedIds(prev => {
      const next = new Set(prev);
      isOpen ? next.delete(id) : next.add(id);
      return next;
    });
    if (isOpen) return;
    if (rowDetail[id]?.sections) return;
    setRowDetail(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const output = await fetchOutput(id);
      const rd = output.result_data as { selectedSections?: string[]; paAnalysisPeriodDescription?: string };
      setRowDetail(prev => ({
        ...prev,
        [id]: {
          loading: false,
          sections: rd.selectedSections ?? [],
          periodDesc: rd.paAnalysisPeriodDescription ?? '',
        },
      }));
    } catch (e) {
      setRowDetail(prev => ({ ...prev, [id]: { loading: false, error: e instanceof Error ? e.message : 'Failed to load' } }));
    }
  };

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

  // ── Re-build the original PDF from saved HTML ──────────────────────────
  const buildAndDownloadPdf = async (output: { result_data: Record<string, unknown>; client: HistoryClient | null; client_name: string | null; created_at: string }) => {
    const rd = output.result_data as {
      paBusinessName?: string;
      reportHtml?: string;
      editorHtml?: string;
      titlePageHtml?: string;
      themeColor?: string;
    };
    const businessName = rd.paBusinessName ?? output.client?.name ?? output.client_name ?? 'Report';
    const themeColor = rd.themeColor || '#059669';
    const editorHtml = rd.editorHtml || rd.reportHtml || '<p>No report content saved.</p>';
    const titlePageHtml = rd.titlePageHtml || '';

    const fullReportHtml = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      `  <title>Performance Analysis — ${businessName}</title>`,
      '  <style>',
      '    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 48px; font-size: 13px; line-height: 1.75; max-width: 794px; }',
      `    h1 { font-size: 22px; font-weight: 700; color: ${themeColor}; margin: 28px 0 14px; padding-bottom: 8px; border-bottom: 2px solid ${themeColor}; }`,
      `    h2 { font-size: 17px; font-weight: 700; color: ${themeColor}; margin: 24px 0 10px; padding-bottom: 5px; border-bottom: 1.5px solid #e5e7eb; }`,
      `    h3 { font-size: 14px; font-weight: 600; color: ${themeColor}; margin: 18px 0 8px; }`,
      '    p  { margin: 0 0 10px; min-height: 1.5em; }',
      '    p:empty::before { content: "\\00a0"; }',
      `    strong { color: ${themeColor}; font-weight: 600; }`,
      '    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 11px; table-layout: fixed; page-break-inside: avoid; break-inside: avoid; }',
      `    th { background: ${themeColor}; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; border: 1px solid ${themeColor}; word-break: break-word; }`,
      '    td { padding: 5px 8px; border: 1px solid #e5e7eb; word-break: break-word; }',
      '    tr:nth-child(even) td { background: #f9fafb; }',
      '    ul, ol { padding-left: 22px; margin: 8px 0; }',
      '    li { margin-bottom: 4px; }',
      '    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }',
      '    h2, h3 { page-break-before: avoid; break-before: avoid; }',
      '    div[data-page-break] { display: block; height: 0; border: none; background: transparent; margin: 0; padding: 0; box-shadow: none; }',
      '    .tableWrapper { overflow-x: auto; }',
      '  </style>',
      '</head>',
      '<body>',
      titlePageHtml,
      editorHtml.replace(/<p><\/p>/g, '<p><br></p>'),
      '</body>',
      '</html>',
    ].join('\n');

    const blob = await generatePdfBlob(fullReportHtml);
    const dateStr = new Date(output.created_at).toISOString().slice(0, 10);
    downloadBlob(blob, `Performance_Analysis_${businessName.replace(/\s+/g, '_')}_${dateStr}.pdf`);
  };

  const handleDownload = async (id: string) => {
    setBusyId(id);
    try {
      const output = await fetchOutput(id);
      await buildAndDownloadPdf(output);
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
      const rd = output.result_data as Record<string, unknown>;
      onOpen({
        id,
        client: output.client,
        paBusinessName: String(rd.paBusinessName ?? ''),
        paBusinessType: String(rd.paBusinessType ?? ''),
        paBusinessTrade: String(rd.paBusinessTrade ?? ''),
        paTradingLocation: String(rd.paTradingLocation ?? ''),
        paRelevantInfo: String(rd.paRelevantInfo ?? ''),
        paAnalysisPeriod: String(rd.paAnalysisPeriod ?? ''),
        paAnalysisPeriodDescription: String(rd.paAnalysisPeriodDescription ?? ''),
        selectedSections: (rd.selectedSections as string[]) ?? [],
        reportHtml: String(rd.reportHtml ?? ''),
        editorHtml: String(rd.editorHtml ?? rd.reportHtml ?? ''),
        titlePageHtml: String(rd.titlePageHtml ?? ''),
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
        try {
          const output = await fetchOutput(id);
          await buildAndDownloadPdf(output);
          await new Promise(r => setTimeout(r, 400));
        } catch {/* skip */}
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

  return (
    <ToolLayout title="Performance Analysis" icon={TrendingUp} iconColor="#059669" wide>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, user, period type, or filename…"
            className="input-base w-full pl-9 pr-9"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
              <X size={13} />
            </button>
          )}
        </div>

        <Tooltip label={mineOnly ? 'Showing only your reports' : 'Show only my reports'}>
          <button
            onClick={() => setMineOnly(v => !v)}
            aria-label="Toggle mine only"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-medium transition-colors ${
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
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-medium transition-colors ${
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
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border bg-white border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] text-xs font-medium transition-colors"
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
          New Report
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
              <Tooltip label="Download selected as PDFs">
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

      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-[var(--border)]">
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
                {colVisible('date')          && <SortHeader label="Date" k="created_at" />}
                {colVisible('user')          && <StaticHeader label="User" />}
                {colVisible('client')        && <SortHeader label="Client" k="client_name" />}
                {colVisible('period_type')   && <StaticHeader label="Period" />}
                {colVisible('period_desc')   && <StaticHeader label="Period covered" />}
                {colVisible('section_count') && <SortHeader label="# Sections" k="transaction_count" right />}
                {colVisible('file_count')    && <StaticHeader label="# Files" right />}
                {colVisible('files')         && <StaticHeader label="Source files" />}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={totalColSpan} className="text-center py-12 text-[var(--text-muted)]">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  Loading reports…
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
                  <TrendingUp size={28} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    {hasActiveFilters || search ? 'No reports match your filters.' : 'No performance reports yet. Generate your first one to get started.'}
                  </p>
                  <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
                    <Plus size={14} /> New Report
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
                const periodType = row.target_software ?? '';

                return (
                  <>
                    <tr key={row.id} className={`border-b border-gray-100 last:border-0 transition-colors ${isSelected ? 'bg-[var(--accent-light)]/40' : 'hover:bg-indigo-50/30'}`}>
                      <td className="px-2 py-3 w-7">
                        <button
                          onClick={() => void toggleExpand(row.id)}
                          aria-label={isExpanded ? 'Collapse' : 'Expand to see report sections'}
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
                      {colVisible('period_type') && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {periodType ? (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700">
                              {PERIOD_LABELS[periodType] ?? periodType}
                            </span>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      )}
                      {colVisible('period_desc') && (
                        <td className="px-4 py-3 max-w-[260px]">
                          {detail?.periodDesc !== undefined ? (
                            <span className="text-xs text-[var(--text-muted)] truncate block" title={detail.periodDesc || '—'}>
                              {detail.periodDesc || '—'}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300 italic">expand to load</span>
                          )}
                        </td>
                      )}
                      {colVisible('section_count') && (
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
                            <Tooltip label="Open in tool to edit">
                              <button onClick={() => void handleOpen(row.id)} disabled={isBusy} aria-label="Open in tool" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors">
                                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
                              </button>
                            </Tooltip>
                            <Tooltip label="Download PDF">
                              <button onClick={() => void handleDownload(row.id)} disabled={isBusy} aria-label="Download PDF" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors">
                                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                              </button>
                            </Tooltip>
                            {canDelete && (
                              <Tooltip label="Delete">
                                <button onClick={() => setConfirmDeleteId(row.id)} aria-label="Delete report" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* ── Expanded sections panel ── */}
                    {isExpanded && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={totalColSpan} className="px-0 py-0 bg-gray-50/70">
                          <div className="mx-4 mb-3 mt-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            {detail?.loading && (
                              <div className="p-6 text-center text-sm text-[var(--text-muted)]">
                                <Loader2 size={18} className="animate-spin mx-auto mb-2" />
                                Loading sections…
                              </div>
                            )}
                            {detail?.error && (
                              <div className="p-6 text-center text-sm text-red-600">
                                <AlertTriangle size={14} className="inline mr-1.5" />{detail.error}
                              </div>
                            )}
                            {detail?.sections && (
                              <ExpandedSections sections={detail.sections} periodDesc={detail.periodDesc ?? ''} />
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

// ── Expanded panel: section list + period description ─────────────────────
function ExpandedSections({ sections, periodDesc }: { sections: string[]; periodDesc: string }) {
  return (
    <div className="divide-y divide-gray-100">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Report sections used</span>
        <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">
          {sections.length} section{sections.length !== 1 ? 's' : ''}
        </span>
        {periodDesc && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-600">Period: <span className="font-medium text-gray-800">{periodDesc}</span></span>
          </>
        )}
      </div>

      <div className="px-4 py-3">
        {sections.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No sections recorded for this report.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sections.map(id => (
              <div key={id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50/50 border border-emerald-200/60">
                <Check size={13} className="text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-gray-800">{SECTION_LABELS[id] ?? id}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
