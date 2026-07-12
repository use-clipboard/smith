'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search, Plus, FileText, Upload } from 'lucide-react';
import { GlassCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence } from '@/lib/billing/totals';
import type { Invoice, InvoiceStatus } from '@/lib/billing/types';
import { STATUS_META, STATUS_FILTERS } from '../shared/status';
import InvoiceDetailPanel from './InvoiceDetailPanel';
import ImportInvoicesModal from '../import/ImportInvoicesModal';

/** dd-mm-yyyy for display (UK). */
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

interface Props {
  onNewInvoice: () => void;
}

export default function InvoicesTab({ onNewInvoice }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (search.trim()) params.set('search', search.trim());
    fetch(`/api/billing/invoices?${params}`)
      .then(r => (r.ok ? r.json() : { invoices: [] }))
      .then(d => { setInvoices(d.invoices ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filter, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div className="space-y-3">
      {/* Filter pills + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
          {STATUS_FILTERS.map(s => (
            <FilterPill key={s} active={filter === s} onClick={() => setFilter(s)} label={STATUS_META[s].label} dot={STATUS_META[s].dot} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice or client…"
              className="h-9 w-64 rounded-lg border border-black/10 bg-white/70 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </div>
          <button onClick={() => setImportOpen(true)} className="btn-secondary"><Upload size={14} /> Import</button>
        </div>
      </div>

      <GlassCard padded={false} className="overflow-hidden">
        <div className="max-h-[calc(100vh-320px)] overflow-y-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-semibold">Invoice</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Issue</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-b border-black/[0.03]">
                    <td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-black/[0.05]" /></td>
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <FileText size={30} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
                    <p className="text-sm text-[var(--text-muted)]">No invoices{filter !== 'all' ? ` with status “${STATUS_META[filter as InvoiceStatus].label}”` : ''}.</p>
                    <button onClick={onNewInvoice} className="btn-primary mt-3 mx-auto"><Plus size={15} /> New invoice</button>
                  </td>
                </tr>
              ) : (
                invoices.map(inv => {
                  const m = STATUS_META[inv.status];
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedId(inv.id)}
                      className="cursor-pointer border-b border-black/[0.03] transition hover:bg-[var(--accent)]/[0.04]"
                    >
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{inv.number ?? <span className="text-[var(--text-muted)] font-normal italic">Draft</span>}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{inv.clientName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{fmtDate(inv.issueDate)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{fmtDate(inv.dueDate)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--text-primary)]">{fmtPence(inv.totalPence)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[var(--text-primary)]">{fmtPence(inv.balancePence)}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.chip}`}>{m.label}</span></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {selectedId && (
        <InvoiceDetailPanel
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { load(); }}
        />
      )}

      {importOpen && (
        <ImportInvoicesModal onClose={() => setImportOpen(false)} onImported={() => load()} />
      )}
    </div>
  );
}

function FilterPill({ active, onClick, label, dot }: { active: boolean; onClick: () => void; label: string; dot?: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${active ? 'bg-[var(--accent)] text-white' : 'bg-black/[0.04] text-[var(--text-muted)] hover:bg-black/[0.07]'}`}
    >
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: active ? '#fff' : dot }} />}
      {label}
    </button>
  );
}
