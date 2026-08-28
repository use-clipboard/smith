'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ArrowUpDown, Download, Loader2,
  Plus, Search, ChevronRight, Building2, Mail, Hash, FileText,
  Archive, ArchiveRestore, Trash2, AlertTriangle, X,
} from 'lucide-react';
import { StudioCard, StatusBadge } from './primitives';
import Tooltip from '@/components/ui/Tooltip';
import { deriveStatus, STATUS_META, returnType, fmtMoney, fmtDateUK } from './data';
import { computeCt600 } from './calc';
import { listReturns, deleteReturn, saveReturn, type ReturnListItem } from './persistence';
import { fetchJson } from '@/lib/fetchJson';
import ClientEmailLink from '@/components/features/email/ClientEmailLink';
import type { TaxReturn, ReturnStatus } from './types';

export interface CompanyTaxClient {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  contact_email: string | null;
  status?: string | null;               // client lifecycle: active/hold/inactive
  utr_number?: string | null;
  registration_number?: string | null;   // Companies House number
  address?: string | null;
}

type SortKey = 'name' | 'client_ref' | 'registration' | 'utr' | 'status';
type SortDir = 'asc' | 'desc';
type ClientStatusFilter = 'all' | 'active' | 'hold' | 'inactive';
type SubmissionFilter = 'all' | ReturnStatus;

// Client lifecycle status → display label + pill tone. Unknown/blank = active.
function clientStatusLabel(s: string | null | undefined): string {
  return s === 'hold' ? 'On hold' : s === 'inactive' ? 'Inactive' : 'Active';
}
function clientStatusTone(s: string | null | undefined): string {
  return s === 'hold' ? 'text-amber-700 bg-amber-100' : s === 'inactive' ? 'text-slate-500 bg-slate-100' : 'text-emerald-700 bg-emerald-100';
}

const CLIENT_STATUS_OPTIONS: { value: ClientStatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'hold', label: 'On hold' },
  { value: 'inactive', label: 'Inactive' },
];
const SUBMISSION_OPTIONS: { value: SubmissionFilter; label: string }[] = [
  { value: 'all', label: 'All submissions' },
  ...(Object.keys(STATUS_META) as ReturnStatus[]).map(k => ({ value: k, label: STATUS_META[k].label })),
];

// ── CSV helpers ──────────────────────────────────────────────────────────────
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Empty values always sort to the bottom regardless of direction.
function compareValues(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp = String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
}

// A company's CT600 returns, plus the most recent one (for the Status column).
interface ClientRow {
  client: CompanyTaxClient;
  /** All CT600 returns for this company, newest accounting-period end first. */
  returns: ReturnListItem[];
  /** The most recent CT600 return, if any. */
  latestReturn: ReturnListItem | null;
  /** Status of the most recent return — null when the company has no return. */
  latestStatus: ReturnStatus | null;
}

// Companies file for an accounting period, so returns sort by period-end
// (ISO string) descending. Missing period-end sorts last.
function periodEndRank(item: ReturnListItem): string {
  return item.ret.periodEnd ?? '';
}

export default function CompanyTaxDashboard({ onBack, onOpen, onNewForClient }: {
  onBack: () => void;
  onOpen: (r: TaxReturn) => void;
  onNewForClient: (client: CompanyTaxClient) => void;
}): JSX.Element {
  const [clients, setClients] = useState<CompanyTaxClient[]>([]);
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState<ClientStatusFilter>('all');
  const [submissionFilter, setSubmissionFilter] = useState<SubmissionFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [confirmDel, setConfirmDel] = useState<ReturnListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Delete / archive — only allowed on returns that haven't been submitted.
  async function doDelete(item: ReturnListItem) {
    setBusyId(item.id);
    try { await deleteReturn(item.id); setReturns(prev => prev.filter(r => r.id !== item.id)); }
    catch { /* non-fatal */ }
    finally { setBusyId(null); setConfirmDel(null); }
  }
  async function doArchive(item: ReturnListItem, archived: boolean) {
    setBusyId(item.id);
    const updated = { ...item.ret, archived };
    try { await saveReturn(updated); setReturns(prev => prev.map(r => (r.id === item.id ? { ...r, ret: updated } : r))); }
    catch { /* non-fatal */ }
    finally { setBusyId(null); }
  }

  // ── Data load (once on mount) ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [clientData, returnList] = await Promise.all([
          fetchJson<{ clients: CompanyTaxClient[] }>('/api/clients?types=limited_company'),
          listReturns(),
        ]);
        if (cancelled) return;
        setClients(clientData.clients ?? []);
        // Company Tax = CT600 returns only.
        setReturns((returnList ?? []).filter(r => r.ret.returnType === 'ct600'));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clients.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Group CT600 returns by clientId, newest accounting-period end first.
  const returnsByClient = useMemo(() => {
    const map = new Map<string, ReturnListItem[]>();
    for (const item of returns) {
      const cid = item.ret.clientId;
      if (!cid) continue;
      const arr = map.get(cid);
      if (arr) arr.push(item);
      else map.set(cid, [item]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => periodEndRank(b).localeCompare(periodEndRank(a)));
    }
    return map;
  }, [returns]);

  function toggleSort(key: SortKey) {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Build the display rows: attach the most-recent return → filter → sort.
  const rows: ClientRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const statusLabel = (r: ClientRow) => (r.latestStatus ? STATUS_META[r.latestStatus].label : 'Not started');

    const built: ClientRow[] = clients.map(client => {
      const clientReturns = returnsByClient.get(client.id) ?? [];
      const latestReturn = clientReturns[0] ?? null;
      const latestStatus = latestReturn ? deriveStatus(latestReturn.ret) : null;
      return { client, returns: clientReturns, latestReturn, latestStatus };
    });

    const filtered = built.filter(r => {
      if (q) {
        const hay = `${r.client.name} ${r.client.client_ref ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (clientStatusFilter !== 'all' && (r.client.status ?? 'active') !== clientStatusFilter) return false;
      // Submission filter matches the most-recent return status ('not-started'
      // covers companies with no CT600 return at all).
      if (submissionFilter !== 'all' && (r.latestStatus ?? 'not-started') !== submissionFilter) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return compareValues(a.client.name, b.client.name, sortDir);
        case 'client_ref':
          return compareValues(a.client.client_ref, b.client.client_ref, sortDir);
        case 'registration':
          return compareValues(a.client.registration_number, b.client.registration_number, sortDir);
        case 'utr':
          return compareValues(a.client.utr_number, b.client.utr_number, sortDir);
        case 'status':
          return compareValues(statusLabel(a), statusLabel(b), sortDir);
        default:
          return 0;
      }
    });
  }, [clients, returnsByClient, search, sortKey, sortDir, clientStatusFilter, submissionFilter]);

  // ── Export ─────────────────────────────────────────────────────────────────
  function exportCsv() {
    const headers = ['Client', 'Code', 'Company no.', 'UTR', 'Client status', 'Status (most recent return)', 'Returns'];
    const dataRows = rows.map(r => [
      r.client.name,
      r.client.client_ref ?? '',
      r.client.registration_number ?? '',
      r.client.utr_number ?? '',
      clientStatusLabel(r.client.status),
      r.latestStatus ? STATUS_META[r.latestStatus].label : 'Not started',
      String(r.returns.length),
    ]);
    const csv = [headers, ...dataRows].map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Company_Tax_CT600_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCols = 7; // chevron · Client · Code · Company no. · UTR · Status · actions

  return (
    <div className="space-y-4">
      {/* Back link */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Title (no tax-year picker — companies file by accounting period) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Building2 size={22} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-tight text-[var(--text-primary)]">Company Tax (CT600)</h2>
            <p className="text-[12px] text-[var(--text-muted)]">Limited companies — returns by accounting period</p>
          </div>
        </div>
      </div>

      {/* Toolbar: search + filters + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-[300px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name or code…"
            className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>
        <FilterSelect value={clientStatusFilter} onChange={v => setClientStatusFilter(v as ClientStatusFilter)} options={CLIENT_STATUS_OPTIONS} />
        <FilterSelect value={submissionFilter} onChange={v => setSubmissionFilter(v as SubmissionFilter)} options={SUBMISSION_OPTIONS} />
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-black/[0.03] disabled:opacity-40 disabled:hover:bg-white"
        >
          <Download size={14} /> Export
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      {/* Table */}
      <StudioCard className="overflow-hidden">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="sticky top-0 z-10 w-8 border-b border-black/5 bg-white/95 px-3 py-2.5 backdrop-blur" />
                <SortHeader label="Client" field="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Code" field="client_ref" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Company no." field="registration" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="UTR" field="utr" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Status" field="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="sticky top-0 z-10 w-8 border-b border-black/5 bg-white/95 px-3 py-2.5 backdrop-blur" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-14 text-center text-[13px] text-[var(--text-muted)]">
                    <Loader2 size={16} className="mr-2 inline animate-spin" /> Loading clients…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-14 text-center text-[13px] text-[var(--text-muted)]">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <Building2 size={20} />
                      </div>
                      <p className="font-semibold text-[var(--text-secondary)]">No limited companies yet</p>
                      <p className="max-w-xs text-[12px]">Add a limited-company client to start preparing CT600 returns.</p>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-14 text-center text-[13px] text-[var(--text-muted)]">
                    No clients match your search.
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <ClientRowView
                    key={row.client.id}
                    row={row}
                    expanded={expanded.has(row.client.id)}
                    totalCols={totalCols}
                    onToggle={() => toggleExpanded(row.client.id)}
                    onOpen={onOpen}
                    onNewForClient={onNewForClient}
                    busyId={busyId}
                    onDeleteReturn={(item) => setConfirmDel(item)}
                    onArchiveReturn={doArchive}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        {!loading && clients.length > 0 && (
          <div className="flex items-center justify-between border-t border-black/5 bg-white/70 px-3 py-2 text-[11.5px] text-[var(--text-muted)]">
            <span>{rows.length} of {clients.length} compan{clients.length === 1 ? 'y' : 'ies'}</span>
            <span>Returns by accounting period</span>
          </div>
        )}
      </StudioCard>

      {confirmDel && (
        <DeleteReturnModal
          item={confirmDel}
          busy={busyId === confirmDel.id}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => doDelete(confirmDel)}
        />
      )}
    </div>
  );
}

// Confirm before permanently deleting a return.
function DeleteReturnModal({ item, busy, onCancel, onConfirm }: {
  item: ReturnListItem; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ret = item.ret;
  const periodLabel = ret.periodStart && ret.periodEnd ? `${fmtDateUK(ret.periodStart)} – ${fmtDateUK(ret.periodEnd)}` : ret.taxYear;
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={() => !busy && onCancel()}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-white p-5 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600"><AlertTriangle size={18} /></div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-[var(--text-primary)]">Delete this return?</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">Permanently delete the <span className="font-semibold text-[var(--text-primary)]">{periodLabel}</span> CT600 for <span className="font-semibold text-[var(--text-primary)]">{ret.clientName}</span>. This can’t be undone.</p>
          </div>
          <button onClick={() => !busy && onCancel()} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-secondary bg-white">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sortable column header ──────────────────────────────────────────────────
function SortHeader({ label, field, sortKey, sortDir, onSort }: {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (field: SortKey) => void;
}) {
  const active = sortKey === field;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="sticky top-0 z-10 border-b border-black/5 bg-white/95 px-3 py-2.5 backdrop-blur">
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`group inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
          active ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        }`}
      >
        {label}
        <Icon size={11} className={active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'} />
      </button>
    </th>
  );
}

// ─── Filter dropdown ─────────────────────────────────────────────────────────
function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== 'all';
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`rounded-lg border px-2.5 py-2 text-[12.5px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 ${
        active
          ? 'border-[var(--accent)]/50 bg-[var(--accent)]/[0.06] text-[var(--accent)]'
          : 'border-[var(--border)] bg-white text-[var(--text-secondary)]'
      }`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── Expandable client row ───────────────────────────────────────────────────
function ClientRowView({ row, expanded, totalCols, onToggle, onOpen, onNewForClient, busyId, onDeleteReturn, onArchiveReturn }: {
  row: ClientRow;
  expanded: boolean;
  totalCols: number;
  onToggle: () => void;
  onOpen: (r: TaxReturn) => void;
  onNewForClient: (client: CompanyTaxClient) => void;
  busyId: string | null;
  onDeleteReturn: (item: ReturnListItem) => void;
  onArchiveReturn: (item: ReturnListItem, archived: boolean) => void;
}) {
  const { client, returns, latestReturn, latestStatus } = row;
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-black/5 transition-colors hover:bg-black/[0.02]"
      >
        <td className="w-8 px-3 py-2.5">
          <ChevronRight size={15} className={`text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={client.name} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-[var(--text-primary)]">{client.name}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`inline-flex rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${clientStatusTone(client.status)}`}>{clientStatusLabel(client.status)}</span>
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">{client.client_ref ?? '—'}</td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">{client.registration_number ?? '—'}</td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">{client.utr_number ?? '—'}</td>
        <td className="px-3 py-2.5">
          {latestStatus
            ? <StatusBadge status={latestStatus} />
            : <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">Not started</span>}
        </td>
        <td className="w-8 px-3 py-2.5 text-right">
          {latestReturn
            ? (
              <button
                onClick={e => { e.stopPropagation(); onOpen(latestReturn.ret); }}
                aria-label={`Open ${client.name} return`}
                className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                <ArrowRight size={15} />
              </button>
            )
            : (
              <button
                onClick={e => { e.stopPropagation(); onNewForClient(client); }}
                aria-label={`Start CT600 return for ${client.name}`}
                className="text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
              >
                <Plus size={15} />
              </button>
            )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-[var(--accent)]/15 bg-[var(--accent)]/[0.04]">
          <td colSpan={totalCols} className="px-6 py-4" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-4">
              {/* Identity line */}
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--text-muted)]">Status:</span>
                  <span className={`inline-flex rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${clientStatusTone(client.status)}`}>{clientStatusLabel(client.status)}</span>
                </div>
                {client.utr_number && (
                  <IdentityItem icon={FileText} label="UTR" value={client.utr_number} mono />
                )}
                {client.registration_number && (
                  <IdentityItem icon={Hash} label="Company no." value={client.registration_number} mono />
                )}
                {client.contact_email && (
                  <div className="flex items-center gap-1.5">
                    <Mail size={13} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="text-[var(--text-muted)]">Email:</span>
                    <ClientEmailLink
                      email={client.contact_email}
                      client={{ id: client.id, name: client.name, client_ref: client.client_ref, contact_email: client.contact_email }}
                      className="font-medium text-[var(--accent)] hover:underline"
                    />
                  </div>
                )}
              </div>

              {/* Returns list */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">CT600 returns</p>
                {returns.length === 0 ? (
                  <p className="text-[12px] text-[var(--text-muted)]">No CT600 returns yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {returns.map(item => (
                      <ReturnRow key={item.id} item={item} onOpen={onOpen}
                        busy={busyId === item.id}
                        onDelete={() => onDeleteReturn(item)}
                        onArchive={(archived) => onArchiveReturn(item, archived)} />
                    ))}
                  </div>
                )}
              </div>

              {/* New return */}
              <div>
                <button
                  onClick={() => onNewForClient(client)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <Plus size={14} /> New return
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── One CT600 return: accounting period + key figures ───────────────────────
function ReturnRow({ item, onOpen, busy: rowBusy, onDelete, onArchive }: {
  item: ReturnListItem;
  onOpen: (r: TaxReturn) => void;
  busy: boolean;
  onDelete: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const ret = item.ret;
  const status = deriveStatus(ret);
  const c = useMemo(() => computeCt600(ret.ct600, ret.taxYear, { periodStart: ret.periodStart, periodEnd: ret.periodEnd }), [ret.ct600, ret.taxYear, ret.periodStart, ret.periodEnd]);
  // Submitted (filed/amended) returns are locked — no delete/archive.
  const canModify = ret.approvalStatus !== 'submitted';

  // Companies file for an accounting period — show the period, or fall back to
  // the coarse tax-year grouping label when the period isn't recorded.
  const periodLabel = ret.periodStart && ret.periodEnd
    ? `${fmtDateUK(ret.periodStart)} – ${fmtDateUK(ret.periodEnd)}`
    : ret.taxYear;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[12.5px] font-bold text-[var(--text-primary)]">{periodLabel}</span>
        <StatusBadge status={status} />
        <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${ret.amended ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
          {ret.amended ? 'Amended' : 'Original'}
        </span>
        <span className="flex-1 truncate text-[11.5px] text-[var(--text-muted)]">{returnType(ret.returnType).form} · edited {item.date}</span>
        {canModify && (
          <div className="flex items-center gap-0.5">
            <Tooltip label={ret.archived ? 'Unarchive return' : 'Archive return'}>
              <button type="button" onClick={() => onArchive(!ret.archived)} disabled={rowBusy} aria-label={ret.archived ? 'Unarchive return' : 'Archive return'}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] disabled:opacity-50">
                {rowBusy ? <Loader2 size={13} className="animate-spin" /> : ret.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </Tooltip>
            <Tooltip label="Delete return">
              <button type="button" onClick={onDelete} disabled={rowBusy} aria-label="Delete return"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        )}
        <button
          onClick={() => onOpen(ret)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
        >
          Open <ArrowRight size={12} />
        </button>
      </div>
      {/* Key figures for the return */}
      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1.5 border-t border-black/5 pt-2">
        <Figure label="Total profits" value={fmtMoney(c.totalProfits ?? 0)} />
        <Figure label="PCTCT" value={fmtMoney(c.pctct ?? 0)} />
        <Figure label="Corporation Tax" value={fmtMoney(c.corporationTax ?? 0)} />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="text-[13px] font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function IdentityItem({ icon: Icon, label, value, mono }: {
  icon: typeof Mail;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={13} className="shrink-0 text-[var(--text-muted)]" />
      <span className="text-[var(--text-muted)]">{label}:</span>
      <span className={`text-[var(--text-secondary)] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px] font-bold text-[var(--accent)]">
      {initials}
    </div>
  );
}
