'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search as SearchIcon, Loader2, ChevronLeft, ChevronRight, X, Check,
  Mail, Phone, Download, Copy, ExternalLink, TrendingUp, MessageSquarePlus, Sparkles,
} from 'lucide-react';
import { StatusBadge } from '../primitives';
import {
  deriveStatus, currentFilingSeason, fmtMoney, fmtDateUK, returnType,
} from '../data';
import { estimateSa100 } from '../calc';
import {
  businessTypesForReturn, entityLabelForBusinessType, type WizardClient,
} from './wizardData';
import type { ReturnTypeId } from '../types';
import type { ReturnListItem } from '../persistence';

const PAGE_SIZE = 10;

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
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

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
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter(c => {
      if (eligibleTypes.length && !eligibleTypes.includes((c.business_type ?? '').toLowerCase())) return false;
      if (q && !(`${c.name} ${c.client_ref ?? ''}`.toLowerCase().includes(q))) return false;
      if (statusFilter !== 'all') {
        const latest = returnsByClient.get(c.id)?.[0];
        const st = latest ? deriveStatus(latest.ret) : 'not-started';
        if (statusFilter === 'not-started' && st !== 'not-started') return false;
        if (statusFilter === 'in-progress' && !['analysing', 'review', 'waiting-info'].includes(st)) return false;
        if (statusFilter === 'filed' && st !== 'filed') return false;
      }
      return true;
    });
  }, [clients, eligibleTypes, search, statusFilter, returnsByClient]);

  useEffect(() => { setPage(1); }, [search, statusFilter, returnTypeId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      {/* Table */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search individuals or sole traders…" className="input-base py-1.5 pl-9 text-sm" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-base w-auto py-1.5 text-sm">
            <option value="all">All statuses</option>
            <option value="not-started">Not started</option>
            <option value="in-progress">In progress</option>
            <option value="filed">Filed</option>
          </select>
        </div>

        <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
          {loading ? 'Loading…' : `Showing ${filtered.length} eligible client${filtered.length === 1 ? '' : 's'} for ${rt.form}`}
        </p>

        {error ? (
          <p className="py-8 text-center text-[13px] text-rose-600">{error}</p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading clients…</div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[var(--text-muted)]">No eligible clients found. {eligibleTypes.length ? `${rt.form} needs a ${eligibleTypes.join(' / ')} client.` : ''}</p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="py-2 pr-2"></th>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Last return</th>
                    <th className="py-2 pr-3">Tax year</th>
                    <th className="py-2 pr-3">Next deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(c => {
                    const history = returnsByClient.get(c.id) ?? [];
                    const latest = history[0];
                    const status = latest ? deriveStatus(latest.ret) : 'not-started';
                    const isSel = selected?.id === c.id;
                    return (
                      <tr key={c.id} onClick={() => onSelect(c)}
                        className={`cursor-pointer border-b border-black/5 text-[12.5px] transition-colors ${isSel ? 'bg-[var(--accent)]/[0.06]' : 'hover:bg-black/[0.02]'}`}>
                        <td className="py-2.5 pr-2">
                          <span className={`flex h-4 w-4 items-center justify-center rounded border ${isSel ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-slate-300'}`}>
                            {isSel && <Check size={11} />}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.name} />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[var(--text-primary)]">{c.name}</p>
                              <p className="text-[11px] text-[var(--text-muted)]">{c.client_ref ?? '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3"><StatusBadge status={status} /></td>
                        <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{latest ? latest.ret.taxYear : '—'}</td>
                        <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{season.taxYear}</td>
                        <td className="py-2.5 pr-3">
                          <p className="text-[var(--text-secondary)]">{fmtDateUK(season.deadline)}</p>
                          <p className={`text-[10.5px] ${season.daysToDeadline < 60 ? 'text-rose-600' : 'text-[var(--text-muted)]'}`}>in {season.daysToDeadline} days</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[11.5px] text-[var(--text-muted)]">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <PageBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></PageBtn>
                <span className="px-2 text-[12px] font-semibold text-[var(--text-secondary)]">{page} / {totalPages}</span>
                <PageBtn disabled={page === totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></PageBtn>
              </div>
            </div>
          </>
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
      <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{entityLabelForBusinessType(client.business_type)} · Self Assessment</p>
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

function PageBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-secondary)] transition-colors hover:bg-black/[0.03] disabled:opacity-40">
      {children}
    </button>
  );
}
