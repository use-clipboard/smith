'use client';

import { useState } from 'react';
import { Users, Link2, RefreshCw, Check, FileText } from 'lucide-react';
import SendStatementModal from '../statements/SendStatementModal';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { GlassCard, SectionHeader, KpiCard } from '@/components/features/timesheets/shared/ui';
import { fmtPence } from '@/lib/billing/totals';
import type { Invoice, RecurringInvoice } from '@/lib/billing/types';
import { STATUS_META, FREQ_LABEL } from '../shared/status';
import { fmtDate } from '../invoices/InvoicesTab';

interface Summary {
  clientName: string; outstandingPence: number; billedPence: number; paidPence: number;
  portalToken: string | null;
  invoices: Invoice[];
  payments: { id: string; method: string; amountPence: number; receivedDate: string; reference: string | null }[];
  recurring: RecurringInvoice[];
}

export default function ClientsBillingTab() {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);

  function pick(id: string, name: string) {
    setClientId(id); setClientName(name); setSummary(null);
    if (!id) return;
    setLoading(true);
    fetch(`/api/billing/client-summary?clientId=${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  async function sharePortal() {
    if (!clientId) return;
    setLinkMsg('Creating link…');
    const r = await fetch('/api/billing/portal-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.url) { try { await navigator.clipboard.writeText(d.url); } catch { /* clipboard blocked */ } setLinkMsg('Portal link copied to clipboard'); }
    else setLinkMsg(d?.error ?? 'Could not create link');
    setTimeout(() => setLinkMsg(null), 3200);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-sm">
          <ClientSearchInput value={clientId} valueName={clientName} onChange={(id, name) => pick(id, name)} placeholder="Search a client to see their billing…" />
        </div>
        {summary && (
          <div className="flex items-center gap-3">
            {linkMsg && <span className="flex items-center gap-1 text-[12px] font-medium text-[var(--accent)]"><Check size={13} /> {linkMsg}</span>}
            <button onClick={() => setStatementOpen(true)} className="btn-secondary"><FileText size={14} /> Send statement</button>
            <button onClick={sharePortal} className="btn-secondary"><Link2 size={14} /> Share portal link</button>
          </div>
        )}
      </div>

      {!clientId ? (
        <GlassCard className="mx-auto max-w-lg text-center">
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]"><Users size={26} /></div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">Per-client billing</h3>
            <p className="max-w-sm text-sm text-[var(--text-muted)]">Pick a client to see their outstanding balance, invoices, payments and recurring schedules — and share a secure statement portal link.</p>
          </div>
        </GlassCard>
      ) : loading || !summary ? (
        <div className="grid grid-cols-3 gap-4">{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-[20px] bg-white/50" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Outstanding" value={fmtPence(summary.outstandingPence)} icon={Users} tint="#F59E0B" />
            <KpiCard label="Billed (all time)" value={fmtPence(summary.billedPence)} icon={Users} tint="#7C3AED" />
            <KpiCard label="Paid" value={fmtPence(summary.paidPence)} icon={Users} tint="#10B981" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <GlassCard className="lg:col-span-2" padded={false}>
              <div className="px-5 pt-4"><SectionHeader title="Invoices" /></div>
              <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-white/90 backdrop-blur"><tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-5 py-2 font-semibold">Invoice</th><th className="px-4 py-2 font-semibold">Issued</th><th className="px-4 py-2 text-right font-semibold">Total</th><th className="px-4 py-2 text-right font-semibold">Balance</th><th className="px-4 py-2 font-semibold">Status</th>
                  </tr></thead>
                  <tbody>
                    {summary.invoices.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">No invoices.</td></tr> :
                      summary.invoices.map(inv => { const m = STATUS_META[inv.status]; return (
                        <tr key={inv.id} className="border-b border-black/[0.03]">
                          <td className="px-5 py-2 font-semibold text-[var(--text-primary)]">{inv.number ?? 'Draft'}</td>
                          <td className="px-4 py-2 text-[var(--text-muted)]">{fmtDate(inv.issueDate)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmtPence(inv.totalPence)}</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtPence(inv.balancePence)}</td>
                          <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.chip}`}>{m.label}</span></td>
                        </tr>); })}
                  </tbody>
                </table>
              </div>
            </GlassCard>

            <div className="space-y-4">
              <GlassCard>
                <SectionHeader title="Recurring" />
                {summary.recurring.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No schedules.</p> : (
                  <div className="space-y-2">
                    {summary.recurring.map(r => (
                      <div key={r.id} className="flex items-center justify-between text-[13px]">
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><RefreshCw size={12} className="text-[var(--accent)]" /> {FREQ_LABEL[r.frequency] ?? r.frequency}</span>
                        <span className="font-semibold tabular-nums">{fmtPence(r.totalPence)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
              <GlassCard>
                <SectionHeader title="Recent payments" />
                {summary.payments.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No payments.</p> : (
                  <div className="space-y-2">
                    {summary.payments.slice(0, 8).map(p => (
                      <div key={p.id} className="flex items-center justify-between text-[13px]">
                        <span className="text-[var(--text-muted)]">{fmtDate(p.receivedDate)}</span>
                        <span className="font-semibold tabular-nums text-emerald-600">{fmtPence(p.amountPence)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            </div>
          </div>
        </>
      )}

      {statementOpen && clientId && (
        <SendStatementModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setStatementOpen(false)}
          onSent={to => {
            setStatementOpen(false);
            setLinkMsg(`Statement sent to ${to}`);
            setTimeout(() => setLinkMsg(null), 3600);
          }}
        />
      )}
    </div>
  );
}
