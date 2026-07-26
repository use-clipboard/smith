'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Landmark, Plus, Search, X, FolderOpen, Download, Trash2, Loader2, Sparkles,
  User as UserIcon, Filter, SlidersHorizontal, AlertCircle, Copy,
  FileDown, ScrollText, CheckCircle2, ArrowUp, ArrowDown, ArrowUpDown, ShieldCheck,
  FilePlus2, Pencil, RotateCcw, Send, ChevronRight,
} from 'lucide-react';
import { ACTION_META, type AuditEntry, type AuditAction, type AuditTone } from '@/lib/accounts-studio/auditTypes';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { usePersistedColumns } from '@/lib/usePersistedColumns';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import { generatePdfBlob, downloadBlob } from '@/utils/pdfFromHtml';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { getFirmBranding } from './branding';
import { EngagementStatusBadge } from './primitives';
import {
  ENTITY_LABELS, engagementStatus, stageProgress, STAGES,
  type AccountsHistoryItem, type EngagementStatusTone,
} from './data';
import { listEngagements, deleteEngagement, copyEngagement, logAuditClientEvent } from './persistence';
import type { Engagement } from './types';

type ColKey = 'date' | 'user' | 'client' | 'year_end' | 'framework' | 'status' | 'progress';
type SortDir = 'asc' | 'desc';

interface ColumnConfig {
  key: ColKey;
  label: string;
  defaultVisible: boolean;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'date',      label: 'Last edited', defaultVisible: true },
  { key: 'user',      label: 'Prepared by', defaultVisible: true },
  { key: 'client',    label: 'Client',      defaultVisible: true },
  { key: 'year_end',  label: 'Year end',    defaultVisible: true },
  { key: 'framework', label: 'Framework',   defaultVisible: true },
  { key: 'status',    label: 'Status',      defaultVisible: true },
  { key: 'progress',  label: 'Progress',    defaultVisible: true },
];

const COLUMN_PREF_KEY = 'smith.accounts-studio.history.columns';

// Selectable statuses for the filter, in workflow order.
const STATUS_OPTIONS: { tone: EngagementStatusTone; label: string }[] = [
  { tone: 'draft',    label: 'Draft' },
  { tone: 'progress', label: 'In progress' },
  { tone: 'ready',    label: 'Ready to send' },
  { tone: 'awaiting', label: 'Awaiting approval' },
  { tone: 'changes',  label: 'Changes requested' },
  { tone: 'approved', label: 'Approved' },
  { tone: 'filed',    label: 'Filed' },
];

// Rank used to sort the Status column in a sensible workflow order.
const STATUS_RANK: Record<EngagementStatusTone, number> = {
  draft: 0, progress: 1, ready: 2, awaiting: 3, changes: 4, approved: 5, filed: 6,
};

// "Ready to file" (green button) = client-approved but not yet filed at
// Companies House — the accounts you can file right now.
function isReadyToFile(e: Engagement): boolean {
  return engagementStatus(e).tone === 'approved';
}

/** 'dd-mm-yyyy HH:mm' → 'yyyy-mm-dd' (lexically comparable to a date input). */
function toIsoDate(dmy: string): string {
  const [d, m, y] = dmy.split(' ')[0].split('-');
  return `${y}-${m}-${d}`;
}

/** 'dd-mm-yyyy HH:mm' → 'yyyy-mm-ddTHH:mm' (lexically sortable incl. time). */
function toIsoDateTime(dmy: string): string {
  const [datePart, timePart = '00:00'] = dmy.split(' ');
  const [d, m, y] = datePart.split('-');
  return `${y}-${m}-${d}T${timePart}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Stable comparator (empties always sort to the bottom regardless of direction).
function compareValues(a: string | number | null, b: string | number | null, dir: SortDir): number {
  const aEmpty = a === null || a === '' || a === undefined;
  const bEmpty = b === null || b === '' || b === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
  else cmp = String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
}

function sortValue(item: AccountsHistoryItem, key: ColKey): string | number | null {
  const e = item.engagement;
  switch (key) {
    case 'date':      return toIsoDateTime(item.date);
    case 'user':      return e.preparedBy.toLowerCase();
    case 'client':    return e.companyName.toLowerCase();
    case 'year_end':  return toIsoDate(e.periodEnd);
    case 'framework': return e.framework.toLowerCase();
    case 'status':    return STATUS_RANK[engagementStatus(e).tone];
    case 'progress':  return stageProgress(e);
  }
}

export default function HistoryView({
  onNew, onOpen,
}: {
  onNew: () => void;
  onOpen: (e: Engagement) => void;
}) {
  const [items, setItems] = useState<AccountsHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<EngagementStatusTone>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [showColMenu, setShowColMenu] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ColKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const [visibleCols, setVisibleCols] = usePersistedColumns(
    COLUMN_PREF_KEY,
    COLUMNS.map(c => c.key),
    COLUMNS.filter(c => c.defaultVisible).map(c => c.key),
  );
  const colVisible = (k: string) => visibleCols.has(k);
  const toggleCol = (k: string) =>
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  const hasActiveFilters = !!(mineOnly || dateFrom || dateTo || statusFilter.size > 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError('');
    listEngagements()
      .then(rows => { if (!cancelled) setItems(rows); })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load accounts.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Who am I — the audit-history button is admin-only.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(me => { if (!cancelled && me) setIsAdmin(me.userRole === 'admin'); })
      .catch(() => { /* non-admin by default */ });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (mineOnly && !i.mine) return false;
      if (readyOnly && !isReadyToFile(i.engagement)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(engagementStatus(i.engagement).tone)) return false;
      const iso = toIsoDate(i.date);
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
      if (!q) return true;
      return (
        i.engagement.companyName.toLowerCase().includes(q) ||
        (i.engagement.clientRef ?? '').toLowerCase().includes(q) ||
        i.engagement.preparedBy.toLowerCase().includes(q) ||
        ENTITY_LABELS[i.engagement.entityType].toLowerCase().includes(q)
      );
    });
  }, [items, search, mineOnly, readyOnly, statusFilter, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir));
    return arr;
  }, [filtered, sortKey, sortDir]);

  // Count of accounts prepared/approved but not yet filed (drives the green button).
  const readyCount = useMemo(() => items.filter(i => isReadyToFile(i.engagement)).length, [items]);

  function onSort(key: ColKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' || key === 'progress' ? 'desc' : 'asc');
    }
  }

  function toggleStatus(tone: EngagementStatusTone) {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(tone)) next.delete(tone); else next.add(tone);
      return next;
    });
  }

  function exportCsv() {
    const headers = ['Last edited', 'Prepared by', 'Client', 'Client ref', 'Entity type', 'Year end', 'Framework', 'Status', 'Progress'];
    const rows = sorted.map(({ engagement: e, date }) => [
      date,
      e.preparedBy,
      e.companyName,
      e.clientRef ?? '',
      ENTITY_LABELS[e.entityType],
      e.periodEnd,
      e.framework,
      engagementStatus(e).label,
      `${stageProgress(e)}/${STAGES.length}`,
    ]);
    const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounts_studio_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logAuditClientEvent({ action: 'exported', summary: `Exported the accounts list to CSV (${sorted.length} rows)` });
  }

  async function downloadPack(e: Engagement) {
    setBusyId(e.id);
    try {
      const branding = await getFirmBranding();
      const blob = await generatePdfBlob(
        buildAccountsPackHtml(e, {
          firmName: branding.firmName, firmLogoUrl: branding.logoUrl,
          accountantDetails: branding.accountantDetails, accountantsReport: branding.accountantsReport,
          comparatives: e.showComparatives ?? true, amended: e.amended ?? false,
        }),
        undefined,
        { hardPageBreaks: true, pageNumbers: true },
      );
      downloadBlob(blob, `Statutory_Accounts_${e.companyName.replace(/\s+/g, '_')}_${e.periodEnd}.pdf`);
      logAuditClientEvent({ action: 'downloaded', summary: 'Downloaded the statutory accounts pack (PDF)', engagementId: e.id, clientId: e.clientId ?? null, companyName: e.companyName });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusyId(null);
    }
  }

  async function copy(e: Engagement) {
    setBusyId(e.id);
    try {
      const fresh = await copyEngagement(e);
      onOpen(fresh); // open the new draft so the user can amend + resubmit
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not copy these accounts.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setConfirmDeleteId(null);
    const prev = items;
    setItems(list => list.filter(i => i.id !== id)); // optimistic
    try {
      await deleteEngagement(id);
    } catch {
      setItems(prev); // restore on failure
      alert('Could not delete this engagement. Please try again.');
    }
  }

  const colCount = COLUMNS.filter(c => colVisible(c.key)).length + 1; // + actions

  return (
    <ToolLayout
      title="Accounts Studio"
      description="Statutory accounts you've prepared — reopen a draft or download a filed pack."
      icon={Landmark}
      iconColor="#6366F1"
      wide
    >
      {/* Toolbar — search · Mine · Filter · Ready to file · Columns · export pill · New */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, framework or preparer…"
            className="input-base w-full pl-9 pr-9"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]">
              <X size={13} />
            </button>
          )}
        </div>

        <Tooltip label={mineOnly ? 'Showing only your accounts' : 'Show only my accounts'}>
          <button
            onClick={() => setMineOnly(v => !v)}
            aria-label="Toggle mine only"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
              mineOnly ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                       : 'border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <UserIcon size={13} /><span>Mine</span>
          </button>
        </Tooltip>

        <Tooltip label="Filters">
          <button
            onClick={() => setShowFilters(v => !v)}
            aria-label="Toggle filters"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
              showFilters || hasActiveFilters
                ? 'border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <Filter size={13} /><span>Filter{hasActiveFilters ? ' ·' : ''}</span>
            {hasActiveFilters && <span className="text-[10px] font-bold">on</span>}
          </button>
        </Tooltip>

        {/* Ready to file — accounts prepared/approved but not yet filed. Shown as a
            call-to-action only when there are any. */}
        {readyCount > 0 && (
          <Tooltip label={readyOnly ? 'Showing only client-approved accounts ready to file' : 'Show only client-approved accounts ready to file at Companies House'}>
            <button
              onClick={() => setReadyOnly(v => !v)}
              aria-pressed={readyOnly}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-sm transition-colors ${
                readyOnly
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 size={13} /> Ready to file
              <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${readyOnly ? 'bg-white/25 text-white' : 'bg-emerald-600 text-white'}`}>{readyCount}</span>
              {readyOnly && <X size={12} className="ml-0.5" />}
            </button>
          </Tooltip>
        )}

        <div className="relative">
          <Tooltip label="Show / hide columns">
            <button
              onClick={() => setShowColMenu(v => !v)}
              aria-label="Show or hide columns"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-nav-hover)]"
            >
              <SlidersHorizontal size={13} /><span>Columns</span>
            </button>
          </Tooltip>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowColMenu(false)} />
              <div className="absolute right-0 z-40 mt-2 w-52 rounded-xl border border-[var(--border)] bg-white p-2 shadow-xl">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Columns</p>
                {COLUMNS.map(c => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-nav-hover)]">
                    <input type="checkbox" checked={colVisible(c.key)} onChange={() => toggleCol(c.key)} className="rounded" />
                    <span className="text-sm text-[var(--text-primary)]">{c.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right group — export pill + New Accounts */}
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex h-9 items-center rounded-full border border-[var(--border)] bg-white px-1">
            <Tooltip label="Export this list to CSV / Sheets">
              <button
                onClick={exportCsv}
                disabled={sorted.length === 0}
                aria-label="Export list to CSV"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <FileDown size={15} />
              </button>
            </Tooltip>
            {isAdmin && (
              <>
                <div className="mx-0.5 h-5 w-px bg-[var(--border)]" />
                <Tooltip label="Audit history (admin)">
                  <button
                    onClick={() => setShowAudit(true)}
                    aria-label="Audit history"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]"
                  >
                    <ScrollText size={15} />
                  </button>
                </Tooltip>
              </>
            )}
          </div>

          <button onClick={onNew} className="btn-primary">
            <Plus size={15} /> New Accounts
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-nav-hover)] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base h-9 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base h-9 text-sm" />
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setMineOnly(false); setStatusFilter(new Set()); }}
                className="ml-auto text-xs text-[var(--text-muted)] underline hover:text-[var(--text-primary)]"
              >
                Clear filters
              </button>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map(s => {
                const active = statusFilter.has(s.tone);
                return (
                  <button
                    key={s.tone}
                    onClick={() => toggleStatus(s.tone)}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : 'border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-white/60'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-white/85 backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-[var(--border)] bg-gray-50/80">
              <tr>
                {colVisible('date')      && <SortTh colKey="date"      label="Last edited" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                {colVisible('user')      && <SortTh colKey="user"      label="Prepared by" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                {colVisible('client')    && <SortTh colKey="client"    label="Client"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                {colVisible('year_end')  && <SortTh colKey="year_end"  label="Year end"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                {colVisible('framework') && <SortTh colKey="framework" label="Framework"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                {colVisible('status')    && <SortTh colKey="status"    label="Status"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                {colVisible('progress')  && <SortTh colKey="progress"  label="Progress"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={colCount} className="py-14 text-center">
                    <Loader2 size={22} className="mx-auto mb-3 animate-spin text-[var(--accent)]" />
                    <p className="text-sm text-[var(--text-muted)]">Loading accounts…</p>
                  </td>
                </tr>
              )}

              {!loading && loadError && (
                <tr>
                  <td colSpan={colCount} className="py-14 text-center">
                    <AlertCircle size={26} className="mx-auto mb-3 text-red-400" />
                    <p className="text-sm text-red-600">{loadError}</p>
                  </td>
                </tr>
              )}

              {!loading && !loadError && sorted.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="py-14 text-center">
                    <Landmark size={28} className="mx-auto mb-3 text-gray-300" />
                    <p className="mb-4 text-sm text-[var(--text-muted)]">
                      {hasActiveFilters || readyOnly || search ? 'No accounts match your filters.' : 'No accounts prepared yet. Start your first set to get going.'}
                    </p>
                    <button onClick={onNew} className="btn-primary mx-auto">
                      <Plus size={15} /> New Accounts
                    </button>
                  </td>
                </tr>
              )}

              {sorted.map(({ id, engagement: e, date }) => {
                const status = engagementStatus(e);
                const progress = stageProgress(e);
                const canDownload = status.tone === 'filed' || status.tone === 'ready' || status.tone === 'approved';
                const isBusy = busyId === id;
                const confirming = confirmDeleteId === id;
                return (
                  <tr key={id} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-indigo-50/30">
                    {colVisible('date') && (
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--text-secondary)]">{date}</td>
                    )}
                    {colVisible('user') && (
                      <td className="px-4 py-3">
                        <Tooltip label={e.preparedBy}>
                          <div className="inline-flex items-center gap-2">
                            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColour(e.preparedBy)}`}>
                              {initials(e.preparedBy, e.preparedBy)}
                            </div>
                            <span className="max-w-[110px] truncate text-sm text-[var(--text-secondary)]">{e.preparedBy.split(' ')[0]}</span>
                          </div>
                        </Tooltip>
                      </td>
                    )}
                    {colVisible('client') && (
                      <td className="max-w-[220px] px-4 py-3">
                        <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{e.companyName}</span>
                        <span className="font-mono text-[10px] text-gray-400">{e.clientRef} · {ENTITY_LABELS[e.entityType]}</span>
                      </td>
                    )}
                    {colVisible('year_end') && (
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-[var(--text-secondary)]">{e.periodEnd}</td>
                    )}
                    {colVisible('framework') && (
                      <td className="max-w-[180px] px-4 py-3">
                        <span className="block truncate text-[12.5px] text-[var(--text-secondary)]">{e.framework}</span>
                      </td>
                    )}
                    {colVisible('status') && (
                      <td className="px-4 py-3"><EngagementStatusBadge tone={status.tone} label={status.label} /></td>
                    )}
                    {colVisible('progress') && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(progress / STAGES.length) * 100}%` }} />
                          </div>
                          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{progress}/{STAGES.length}</span>
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {confirming ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-xs font-medium text-red-600">Delete?</span>
                          <button onClick={() => remove(id)} className="rounded-full bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700">Yes</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]">No</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip label="Reopen in Accounts Studio">
                            <button onClick={() => onOpen(e)} aria-label="Reopen" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--accent)]">
                              <FolderOpen size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip label={canDownload ? 'Download accounts pack (PDF)' : 'Available once the accounts are ready to file'}>
                            <button onClick={() => canDownload && downloadPack(e)} disabled={!canDownload || isBusy} aria-label="Download pack"
                              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40">
                              {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            </button>
                          </Tooltip>
                          <Tooltip label="Copy to a new draft (for amended accounts)">
                            <button onClick={() => copy(e)} disabled={isBusy} aria-label="Copy" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--accent)] disabled:opacity-40">
                              {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                            </button>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <button onClick={() => setConfirmDeleteId(id)} aria-label="Delete" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-red-50 hover:text-red-600">
                              <Trash2 size={14} />
                            </button>
                          </Tooltip>
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

      <p className="mt-3 flex items-center gap-1.5 px-1 text-[11.5px] text-[var(--text-muted)]">
        <Sparkles size={12} className="text-[var(--accent)]" /> Reopen any draft to continue where you left off, or download the pack from a filed set.
      </p>

      {showAudit && <AuditHistoryModal onClose={() => setShowAudit(false)} />}
    </ToolLayout>
  );
}

// ── Sortable column header ────────────────────────────────────────────────────
function SortTh({ colKey, label, sortKey, sortDir, onSort }: {
  colKey: ColKey; label: string; sortKey: ColKey; sortDir: SortDir; onSort: (k: ColKey) => void;
}) {
  const active = sortKey === colKey;
  return (
    <th className="px-4 py-3 text-left">
      <button
        onClick={() => onSort(colKey)}
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors ${active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
      >
        {label}
        {active
          ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
          : <ArrowUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );
}

// ── Audit history (admin) — full activity timeline ───────────────────────────
const TONE_STYLE: Record<AuditTone, { icon: typeof FilePlus2; cls: string }> = {
  create:   { icon: FilePlus2,   cls: 'bg-indigo-50 text-indigo-600' },
  edit:     { icon: Pencil,      cls: 'bg-amber-50 text-amber-600' },
  delete:   { icon: Trash2,      cls: 'bg-red-50 text-red-600' },
  send:     { icon: Send,        cls: 'bg-sky-50 text-sky-600' },
  approve:  { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600' },
  reject:   { icon: RotateCcw,   cls: 'bg-amber-50 text-amber-600' },
  file:     { icon: Landmark,    cls: 'bg-indigo-50 text-indigo-600' },
  download: { icon: Download,    cls: 'bg-slate-100 text-slate-600' },
  neutral:  { icon: ScrollText,  cls: 'bg-slate-100 text-slate-600' },
};

function ukDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function AuditHistoryModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/accounts-studio/audit')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load the audit history.')))
      .then(d => { if (!cancelled) setEntries(d.entries ?? []); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the audit history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(e => {
      if (action !== 'all' && e.action !== action) return false;
      if (!needle) return true;
      return (
        (e.companyName ?? '').toLowerCase().includes(needle) ||
        e.actorName.toLowerCase().includes(needle) ||
        (e.summary ?? '').toLowerCase().includes(needle)
      );
    });
  }, [entries, q, action]);

  // Only offer action-filter options that actually occur in the log.
  const presentActions = useMemo(
    () => [...new Set(entries.map(e => e.action))] as AuditAction[],
    [entries],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ScrollText size={18} /></span>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Audit history</h3>
              <p className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]"><ShieldCheck size={11} /> Admin only · everything done in Accounts Studio</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]"><X size={16} /></button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, user or action…"
              className="input-base h-8 w-full pl-8 text-[12.5px]" />
          </div>
          <select value={action} onChange={e => setAction(e.target.value as AuditAction | 'all')}
            className="input-base h-8 text-[12.5px]">
            <option value="all">All actions</option>
            {presentActions.map(a => <option key={a} value={a}>{ACTION_META[a].label}</option>)}
          </select>
        </div>

        {/* Timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <div className="py-12 text-center"><Loader2 size={20} className="mx-auto mb-2 animate-spin text-[var(--accent)]" /><p className="text-[13px] text-[var(--text-muted)]">Loading history…</p></div>}
          {!loading && error && <div className="py-12 text-center"><AlertCircle size={22} className="mx-auto mb-2 text-red-400" /><p className="text-[13px] text-red-600">{error}</p></div>}
          {!loading && !error && shown.length === 0 && (
            <div className="py-12 text-center"><ScrollText size={24} className="mx-auto mb-2 text-gray-300" /><p className="text-[13px] text-[var(--text-muted)]">{entries.length === 0 ? 'No activity recorded yet.' : 'No entries match your filters.'}</p></div>
          )}
          {!loading && !error && shown.map(e => {
            const meta = ACTION_META[e.action];
            const tone = TONE_STYLE[meta.tone];
            const Icon = tone.icon;
            const hasChanges = !!(e.changes && e.changes.length);
            const isOpen = expanded.has(e.id);
            return (
              <div key={e.id} className="flex gap-3 rounded-xl px-2 py-2.5 hover:bg-[var(--bg-nav-hover)]">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.cls}`}><Icon size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">{meta.label}</span>
                    {e.companyName && <span className="truncate text-[12.5px] text-[var(--text-secondary)]">· {e.companyName}</span>}
                  </div>
                  {e.summary && <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{e.summary}</p>}
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{e.actorName} · {ukDateTime(e.createdAt)}</p>
                  {hasChanges && (
                    <>
                      <button
                        onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                      >
                        <ChevronRight size={12} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        {isOpen ? 'Hide' : 'Show'} {e.changes!.length} change{e.changes!.length === 1 ? '' : 's'}
                      </button>
                      {isOpen && (
                        <div className="mt-1.5 space-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-nav-hover)] p-2.5">
                          {e.changes!.map((c, i) => (
                            <div key={i} className="text-[11.5px]">
                              <span className="font-semibold text-[var(--text-primary)]">{c.label}:</span>{' '}
                              <span className="text-[var(--text-muted)] line-through">{c.from || '—'}</span>
                              {' → '}
                              <span className="text-[var(--text-secondary)]">{c.to || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
