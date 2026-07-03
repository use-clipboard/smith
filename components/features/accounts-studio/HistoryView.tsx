'use client';

import { useState, useMemo } from 'react';
import {
  Landmark, Plus, Search, X, FolderOpen, Download, Trash2, Loader2, Sparkles,
  User as UserIcon, Filter, SlidersHorizontal,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { usePersistedColumns } from '@/lib/usePersistedColumns';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import { generatePdfBlob, downloadBlob } from '@/utils/pdfFromHtml';
import { EngagementStatusBadge } from './primitives';
import { ENTITY_LABELS, engagementStatus, stageProgress, demoHistory, type AccountsHistoryItem } from './data';
import type { Engagement } from './types';

interface ColumnConfig {
  key: 'date' | 'user' | 'client' | 'year_end' | 'framework' | 'status' | 'progress';
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

/** 'dd-mm-yyyy HH:mm' → 'yyyy-mm-dd' (lexically comparable to a date input). */
function toIsoDate(dmy: string): string {
  const [d, m, y] = dmy.split(' ')[0].split('-');
  return `${y}-${m}-${d}`;
}

export default function HistoryView({
  onNew, onOpen,
}: {
  onNew: () => void;
  onOpen: (e: Engagement) => void;
}) {
  const [items, setItems] = useState<AccountsHistoryItem[]>(() => demoHistory());
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showColMenu, setShowColMenu] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const hasActiveFilters = !!(mineOnly || dateFrom || dateTo);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (mineOnly && !i.mine) return false;
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
  }, [items, search, mineOnly, dateFrom, dateTo]);

  async function downloadPack(e: Engagement) {
    setBusyId(e.id);
    try {
      const blob = await generatePdfBlob(buildAccountsHtml(e));
      downloadBlob(blob, `Statutory_Accounts_${e.companyName.replace(/\s+/g, '_')}_${e.periodEnd}.pdf`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusyId(null);
    }
  }

  function remove(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    setConfirmDeleteId(null);
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
      {/* Toolbar — search · Mine · Filter · Columns · New (mirrors Performance) */}
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

        <button onClick={onNew} className="btn-primary ml-auto sm:ml-0">
          <Plus size={15} /> New Accounts
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-nav-hover)] p-4">
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
              onClick={() => { setDateFrom(''); setDateTo(''); setMineOnly(false); }}
              className="ml-auto text-xs text-[var(--text-muted)] underline hover:text-[var(--text-primary)]"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-white/85 backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-[var(--border)] bg-gray-50/80">
              <tr>
                {colVisible('date')      && <Th>Last edited</Th>}
                {colVisible('user')      && <Th>Prepared by</Th>}
                {colVisible('client')    && <Th>Client</Th>}
                {colVisible('year_end')  && <Th>Year end</Th>}
                {colVisible('framework') && <Th>Framework</Th>}
                {colVisible('status')    && <Th>Status</Th>}
                {colVisible('progress')  && <Th>Progress</Th>}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="py-14 text-center">
                    <Landmark size={28} className="mx-auto mb-3 text-gray-300" />
                    <p className="mb-4 text-sm text-[var(--text-muted)]">
                      {hasActiveFilters || search ? 'No accounts match your filters.' : 'No accounts prepared yet. Start your first set to get going.'}
                    </p>
                    <button onClick={onNew} className="btn-primary mx-auto">
                      <Plus size={15} /> New Accounts
                    </button>
                  </td>
                </tr>
              )}

              {filtered.map(({ id, engagement: e, date }) => {
                const status = engagementStatus(e);
                const progress = stageProgress(e);
                const canDownload = status.tone === 'filed' || status.tone === 'ready';
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
                            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColour(id)}`}>
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
                            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(progress / 6) * 100}%` }} />
                          </div>
                          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{progress}/6</span>
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
    </ToolLayout>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{children}</th>;
}

/** Minimal statutory-accounts HTML for the demo pack download. */
function buildAccountsHtml(e: Engagement): string {
  const sections = e.disclosures
    .filter(s => s.content)
    .map(s => `<div style="margin-bottom:18px">${s.content}</div>`)
    .join('');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:8px 16px">
      <div style="text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:24px">
        <h1 style="font-size:22px;margin:0 0 6px">${e.companyName}</h1>
        <p style="margin:0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.05em">Company no. ${e.companyNumber}</p>
        <p style="margin:6px 0 0;color:#475569;font-size:13px">Financial statements for the year ended ${e.periodEnd}</p>
        <p style="margin:2px 0 0;color:#94a3b8;font-size:11px">${e.framework}</p>
      </div>
      ${sections || '<p style="color:#94a3b8">No disclosures drafted.</p>'}
      <div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:12px;color:#94a3b8;font-size:10px">
        Prepared by ${e.preparedBy} · Generated by SMITH Accounts Studio
      </div>
    </div>`;
}
