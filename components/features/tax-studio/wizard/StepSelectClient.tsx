'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search as SearchIcon, Loader2, ArrowUp, ArrowDown, ArrowUpDown, X, Check, Circle,
  Mail, Phone, Download, Copy, ExternalLink, TrendingUp, MessageSquarePlus, Sparkles,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { exportToCsv } from '@/utils/fileUtils';
import { StatusBadge } from '../primitives';
import {
  deriveStatus, currentFilingSeason, fmtMoney, fmtDateUK, returnType, STATUS_META,
} from '../data';
import { estimateSa100 } from '../calc';
import {
  businessTypesForReturn, entityLabelForBusinessType, type WizardClient,
} from './wizardData';
import type { ReturnTypeId, ReturnStatus } from '../types';
import type { ReturnListItem } from '../persistence';

type SortKey = 'name' | 'account' | 'return' | 'lastReturn';

// Client account status (matches the Clients list): active / hold / inactive.
const ACCOUNT_STATUS: Record<string, { dot: string; label: string }> = {
  active:   { dot: 'text-green-500 fill-green-500', label: 'Active' },
  hold:     { dot: 'text-amber-500 fill-amber-500', label: 'On Hold' },
  inactive: { dot: 'text-[var(--text-muted)] fill-[var(--text-muted)]', label: 'Inactive' },
};
const ACCOUNT_RANK: Record<string, number> = { active: 0, hold: 1, inactive: 2 };
const STATUS_ORDER = Object.keys(STATUS_META) as ReturnStatus[];

function accountLabel(status?: string | null): string {
  return ACCOUNT_STATUS[(status ?? '').toLowerCase()]?.label ?? '—';
}

function AccountStatusDot({ status }: { status?: string | null }) {
  const key = (status ?? '').toLowerCase();
  const cfg = ACCOUNT_STATUS[key];
  if (!cfg) return null;
  return (
    <Tooltip label={cfg.label}>
      <Circle size={9} className={`shrink-0 ${cfg.dot}`} aria-label={cfg.label} />
    </Tooltip>
  );
}

function AccountStatusCell({ status }: { status?: string | null }) {
  const cfg = ACCOUNT_STATUS[(status ?? '').toLowerCase()];
  if (!cfg) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[var(--text-secondary)]">
      <Circle size={9} className={`shrink-0 ${cfg.dot}`} /> {cfg.label}
    </span>
  );
}

export default function StepSelectClient({
  returnTypeId, selected, onSelect, allReturns,
}: {
  returnTypeId: ReturnTypeId;
  selected: WizardClient | null;
  onSelect: (c: WizardClient | null) => void;
  allReturns: ReturnListItem[];
}) {
  const [clients, setClients] = useState<WizardClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [returnFilter, setReturnFilter] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  const season = currentFilingSeason();
  const rt = returnType(returnTypeId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/clients', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load clients'))))
      .then(d => { if (!cancelled) setClients((d.clients ?? []) as WizardClient[]); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Returns grouped by client — for status / history columns.
  const returnsByClient = useMemo(() => {
    const map = new Map<string, ReturnListItem[]>();
    for (const it of allReturns) {
      const cid = it.ret.clientId;
      if (!cid) continue;
      const arr = map.get(cid) ?? [];
      arr.push(it);
      map.set(cid, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.ret.taxYear < b.ret.taxYear ? 1 : -1));
    return map;
  }, [allReturns]);

  const eligibleTypes = businessTypesForReturn(returnTypeId);

  // Eligible clients, enriched with their latest return status, then
  // search-filtered, status-filtered and sorted for display.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const enriched = clients
      .filter(c => !eligibleTypes.length || eligibleTypes.includes((c.business_type ?? '').toLowerCase()))
      .map(c => {
        const history = returnsByClient.get(c.id) ?? [];
        const latest = history[0];
        const rst: ReturnStatus = latest ? deriveStatus(latest.ret) : 'not-started';
        return { c, history, latest, rst };
      })
      .filter(({ c, rst }) => {
        if (q && !`${c.name} ${c.client_ref ?? ''}`.toLowerCase().includes(q)) return false;
        if (accountFilter !== 'all' && (c.status ?? '').toLowerCase() !== accountFilter) return false;
        if (returnFilter === 'not-started' && rst !== 'not-started') return false;
        if (returnFilter === 'in-progress' && !['waiting-info', 'analysing', 'review', 'ready-to-send', 'awaiting-approval', 'approved', 'ready-to-file'].includes(rst)) return false;
        if (returnFilter === 'filed' && !['filed', 'amended'].includes(rst)) return false;
        return true;
      });

    const dir = sort.dir === 'asc' ? 1 : -1;
    const sortVal = (r: typeof enriched[number]): string | number => {
      switch (sort.key) {
        case 'account': return ACCOUNT_RANK[(r.c.status ?? '').toLowerCase()] ?? 99;
        case 'return': return STATUS_ORDER.indexOf(r.rst);
        case 'lastReturn': return r.latest ? r.latest.ret.taxYear : '';
        case 'name': default: return r.c.name.toLowerCase();
      }
    };
    return enriched.sort((a, b) => {
      const va = sortVal(a), vb = sortVal(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.c.name.toLowerCase() < b.c.name.toLowerCase() ? -1 : 1; // stable tiebreak by name
    });
  }, [clients, eligibleTypes, search, accountFilter, returnFilter, sort, returnsByClient]);

  function toggleSort(key: SortKey) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function exportCsv() {
    if (rows.length === 0) return;
    exportToCsv(
      rows.map(({ c, latest, rst }) => ({
        Client: c.name,
        Ref: c.client_ref ?? '',
        'Account status': accountLabel(c.status),
        Type: entityLabelForBusinessType(c.business_type),
        Email: c.contact_email ?? '',
        'Return status': STATUS_META[rst].label,
        'Last return': latest ? latest.ret.taxYear : '',
        'Tax year': season.taxYear,
        'Filing deadline': fmtDateUK(season.deadline),
      })),
      `sa100-clients-${season.taxYear.replace('/', '-')}.csv`,
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      {/* Table */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search individuals or sole traders…" className="input-base py-1.5 pl-9 text-sm" />
          </div>
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="input-base w-auto py-1.5 text-sm" aria-label="Filter by account status">
            <option value="all">All account statuses</option>
            <option value="active">Active</option>
            <option value="hold">On Hold</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={returnFilter} onChange={e => setReturnFilter(e.target.value)} className="input-base w-auto py-1.5 text-sm" aria-label="Filter by return status">
            <option value="all">All return statuses</option>
            <option value="not-started">Not started</option>
            <option value="in-progress">In progress</option>
            <option value="filed">Filed</option>
          </select>
          <Tooltip label="Export this list to CSV">
            <button onClick={exportCsv} disabled={rows.length === 0} className="btn-secondary shrink-0 disabled:opacity-40" aria-label="Export list to CSV">
              <Download size={15} /> Export
            </button>
          </Tooltip>
        </div>

        <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
          {loading ? 'Loading…' : `Showing ${rows.length} eligible client${rows.length === 1 ? '' : 's'} for ${rt.form}`}
        </p>

        {error ? (
          <p className="py-8 text-center text-[13px] text-rose-600">{error}</p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading clients…</div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[var(--text-muted)]">No eligible clients found. {eligibleTypes.length ? `${rt.form} needs a ${eligibleTypes.join(' / ')} client.` : ''}</p>
        ) : (
          <div className="mt-2 max-h-[460px] overflow-auto rounded-lg border border-black/5">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="sticky top-0 z-10 border-b border-black/5 bg-white/95 px-3 py-2 backdrop-blur"></th>
                  <SortableTh label="Client" sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Account" sortKey="account" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Return" sortKey="return" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Last return" sortKey="lastReturn" sort={sort} onSort={toggleSort} />
                  <th className="sticky top-0 z-10 border-b border-black/5 bg-white/95 px-3 py-2 backdrop-blur">Tax year</th>
                  <th className="sticky top-0 z-10 border-b border-black/5 bg-white/95 px-3 py-2 backdrop-blur">Next deadline</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, latest, rst }) => {
                  const isSel = selected?.id === c.id;
                  return (
                    <tr key={c.id} onClick={() => onSelect(c)}
                      className={`cursor-pointer border-b border-black/5 text-[12.5px] transition-colors ${isSel ? 'bg-[var(--accent)]/[0.06]' : 'hover:bg-black/[0.02]'}`}>
                      <td className="px-3 py-2.5">
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${isSel ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-slate-300'}`}>
                          {isSel && <Check size={11} />}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[var(--text-primary)]">{c.name}</p>
                            <p className="text-[11px] text-[var(--text-muted)]">{c.client_ref ?? '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[12px]"><AccountStatusCell status={c.status} /></td>
                      <td className="px-3 py-2.5"><StatusBadge status={rst} /></td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{latest ? latest.ret.taxYear : '—'}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{season.taxYear}</td>
                      <td className="px-3 py-2.5">
                        <p className="text-[var(--text-secondary)]">{fmtDateUK(season.deadline)}</p>
                        <p className={`text-[10.5px] ${season.daysToDeadline < 60 ? 'text-rose-600' : 'text-[var(--text-muted)]'}`}>in {season.daysToDeadline} days</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        {selected ? (
          <ClientDetail client={selected} history={returnsByClient.get(selected.id) ?? []} onClear={() => onSelect(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><SearchIcon size={20} /></div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Select a client</p>
            <p className="max-w-[220px] text-[12px] text-[var(--text-muted)]">Choose a client from the list to see their return history and details.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientDetail({ client, history, onClear }: { client: WizardClient; history: ReturnListItem[]; onClear: () => void }) {
  const submitted = history.filter(h => h.ret.approvalStatus === 'submitted');
  return (
    <div>
      <div className="flex items-start gap-3">
        <Avatar name={client.name} lg />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15px] font-bold text-[var(--text-primary)]">{client.name}</h4>
          <p className="text-[11.5px] text-[var(--text-muted)]">{client.client_ref ?? '—'}</p>
        </div>
        <button onClick={onClear} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
        <AccountStatusDot status={client.status} />
        {entityLabelForBusinessType(client.business_type)} · Self Assessment
      </p>
      <div className="mt-2 space-y-1">
        {client.contact_email && <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]"><Mail size={12} className="text-[var(--text-muted)]" /> {client.contact_email}</p>}
        {client.contact_number && <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]"><Phone size={12} className="text-[var(--text-muted)]" /> {client.contact_number}</p>}
      </div>

      {/* Return history */}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Return history</p>
      {history.length ? (
        <div className="mt-2 space-y-1.5">
          {history.slice(0, 5).map(h => {
            const est = estimateSa100(h.ret.income, h.ret.taxYear);
            const st = deriveStatus(h.ret);
            return (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-1.5">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">{h.ret.taxYear}</span>
                <StatusBadge status={st} />
                <span className="text-[11.5px] text-[var(--text-secondary)]">{est.balancingPayment > 0 ? `${fmtMoney(est.balancingPayment)} due` : '—'}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">No prior Tax Studio returns for this client.</p>
      )}

      {/* Quick actions */}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Quick actions</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          { icon: ExternalLink, label: 'Open in tool' },
          { icon: Download, label: 'Quick download' },
          { icon: Copy, label: 'Copy for amendment' },
          { icon: TrendingUp, label: 'Planning scenario' },
        ].map(a => (
          <button key={a.label} disabled className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] opacity-60">
            <a.icon size={13} /> {a.label}
          </button>
        ))}
      </div>

      {/* AI summary */}
      <div className="mt-4 rounded-xl bg-[var(--accent)]/[0.05] p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]"><Sparkles size={13} className="text-[var(--accent)]" /> AI summary</p>
        <p className="mt-1 text-[11.5px] text-[var(--text-secondary)]">
          {submitted.length
            ? `${submitted.length} return${submitted.length > 1 ? 's' : ''} filed to date. SMITH will roll last year's data forward and highlight what's changed.`
            : 'No filed history yet — SMITH will build this return from connected data and flag anything to review.'}
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
          <MessageSquarePlus size={11} /> Phase 1 summary
        </span>
      </div>
    </div>
  );
}

function Avatar({ name, lg }: { name: string; lg?: boolean }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 font-bold text-[var(--accent)] ${lg ? 'h-11 w-11 text-[14px]' : 'h-8 w-8 text-[11px]'}`}>
      {initials}
    </div>
  );
}

function SortableTh({
  label, sortKey, sort, onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="sticky top-0 z-10 border-b border-black/5 bg-white/95 px-3 py-2 backdrop-blur">
      <button
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}${active ? (sort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
        className="group inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-[var(--text-secondary)]"
      >
        {label}
        {active
          ? (sort.dir === 'asc' ? <ArrowUp size={12} className="text-[var(--accent)]" /> : <ArrowDown size={12} className="text-[var(--accent)]" />)
          : <ArrowUpDown size={12} className="opacity-0 transition-opacity group-hover:opacity-40" />}
      </button>
    </th>
  );
}
