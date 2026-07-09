'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, Plus, X, ExternalLink, ShieldAlert } from 'lucide-react';
import { GlassCard, KpiCard } from '@/components/features/timesheets/shared/ui';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import { fmtDate } from '../invoices/InvoicesTab';

interface Mandate {
  id: string; clientId: string | null; clientName: string; status: string;
  bankLast4: string | null; createdAt: string; activatedAt: string | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-50 text-amber-600' },
  active:    { label: 'Active',    cls: 'bg-emerald-50 text-emerald-600' },
  failed:    { label: 'Failed',    cls: 'bg-rose-50 text-rose-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' },
};

export default function DirectDebitsTab() {
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [stripeOk, setStripeOk] = useState(true);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/billing/direct-debits')
      .then(r => (r.ok ? r.json() : { mandates: [], stripeConfigured: false }))
      .then(d => { setMandates(d.mandates ?? []); setStripeOk(!!d.stripeConfigured); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 3000); }

  const active = mandates.filter(m => m.status === 'active').length;
  const pending = mandates.filter(m => m.status === 'pending').length;

  return (
    <div className="space-y-4">
      {!stripeOk && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-[14px] font-bold text-[var(--text-primary)]">Stripe isn&apos;t connected</p>
            <p className="text-[12px] text-[var(--text-muted)]">Direct Debit runs on Stripe Bacs. Add <code className="rounded bg-black/5 px-1">STRIPE_SECRET_KEY</code> and <code className="rounded bg-black/5 px-1">STRIPE_WEBHOOK_SECRET</code> to enable mandates and collection.</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 gap-4 sm:w-auto">
          <KpiCard label="Active mandates" value={`${active}`} icon={Landmark} tint="#10B981" />
          <KpiCard label="Pending" value={`${pending}`} icon={Landmark} tint="#F59E0B" />
        </div>
        <button onClick={() => setRequesting(true)} disabled={!stripeOk} className="btn-primary disabled:opacity-50"><Plus size={15} /> Request mandate</button>
      </div>

      {toast && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">{toast}</div>}

      <GlassCard padded={false} className="overflow-hidden">
        <div className="max-h-[calc(100vh-380px)] overflow-y-auto scrollbar-thin">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Bank</th>
                <th className="px-4 py-2.5 font-semibold">Requested</th>
                <th className="px-4 py-2.5 font-semibold">Activated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }, (_, i) => <tr key={i} className="border-b border-black/[0.03]"><td colSpan={5} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-black/[0.05]" /></td></tr>)
              ) : mandates.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16 text-center">
                  <Landmark size={30} className="mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
                  <p className="text-sm text-[var(--text-muted)]">No Direct Debit mandates yet.</p>
                  <p className="mx-auto mt-1 max-w-sm text-[12px] text-[var(--text-muted)]">Request a mandate to let a client authorise automatic Bacs collection.</p>
                </td></tr>
              ) : (
                mandates.map(m => {
                  const s = STATUS_META[m.status] ?? STATUS_META.pending;
                  return (
                    <tr key={m.id} className="border-b border-black/[0.03] hover:bg-[var(--accent)]/[0.03]">
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{m.clientName}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{m.bankLast4 ? `•••• ${m.bankLast4}` : '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{fmtDate(m.createdAt.slice(0, 10))}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{m.activatedAt ? fmtDate(m.activatedAt.slice(0, 10)) : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {requesting && <RequestMandateModal onClose={() => setRequesting(false)} onDone={msg => { setRequesting(false); load(); flash(msg); }} />}
    </div>
  );
}

function RequestMandateModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    if (!clientId) { setError('Pick a client first.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/billing/stripe/mandate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
    });
    setBusy(false);
    const d = await r.json().catch(() => null);
    if (r.ok && d?.url) { window.open(d.url, '_blank'); onDone('Mandate link opened — send it to your client'); }
    else setError(d?.error ?? 'Could not start the mandate.');
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[61] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-[var(--text-primary)]">Request Direct Debit mandate</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>
        <p className="mb-3 text-[13px] text-[var(--text-muted)]">Choose a client. SMITH opens a secure Stripe page for them to authorise Bacs Direct Debit; once confirmed the mandate activates automatically.</p>
        <ClientSearchInput value={clientId} valueName={clientName} onChange={(id, name) => { setClientId(id); setClientName(name); }} placeholder="Search clients…" />
        {error && <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={request} disabled={busy} className="btn-primary disabled:opacity-50"><ExternalLink size={14} /> {busy ? 'Starting…' : 'Open mandate page'}</button>
        </div>
      </div>
    </>
  );
}
