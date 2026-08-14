'use client';
import { fetchJson } from '@/lib/fetchJson';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePersistedColumns } from '@/lib/usePersistedColumns';
import {
  ClipboardList, Plus, Search, Download, FolderOpen, Trash2, Loader2,
  ChevronUp, ChevronDown, ChevronsUpDown, SlidersHorizontal, User as UserIcon,
  X, AlertTriangle, Filter, CheckSquare, ChevronRight, MapPin, Users, Clock,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import { useModules } from '@/components/ui/ModulesProvider';
import { useRouter } from 'next/navigation';
import QuickTaskModal from '@/components/features/tasks/QuickTaskModal';
import HistoryActions from '@/components/ui/HistoryActions';
import { downloadCsv, csvFilename } from '@/utils/exportToCsv';
import { logAuditClient } from '@/utils/auditClient';
import type { CreateTaskData } from '@/components/features/tasks/CreateTaskModal';
import type { MeetingNotesSeed } from './MeetingNotesClient';

const ORIGIN_LABELS: Record<string, string> = {
  recorded:  'Recorded',
  virtual:   'Virtual',
  in_person: 'In person',
  phone:     'Phone',
};

const ORIGIN_BADGE: Record<string, string> = {
  recorded:  'bg-rose-100 text-rose-700',
  virtual:   'bg-sky-100 text-sky-700',
  in_person: 'bg-emerald-100 text-emerald-700',
  phone:     'bg-purple-100 text-purple-700',
};

// ── Types ──────────────────────────────────────────────────────────────────
export interface HistoryUser { id: string; full_name: string | null; email: string }
export interface HistoryClient { id: string; name: string; client_ref: string | null; vat_number?: string | null; business_type?: string | null }

export interface MeetingNotesHistoryRow {
  id: string;
  feature: string;
  target_software: string | null; // meeting origin
  client_id: string | null;
  client_name: string | null;
  user_id: string | null;
  transaction_count: number | null; // # action items
  source_filenames: string[] | null;
  created_at: string;
  period_from: string | null; // meeting date
  period_to: string | null;
  user: HistoryUser | null;
  client: HistoryClient | null;
  /** Surfaced by /api/outputs — the first open task spawned from this
   *  output row, if any. Drives the in-row "task already exists" marker
   *  and the Create-Task action button's enabled state. */
  linked_task: { id: string; title: string; status: string } | null;
}

interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onNew: () => void;
  onOpen: (seed: MeetingNotesSeed) => void;
}

type SortKey = 'created_at' | 'client_name' | 'transaction_count';

interface ColumnConfig {
  key: 'date' | 'user' | 'client' | 'meeting_title' | 'meeting_type' | 'meeting_datetime' | 'location' | 'action_count';
  label: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'date',             label: 'Saved',         defaultVisible: true },
  { key: 'user',             label: 'User',          defaultVisible: true },
  { key: 'client',           label: 'Client',        defaultVisible: true },
  { key: 'meeting_title',    label: 'Meeting',       defaultVisible: true },
  { key: 'meeting_type',     label: 'Type',          defaultVisible: true },
  { key: 'meeting_datetime', label: 'Date & time',   defaultVisible: true },
  { key: 'location',         label: 'Location',      defaultVisible: true },
  { key: 'action_count',     label: '# Actions',     defaultVisible: false },
];

const COLUMN_PREF_KEY = 'smith.meeting-notes.history.columns';

function formatSavedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMeetingDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return iso; }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MeetingNotesHistory({ currentUserId, isAdmin, onNew, onOpen }: Props) {
  // Tasks-tool gating + navigation for the new Create-Task and "task
  // already exists" row actions. The Create-Task action only renders
  // when the firm has the Tasks tool active — otherwise the icon hides.
  const { isModuleActive } = useModules();
  const tasksModuleActive = isModuleActive('tasks');
  const router = useRouter();
  // When set, the QuickTask modal is mounted for the row whose Create-Task
  // action was clicked. Carries the resolved pre-populated defaults (title,
  // steps from action items, earliest deadline) so the modal opens with
  // exactly the same shape as the in-tool Create-Task flow inside the
  // meeting review screen.
  interface TaskSeed {
    outputId:    string;
    clientId:    string | null;
    clientName:  string | null;
    title:       string;
    steps:       string[];
    dueDate:     string;
  }
  const [taskSeed, setTaskSeed] = useState<null | TaskSeed>(null);
  const [taskLoading, setTaskLoading] = useState<string | null>(null);
  // Lightweight cache of team members for the modal's assignee picker.
  // Lazily fetched the first time the user opens the modal.
  interface TeamMember { id: string; full_name: string | null; email: string }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  async function ensureTeamMembers() {
    if (teamMembers.length > 0) return;
    try {
      const res = await fetch('/api/users/team');
      if (!res.ok) return;
      const j = await res.json() as { users?: TeamMember[] };
      setTeamMembers(j.users ?? []);
    } catch { /* non-fatal — modal still works without the list */ }
  }

  const [rows, setRows]         = useState<MeetingNotesHistoryRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [search, setSearch]     = useState('');
  const [originFilter, setOriginFilter] = useState<string>('');
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

  // Lazy-fetched detail (attendees + meeting metadata) for the expanded panel
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [rowDetail, setRowDetail] = useState<Record<string, { loading: boolean; error?: string; meetingTitle?: string; meetingTime?: string; location?: string; attendees?: string[]; summary?: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({
      feature: 'meeting_notes',
      sort: sortKey,
      dir: sortDir,
    });
    if (search.trim())   params.set('search', search.trim());
    if (mineOnly)        params.set('mine_only', '1');
    if (originFilter)    params.set('software', originFilter);
    if (dateFrom)        params.set('date_from', dateFrom);
    if (dateTo)          params.set('date_to', dateTo);

    try {
      const data = await fetchJson<{ outputs?: unknown[] }>(`/api/outputs?${params.toString()}`);
      setRows((data.outputs ?? []) as typeof rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, mineOnly, originFilter, dateFrom, dateTo, sortKey, sortDir]);

  useEffect(() => { void load(); }, [load]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (r.client_name?.toLowerCase().includes(q)) return true;
      if (r.client?.name?.toLowerCase().includes(q)) return true;
      if (r.user?.full_name?.toLowerCase().includes(q)) return true;
      if (r.user?.email?.toLowerCase().includes(q)) return true;
      if (r.target_software?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [rows, search]);

  const fetchOutput = useCallback(async (id: string) => {
    const res = await fetch(`/api/outputs/${id}`);
    if (!res.ok) throw new Error('Failed to fetch meeting notes');
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
    if (rowDetail[id]?.attendees) return;
    setRowDetail(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const output = await fetchOutput(id);
      const rd = output.result_data as { attendees?: string[]; meetingTitle?: string; meetingTime?: string; location?: string; summary?: string };
      setRowDetail(prev => ({
        ...prev,
        [id]: {
          loading: false,
          meetingTitle: rd.meetingTitle ?? '',
          meetingTime: rd.meetingTime ?? '',
          location: rd.location ?? '',
          attendees: rd.attendees ?? [],
          summary: rd.summary ?? '',
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

  // ── Re-download PDF (server regenerates from saved data) ────────────────
  const downloadPdf = async (output: { result_data: Record<string, unknown>; client: HistoryClient | null; client_name: string | null }) => {
    const rd = output.result_data as Record<string, unknown>;
    const payload = {
      title: String(rd.meetingTitle ?? 'Untitled Meeting'),
      meetingDate: String(rd.meetingDate ?? ''),
      meetingTime: String(rd.meetingTime ?? ''),
      durationSeconds: typeof rd.durationSeconds === 'number' ? rd.durationSeconds : undefined,
      location: rd.location ? String(rd.location) : undefined,
      attendees: (rd.attendees as string[]) ?? [],
      clientName: output.client?.name ?? output.client_name ?? undefined,
      summary: String(rd.summary ?? ''),
      keyPoints: (rd.keyPoints as string[]) ?? [],
      actionItems: (rd.actionItems as Array<{ action: string; owner: string; deadline: string }>) ?? [],
      decisions: (rd.decisions as string[]) ?? [],
      formalMinutes: String(rd.formalMinutes ?? ''),
      nextMeeting: String(rd.nextMeeting ?? ''),
    };
    const res = await fetch('/api/meeting-notes/download-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Failed to generate PDF');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = payload.title.replace(/[^a-zA-Z0-9 ._-]/g, '_');
    a.href = url; a.download = `Meeting Notes - ${safeName} - ${payload.meetingDate}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleDownload = async (id: string) => {
    setBusyId(id);
    try {
      const output = await fetchOutput(id);
      await downloadPdf(output);
      logAuditClient({ tool: 'meeting_notes', action: 'downloaded', entityId: id, summary: 'Downloaded the meeting notes' });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusyId(null);
    }
  };

  // Mirror of the in-tool MeetingNotesClient "Create Task" defaults so the
  // history-page action behaves identically: title from meetingTitle,
  // checklist steps from each action item, earliest parseable deadline as
  // the default due date.
  const handleCreateTaskFromRow = async (row: MeetingNotesHistoryRow) => {
    setTaskLoading(row.id);
    try {
      await ensureTeamMembers();
      const output = await fetchOutput(row.id);
      const rd = output.result_data as Record<string, unknown>;
      const actionItems = (rd.actionItems as Array<{ action?: string; owner?: string; deadline?: string }> | undefined) ?? [];
      const steps = actionItems.map(a => a.action ?? '').filter(Boolean);
      const dueDate = actionItems
        .map(a => a.deadline ?? '')
        .map(d => { try { const dt = new Date(d); return Number.isNaN(dt.getTime()) ? null : dt; } catch { return null; } })
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0]
        ?.toISOString().split('T')[0] ?? '';
      setTaskSeed({
        outputId:   row.id,
        clientId:   row.client_id,
        clientName: row.client?.name ?? row.client_name,
        title:      String(rd.meetingTitle ?? row.client?.name ?? 'Meeting Action Items'),
        steps,
        dueDate,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load meeting notes');
    } finally {
      setTaskLoading(null);
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
        meetingTitle: String(rd.meetingTitle ?? ''),
        meetingDate: String(rd.meetingDate ?? ''),
        meetingTime: String(rd.meetingTime ?? ''),
        durationSeconds: typeof rd.durationSeconds === 'number' ? rd.durationSeconds : null,
        location: String(rd.location ?? ''),
        meetingOrigin: String(rd.meetingOrigin ?? 'recorded'),
        attendees: (rd.attendees as string[]) ?? [],
        transcript: String(rd.transcript ?? ''),
        summary: String(rd.summary ?? ''),
        keyPoints: (rd.keyPoints as string[]) ?? [],
        actionItems: (rd.actionItems as Array<{ action: string; owner: string; deadline: string }>) ?? [],
        decisions: (rd.decisions as string[]) ?? [],
        formalMinutes: String(rd.formalMinutes ?? ''),
        nextMeeting: String(rd.nextMeeting ?? ''),
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
          await downloadPdf(output);
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
  const totalColSpan = visibleColCount + 3;

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(r.id));
  const someVisibleSelected = !allVisibleSelected && filteredRows.some(r => selectedIds.has(r.id));
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => { const next = new Set(prev); filteredRows.forEach(r => next.delete(r.id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); filteredRows.forEach(r => next.add(r.id)); return next; });
    }
  };

  const hasActiveFilters = !!(mineOnly || originFilter || dateFrom || dateTo);

  // Export the same filtered rows the table renders below. Columns mirror the
  // visible table columns (meeting title/location live in result_data and are
  // only loaded on row-expand, so they're intentionally omitted here).
  const exportCsv = () => {
    const headers = ['Saved', 'User', 'Client', 'Client Ref', 'Type', 'Meeting date', '# Actions'];
    const csvRows = filteredRows.map(r => {
      const origin = r.target_software ?? '';
      return [
        formatSavedDate(r.created_at),
        r.user?.full_name ?? r.user?.email ?? '',
        r.client?.name ?? r.client_name ?? '',
        r.client?.client_ref ?? '',
        origin ? (ORIGIN_LABELS[origin] ?? origin) : '',
        formatMeetingDate(r.period_from),
        r.transaction_count ?? '',
      ];
    });
    downloadCsv(csvFilename('meeting_notes'), headers, csvRows);
  };

  return (
    <ToolLayout title="Meeting Notes" icon={ClipboardList} iconColor="#6D28D9" wide>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, user, or meeting type…"
            className="input-base w-full pl-9 pr-9"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
              <X size={13} />
            </button>
          )}
        </div>

        <Tooltip label={mineOnly ? 'Showing only your notes' : 'Show only my notes'}>
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
          <HistoryActions onExport={exportCsv} exportDisabled={filteredRows.length === 0} audit={{ tool: 'meeting_notes', isAdmin }} />
          <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
            <Plus size={14} />
            New Meeting
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-4 p-4 bg-[var(--bg-nav-hover)] border border-[var(--border)] rounded-xl flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Type</label>
            <select
              value={originFilter}
              onChange={e => setOriginFilter(e.target.value)}
              className="input-base text-sm h-9 min-w-[140px]"
            >
              <option value="">All types</option>
              {Object.entries(ORIGIN_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
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
              onClick={() => { setOriginFilter(''); setDateFrom(''); setDateTo(''); setMineOnly(false); }}
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
                {colVisible('date')             && <SortHeader label="Saved" k="created_at" />}
                {colVisible('user')             && <StaticHeader label="User" />}
                {colVisible('client')           && <SortHeader label="Client" k="client_name" />}
                {colVisible('meeting_title')    && <StaticHeader label="Meeting" />}
                {colVisible('meeting_type')     && <StaticHeader label="Type" />}
                {colVisible('meeting_datetime') && <StaticHeader label="Date & time" />}
                {colVisible('location')         && <StaticHeader label="Location" />}
                {colVisible('action_count')     && <SortHeader label="# Actions" k="transaction_count" right />}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={totalColSpan} className="text-center py-12 text-[var(--text-muted)]">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  Loading meetings…
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
                  <ClipboardList size={28} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    {hasActiveFilters || search ? 'No meetings match your filters.' : 'No meeting notes saved yet.'}
                  </p>
                  <button onClick={onNew} className="btn-primary inline-flex items-center gap-2">
                    <Plus size={14} /> New Meeting
                  </button>
                </td></tr>
              )}

              {!loading && !error && filteredRows.map(row => {
                const isBusy = busyId === row.id;
                const confirming = confirmDeleteId === row.id;
                const canDelete = isAdmin || row.user_id === currentUserId;
                const userName = row.user?.full_name ?? row.user?.email ?? 'Unknown';
                const isSelected = selectedIds.has(row.id);
                const isExpanded = expandedIds.has(row.id);
                const detail = rowDetail[row.id];
                const origin = row.target_software ?? '';
                const meetingDate = row.period_from ?? null;

                return (
                  <>
                    <tr key={row.id} className={`border-b border-gray-100 last:border-0 transition-colors ${isSelected ? 'bg-[var(--accent-light)]/40' : 'hover:bg-indigo-50/30'}`}>
                      <td className="px-2 py-3 w-7">
                        <button
                          onClick={() => void toggleExpand(row.id)}
                          aria-label={isExpanded ? 'Collapse' : 'Expand to see attendees'}
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
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-[var(--text-secondary)]">{formatSavedDate(row.created_at)}</td>
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
                        <td className="px-4 py-3 max-w-[200px]">
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
                      {colVisible('meeting_title') && (
                        <td className="px-4 py-3 max-w-[220px]">
                          {detail?.meetingTitle !== undefined ? (
                            <span className="text-sm text-[var(--text-primary)] truncate block" title={detail.meetingTitle || '—'}>
                              {detail.meetingTitle || '—'}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300 italic">expand to load</span>
                          )}
                        </td>
                      )}
                      {colVisible('meeting_type') && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {origin ? (
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ORIGIN_BADGE[origin] ?? 'bg-gray-100 text-gray-700'}`}>
                              {ORIGIN_LABELS[origin] ?? origin}
                            </span>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      )}
                      {colVisible('meeting_datetime') && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-xs text-[var(--text-muted)] tabular-nums">
                            {formatMeetingDate(meetingDate)}
                            {detail?.meetingTime && (
                              <span className="ml-1.5 inline-flex items-center gap-1 text-gray-400">
                                <Clock size={10} />{detail.meetingTime}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {colVisible('location') && (
                        <td className="px-4 py-3 max-w-[180px]">
                          {/* Location lives in result_data — only available after expand */}
                          {/* For collapsed rows we leave a hint to expand. */}
                          <ExpandHintLocation rowId={row.id} expandedIds={expandedIds} rowDetail={rowDetail} />
                        </td>
                      )}
                      {colVisible('action_count') && (
                        <td className="px-4 py-3 text-right tabular-nums text-sm text-[var(--text-secondary)]">{row.transaction_count ?? '—'}</td>
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
                            {/* Tasks-tool integrations — hidden entirely when
                                the firm doesn't have Tasks active. When a
                                task already exists for this row we swap the
                                Create action for a "task already in play"
                                marker that opens the Tasks tool. */}
                            {tasksModuleActive && (
                              row.linked_task ? (
                                <Tooltip label={`Open linked task: ${row.linked_task.title}`}>
                                  <button
                                    onClick={() => router.push(`/tasks?taskId=${encodeURIComponent(row.linked_task!.id)}`)}
                                    aria-label="Open linked task"
                                    className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--accent)] bg-[var(--accent-light)] hover:opacity-80 transition-colors"
                                  >
                                    <CheckSquare size={13} />
                                  </button>
                                </Tooltip>
                              ) : (
                                <Tooltip label="Create task from this meeting">
                                  <button
                                    onClick={() => void handleCreateTaskFromRow(row)}
                                    disabled={taskLoading === row.id}
                                    aria-label="Create task"
                                    className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-50 transition-colors"
                                  >
                                    {taskLoading === row.id
                                      ? <Loader2 size={13} className="animate-spin" />
                                      : <CheckSquare size={13} />}
                                  </button>
                                </Tooltip>
                              )
                            )}
                            <Tooltip label="Download PDF">
                              <button onClick={() => void handleDownload(row.id)} disabled={isBusy} aria-label="Download PDF" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors">
                                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                              </button>
                            </Tooltip>
                            {canDelete && (
                              <Tooltip label="Delete">
                                <button onClick={() => setConfirmDeleteId(row.id)} aria-label="Delete meeting notes" className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* ── Expanded panel: attendees + summary preview ── */}
                    {isExpanded && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={totalColSpan} className="px-0 py-0 bg-gray-50/70">
                          <div className="mx-4 mb-3 mt-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            {detail?.loading && (
                              <div className="p-6 text-center text-sm text-[var(--text-muted)]">
                                <Loader2 size={18} className="animate-spin mx-auto mb-2" />
                                Loading attendees…
                              </div>
                            )}
                            {detail?.error && (
                              <div className="p-6 text-center text-sm text-red-600">
                                <AlertTriangle size={14} className="inline mr-1.5" />{detail.error}
                              </div>
                            )}
                            {detail && !detail.loading && !detail.error && (
                              <ExpandedAttendees
                                title={detail.meetingTitle ?? ''}
                                attendees={detail.attendees ?? []}
                                summary={detail.summary ?? ''}
                              />
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

      {/* QuickTask modal — opened from a row's "Create task" action. Pre-
          populated the same way as the in-tool Create-Task button on the
          meeting review screen: title from meetingTitle, steps from
          actionItems, due date from the earliest parseable deadline. The
          source_output_id stamp flips the row's marker to "linked" the
          moment the task is saved. */}
      {taskSeed && (
        <QuickTaskModal
          onClose={() => setTaskSeed(null)}
          teamMembers={teamMembers}
          defaultClientId={taskSeed.clientId ?? undefined}
          defaultClientName={taskSeed.clientName ?? undefined}
          defaultTitle={taskSeed.title}
          defaultSteps={taskSeed.steps}
          defaultDueDate={taskSeed.dueDate}
          sourceOutputId={taskSeed.outputId}
          onCreate={async (data: CreateTaskData) => {
            const res = await fetch('/api/tasks', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to create task');
            const j = await res.json() as { task?: { id: string } };
            // Optimistic update — flip the row's marker right away so the
            // user gets feedback without waiting for a refetch.
            if (j.task) {
              setRows(prev => prev.map(r => r.id === taskSeed.outputId
                ? { ...r, linked_task: { id: j.task!.id, title: data.title, status: 'not_started' } }
                : r,
              ));
            }
          }}
        />
      )}
    </ToolLayout>
  );
}

// Small helper used by the Location column so it shows a hint until detail is loaded.
function ExpandHintLocation({
  rowId,
  expandedIds,
  rowDetail,
}: {
  rowId: string;
  expandedIds: Set<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rowDetail: Record<string, any>;
}) {
  const detail = rowDetail[rowId];
  const isExpanded = expandedIds.has(rowId);
  // We don't keep `location` in the cached detail right now; show "expand to view" hint.
  // (The location is shown inside the expanded panel itself.)
  if (!detail) {
    return <span className="text-xs text-gray-300 italic">{isExpanded ? '—' : 'expand to view'}</span>;
  }
  return <span className="text-xs text-[var(--text-muted)] truncate block">{detail.location || '—'}</span>;
}

// ── Expanded panel content ───────────────────────────────────────────────────
function ExpandedAttendees({ title, attendees, summary }: { title: string; attendees: string[]; summary: string }) {
  return (
    <div className="divide-y divide-gray-100">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex-wrap">
        <Users size={14} className="text-gray-500" />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendees</span>
        <span className="text-[10px] font-bold uppercase tracking-wide bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">
          {attendees.length} attendee{attendees.length !== 1 ? 's' : ''}
        </span>
        {title && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-700">{title}</span>
          </>
        )}
      </div>

      <div className="px-4 py-3">
        {attendees.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No attendees recorded for this meeting.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {attendees.map((a, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-50/60 border border-purple-200/60">
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${avatarColour(`attendee-${i}`)}`}>
                  {(a.split(/\s+/).map(s => s[0]).join('').slice(0, 2) || '?').toUpperCase()}
                </div>
                <span className="text-xs text-gray-800 truncate">{a}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {summary && (
        <div className="px-4 py-3 bg-gray-50/40">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center gap-1">
            <MapPin size={11} className="opacity-0" /> Summary
          </p>
          <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">{summary}</p>
        </div>
      )}
    </div>
  );
}
