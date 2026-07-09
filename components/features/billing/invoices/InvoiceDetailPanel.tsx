'use client';

import { useEffect, useState } from 'react';
import { X, Send, CheckCircle2, Banknote, Trash2, Clock, Eye, FileText, Download, CreditCard } from 'lucide-react';
import { fmtPence } from '@/lib/billing/totals';
import type { Invoice } from '@/lib/billing/types';
import { exportInvoicePdf, type InvoiceLetterhead } from '@/lib/billing/invoicePdf';
import { STATUS_META } from '../shared/status';
import { fmtDate } from './InvoicesTab';

const EMPTY_LETTERHEAD: InvoiceLetterhead = { businessName: '', businessAddress: '', vatNumber: '', bankDetails: '', invoiceFooter: '' };

interface Props {
  invoiceId: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function InvoiceDetailPanel({ invoiceId, onClose, onChanged }: Props) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [letterhead, setLetterhead] = useState<InvoiceLetterhead>(EMPTY_LETTERHEAD);
  const [stripeOk, setStripeOk] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/billing/invoices/${invoiceId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setInv(d?.invoice ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }
  useEffect(load, [invoiceId]);

  // Firm letterhead / bank details for the PDF (fetched once).
  useEffect(() => {
    fetch('/api/billing/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (!s) return;
        setLetterhead({
          businessName: s.businessName ?? '',
          businessAddress: s.businessAddress ?? '',
          vatNumber: s.vatNumber ?? '',
          bankDetails: s.bankDetails ?? '',
          invoiceFooter: s.invoiceFooter ?? '',
        });
      })
      .catch(() => {});
  }, []);

  // Is Stripe connected? Controls the "Pay by card" affordance.
  useEffect(() => {
    fetch('/api/billing/stripe/status').then(r => (r.ok ? r.json() : null)).then(d => setStripeOk(!!d?.configured)).catch(() => {});
  }, []);

  async function payByCard() {
    setPayMsg('Creating link…');
    const r = await fetch('/api/billing/stripe/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.url) {
      try { await navigator.clipboard.writeText(d.url); } catch { /* clipboard may be blocked */ }
      window.open(d.url, '_blank');
      setPayMsg('Payment link opened & copied');
    } else setPayMsg(d?.error ?? 'Could not create link');
    setTimeout(() => setPayMsg(null), 3000);
  }

  async function patchStatus(status: string) {
    setBusy(true);
    const r = await fetch(`/api/billing/invoices/${invoiceId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (r.ok) { load(); onChanged(); }
  }

  async function recordPayment() {
    if (!inv) return;
    const pounds = parseFloat(payAmount);
    if (!Number.isFinite(pounds) || pounds <= 0) return;
    setBusy(true);
    const r = await fetch('/api/billing/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId,
        amountPence: Math.round(pounds * 100),
        receivedDate: new Date().toISOString().slice(0, 10),
        method: 'manual',
      }),
    });
    setBusy(false);
    if (r.ok) { setPayOpen(false); setPayAmount(''); load(); onChanged(); }
  }

  async function remove() {
    if (!confirm('Delete this invoice? This cannot be undone.')) return;
    setBusy(true);
    const r = await fetch(`/api/billing/invoices/${invoiceId}`, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) { onChanged(); onClose(); }
  }

  const m = inv ? STATUS_META[inv.status] : null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[61] flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={18} className="text-[var(--accent)] shrink-0" />
            <h3 className="truncate text-[15px] font-bold text-[var(--text-primary)]">
              {inv?.number ?? 'Draft invoice'}
            </h3>
            {m && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.chip}`}>{m.label}</span>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        {loading || !inv ? (
          <div className="flex-1 space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-black/[0.05]" />)}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
            {/* Client + amount hero */}
            <div className="mb-4 rounded-2xl bg-[var(--accent)]/[0.05] p-4">
              <p className="text-[12px] text-[var(--text-muted)]">{inv.clientName ?? 'No client'}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">{fmtPence(inv.totalPence)}</p>
              {inv.balancePence > 0 && inv.balancePence < inv.totalPence && (
                <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Balance {fmtPence(inv.balancePence)}</p>
              )}
            </div>

            {/* Meta */}
            <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
              <Meta label="Issue date" value={fmtDate(inv.issueDate)} />
              <Meta label="Due date" value={fmtDate(inv.dueDate)} />
              <Meta label="Paid" value={fmtPence(inv.amountPaidPence)} />
              <Meta label="Balance" value={fmtPence(inv.balancePence)} />
            </dl>

            {/* Timeline */}
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Timeline</p>
              <div className="space-y-1.5">
                <TimelineRow icon={FileText} label="Created" done at={fmtDate(inv.createdAt)} />
                <TimelineRow icon={Send} label="Sent" done={inv.status !== 'draft'} />
                <TimelineRow icon={Eye} label="Viewed" done={inv.status === 'viewed' || inv.status === 'part_paid' || inv.status === 'paid'} />
                <TimelineRow icon={Banknote} label="Paid" done={inv.status === 'paid'} />
              </div>
            </div>

            {/* Lines */}
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Lines</p>
              <div className="rounded-xl border border-black/5">
                {(inv.lines ?? []).map((l, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-black/[0.04] px-3 py-2 text-[13px] last:border-0">
                    <span className="min-w-0 truncate text-[var(--text-secondary)]">{l.description || 'Item'} <span className="text-[var(--text-muted)]">× {l.quantity}</span></span>
                    <span className="shrink-0 tabular-nums text-[var(--text-primary)]">{fmtPence(l.grossPence)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-[12px] text-[var(--text-muted)]">
                  <span>VAT</span><span className="tabular-nums">{fmtPence(inv.vatPence)}</span>
                </div>
              </div>
            </div>

            {/* Record payment */}
            {payOpen && (
              <div className="mb-4 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] p-3">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">Amount received (£)</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="number" step="0.01" autoFocus value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder={(inv.balancePence / 100).toFixed(2)}
                    className="h-9 flex-1 rounded-lg border border-black/10 px-3 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button onClick={recordPayment} disabled={busy} className="btn-primary disabled:opacity-50">Save</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {inv && (
          <div className="flex flex-wrap items-center gap-2 border-t border-black/5 px-5 py-3">
            {payMsg && <span className="w-full text-[12px] font-medium text-[var(--accent)]">{payMsg}</span>}
            <button onClick={() => exportInvoicePdf(inv, letterhead)} className="btn-secondary"><Download size={14} /> PDF</button>
            {stripeOk && inv.balancePence > 0 && inv.status !== 'draft' && inv.status !== 'cancelled' && (
              <button onClick={payByCard} className="btn-secondary"><CreditCard size={14} /> Pay by card</button>
            )}
            {inv.status === 'draft' && (
              <button onClick={() => patchStatus('sent')} disabled={busy} className="btn-primary disabled:opacity-50"><Send size={14} /> Mark as sent</button>
            )}
            {inv.balancePence > 0 && inv.status !== 'draft' && inv.status !== 'cancelled' && (
              <button onClick={() => setPayOpen(o => !o)} disabled={busy} className="btn-secondary"><Banknote size={14} /> Record payment</button>
            )}
            {inv.balancePence > 0 && inv.status !== 'draft' && inv.status !== 'paid' && inv.status !== 'cancelled' && (
              <button onClick={() => patchStatus('paid')} disabled={busy} className="btn-secondary"><CheckCircle2 size={14} /> Mark paid</button>
            )}
            {(inv.status === 'draft' || inv.status === 'cancelled') && inv.amountPaidPence === 0 && (
              <button onClick={remove} disabled={busy} className="btn-secondary ml-auto text-[var(--danger)]"><Trash2 size={14} /> Delete</button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function TimelineRow({ icon: Icon, label, done, at }: { icon: typeof Clock; label: string; done: boolean; at?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <div className={`flex h-6 w-6 items-center justify-center rounded-full ${done ? 'bg-emerald-100 text-emerald-600' : 'bg-black/[0.05] text-[var(--text-muted)]'}`}>
        <Icon size={13} />
      </div>
      <span className={done ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
      {at && <span className="ml-auto text-[11px] text-[var(--text-muted)]">{at}</span>}
    </div>
  );
}
