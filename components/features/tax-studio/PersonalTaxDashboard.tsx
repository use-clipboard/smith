'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ArrowUpDown, Download, Loader2,
  Plus, Search, ChevronRight, Users, Mail, CreditCard, FileText,
} from 'lucide-react';
import { StudioCard, StatusBadge } from './primitives';
import { deriveStatus, STATUS_META, returnType } from './data';
import { listReturns, type ReturnListItem } from './persistence';
import { fetchJson } from '@/lib/fetchJson';
import type { TaxReturn, ReturnStatus } from './types';

export interface PersonalTaxClient {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  contact_email: string | null;
  status?: string | null;               // client lifecycle: active/hold/inactive
  utr_number?: string | null;
  national_insurance_number?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
}

// Tax years offered in the picker (newest first). 2025/26 is the working default.
const TAX_YEARS = ['2026/27', '2025/26', '2024/25', '2023/24', '2022/23'] as const;
const DEFAULT_TAX_YEAR = '2025/26';

type SortKey = 'name' | 'client_ref' | 'utr' | 'status';
type SortDir = 'asc' | 'desc';

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

// A client's returns grouped, plus the return (if any) for the selected year.
interface ClientRow {
  client: PersonalTaxClient;
  /** All SA100 returns for this client, newest tax year first. */
  returns: ReturnListItem[];
  /** The return matching the selected tax year, if one exists. */
  yearReturn: ReturnListItem | null;
  /** Status for the selected year — 'Not started' when no return exists. */
  yearStatus: ReturnStatus | null;
}

// Tax-year labels sort lexically the wrong way ('2024/25' < '2025/26' ✓ actually
// works because the leading year dominates), so a plain string compare desc is
// correct for "newest first".
function taxYearRank(label: string): string {
  return label;
}

export default function PersonalTaxDashboard({ onBack, onOpen, onNewForClient }: {
  onBack: () => void;
  onOpen: (r: TaxReturn) => void;
  onNewForClient: (client: PersonalTaxClient, taxYear: string) => void;
}): JSX.Element {
  const [clients, setClients] = useState<PersonalTaxClient[]>([]);
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [taxYear, setTaxYear] = useState<string>(DEFAULT_TAX_YEAR);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // ── Data load (once on mount) ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [clientData, returnList] = await Promise.all([
          fetchJson<{ clients: PersonalTaxClient[] }>('/api/clients?types=sole_trader,individual'),
          listReturns(),
        ]);
        if (cancelled) return;
        setClients(clientData.clients ?? []);
        // Personal Tax = SA100 returns only.
        setReturns((returnList ?? []).filter(r => r.ret.returnType === 'sa100'));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clients.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Group SA100 returns by clientId for quick lookup.
  const returnsByClient = useMemo(() => {
    const map = new Map<string, ReturnListItem[]>();
    for (const item of returns) {
      const cid = item.ret.clientId;
      if (!cid) continue;
      const arr = map.get(cid);
      if (arr) arr.push(item);
      else map.set(cid, [item]);
    }
    // Sort each client's returns newest tax year first.
    for (const arr of map.values()) {
      arr.sort((a, b) => taxYearRank(b.ret.taxYear).localeCompare(taxYearRank(a.ret.taxYear)));
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

  // Build the display rows: filter → attach the selected-year return → sort.
  const rows: ClientRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.filter(c => {
      if (!q) return true;
      const hay = `${c.name} ${c.client_ref ?? ''}`.toLowerCase();
      return hay.includes(q);
    });

    const built: ClientRow[] = list.map(client => {
      const clientReturns = returnsByClient.get(client.id) ?? [];
      const yearReturn = clientReturns.find(r => r.ret.taxYear === taxYear) ?? null;
      const yearStatus = yearReturn ? deriveStatus(yearReturn.ret) : null;
      return { client, returns: clientReturns, yearReturn, yearStatus };
    });

    const statusLabel = (r: ClientRow) => (r.yearStatus ? STATUS_META[r.yearStatus].label : 'Not started');

    return built.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return compareValues(a.client.name, b.client.name, sortDir);
        case 'client_ref':
          return compareValues(a.client.client_ref, b.client.client_ref, sortDir);
        case 'utr':
          return compareValues(a.client.utr_number, b.client.utr_number, sortDir);
        case 'status':
          return compareValues(statusLabel(a), statusLabel(b), sortDir);
        default:
          return 0;
      }
    });
  }, [clients, returnsByClient, search, taxYear, sortKey, sortDir]);

  // ── Export ─────────────────────────────────────────────────────────────────
  function exportCsv() {
    const headers = ['Client', 'Code', 'UTR', 'NI Number', 'Email', `Status (${taxYear})`, 'Returns'];
    const dataRows = rows.map(r => [
      r.client.name,
      r.client.client_ref ?? '',
      r.client.utr_number ?? '',
      r.client.national_insurance_number ?? '',
      r.client.contact_email ?? '',
      r.yearStatus ? STATUS_META[r.yearStatus].label : 'Not started',
      String(r.returns.length),
    ]);
    const csv = [headers, ...dataRows].map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Personal_Tax_${taxYear.replace('/', '-')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCols = 6; // chevron · Client · Code · UTR · Status · actions

  return (
    <div className="space-y-4">
      {/* Back link */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Title + tax-year picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Users size={22} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-tight text-[var(--text-primary)]">Personal Tax (SA100)</h2>
            <p className="text-[12px] text-[var(--text-muted)]">Individuals &amp; sole traders — returns by tax year</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-muted)]">Tax year</span>
          <select
            value={taxYear}
            onChange={e => setTaxYear(e.target.value)}
            aria-label="Tax year"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          >
            {TAX_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Toolbar: search + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-[340px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name or code…"
            className="w-full rounded-lg border border-[var(--border)] bg-white py-2 pl-9 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-black/[0.03] disabled:opacity-40 disabled:hover:bg-white"
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
                        <Users size={20} />
                      </div>
                      <p className="font-semibold text-[var(--text-secondary)]">No individuals or sole traders yet</p>
                      <p className="max-w-xs text-[12px]">Add an individual or sole-trader client to start preparing SA100 returns.</p>
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
                    taxYear={taxYear}
                    expanded={expanded.has(row.client.id)}
                    totalCols={totalCols}
                    onToggle={() => toggleExpanded(row.client.id)}
                    onOpen={onOpen}
                    onNewForClient={onNewForClient}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        {!loading && clients.length > 0 && (
          <div className="flex items-center justify-between border-t border-black/5 bg-white/70 px-3 py-2 text-[11.5px] text-[var(--text-muted)]">
            <span>{rows.length} of {clients.length} client{clients.length === 1 ? '' : 's'}</span>
            <span>Showing {taxYear}</span>
          </div>
        )}
      </StudioCard>
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

// ─── Expandable client row ───────────────────────────────────────────────────
function ClientRowView({ row, taxYear, expanded, totalCols, onToggle, onOpen, onNewForClient }: {
  row: ClientRow;
  taxYear: string;
  expanded: boolean;
  totalCols: number;
  onToggle: () => void;
  onOpen: (r: TaxReturn) => void;
  onNewForClient: (client: PersonalTaxClient, taxYear: string) => void;
}) {
  const { client, returns, yearReturn, yearStatus } = row;
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
            <span className="truncate font-semibold text-[var(--text-primary)]">{client.name}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">{client.client_ref ?? '—'}</td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">{client.utr_number ?? '—'}</td>
        <td className="px-3 py-2.5">
          {yearStatus
            ? <StatusBadge status={yearStatus} />
            : <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">Not started</span>}
        </td>
        <td className="w-8 px-3 py-2.5 text-right">
          {yearReturn
            ? (
              <button
                onClick={e => { e.stopPropagation(); onOpen(yearReturn.ret); }}
                aria-label={`Open ${taxYear} return`}
                className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                <ArrowRight size={15} />
              </button>
            )
            : (
              <button
                onClick={e => { e.stopPropagation(); onNewForClient(client, taxYear); }}
                aria-label={`Start ${taxYear} return`}
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
              {(client.utr_number || client.national_insurance_number || client.contact_email) && (
                <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]">
                  {client.utr_number && (
                    <IdentityItem icon={FileText} label="UTR" value={client.utr_number} mono />
                  )}
                  {client.national_insurance_number && (
                    <IdentityItem icon={CreditCard} label="NI Number" value={client.national_insurance_number} mono />
                  )}
                  {client.contact_email && (
                    <IdentityItem icon={Mail} label="Email" value={client.contact_email} />
                  )}
                </div>
              )}

              {/* Returns list */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tax returns</p>
                {returns.length === 0 ? (
                  <p className="text-[12px] text-[var(--text-muted)]">No returns yet.</p>
                ) : (
                  <div className="space-y-1">
                    {returns.map(item => {
                      const status = deriveStatus(item.ret);
                      const isSelectedYear = item.ret.taxYear === taxYear;
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                            isSelectedYear
                              ? 'border-[var(--accent)]/30 bg-white'
                              : 'border-[var(--border)] bg-white/60'
                          }`}
                        >
                          <span className="w-16 shrink-0 text-[12.5px] font-bold text-[var(--text-primary)]">{item.ret.taxYear}</span>
                          <StatusBadge status={status} />
                          <span className="flex-1 truncate text-[11.5px] text-[var(--text-muted)]">
                            {returnType(item.ret.returnType).form} · edited {item.date}
                          </span>
                          <button
                            onClick={() => onOpen(item.ret)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                          >
                            Open <ArrowRight size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* New return */}
              <div>
                <button
                  onClick={() => onNewForClient(client, taxYear)}
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
