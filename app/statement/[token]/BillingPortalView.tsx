'use client';

import { useEffect, useState } from 'react';
import { fmtPence } from '@/lib/billing/totals';
import { exportInvoicePdf, type InvoiceLetterhead } from '@/lib/billing/invoicePdf';
import type { Invoice } from '@/lib/billing/types';

interface PortalData {
  firmName: string; businessAddress: string; vatNumber: string; bankDetails: string; invoiceFooter: string;
  accent?: string; template?: 'modern' | 'classic' | 'minimal'; defaultTerms?: string; logoDataUrl?: string | null;
  clientName: string; outstandingPence: number; stripeConfigured: boolean; invoices: Invoice[];
}

const OUTSTANDING = ['sent', 'viewed', 'part_paid', 'overdue'];
function fmtDate(iso: string | null) { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}-${m}-${y}`; }

export default function BillingPortalView({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/billing/portal/${token}`)
      .then(async r => { if (r.ok) return r.json(); const d = await r.json().catch(() => null); throw new Error(d?.error ?? 'Not found'); })
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  function letterhead(d: PortalData): InvoiceLetterhead {
    return {
      businessName: d.firmName, businessAddress: d.businessAddress, vatNumber: d.vatNumber,
      bankDetails: d.bankDetails, invoiceFooter: d.invoiceFooter,
      accent: d.accent, template: d.template, defaultTerms: d.defaultTerms, logoDataUrl: d.logoDataUrl,
    };
  }

  async function pay(invoiceId: string) {
    setBusy(invoiceId);
    const r = await fetch(`/api/billing/portal/${token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId }) });
    const d = await r.json().catch(() => null);
    setBusy(null);
    if (r.ok && d?.url) window.location.href = d.url;
    else alert(d?.error ?? 'Could not start payment.');
  }

  if (error) return <Shell><div className="py-16 text-center text-slate-500">{error}</div></Shell>;
  if (!data) return <Shell><div className="py-16 text-center text-slate-400">Loading your statement…</div></Shell>;

  return (
    <Shell>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{data.firmName}</h1>
          <p className="mt-0.5 text-sm text-slate-500">Statement for {data.clientName}</p>
        </div>
        <div className="rounded-2xl bg-indigo-50 px-4 py-3 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Outstanding</p>
          <p className="text-2xl font-bold tabular-nums text-indigo-700">{fmtPence(data.outstandingPence)}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr><th className="px-4 py-2.5 font-semibold">Invoice</th><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 text-right font-semibold">Total</th><th className="px-4 py-2.5 text-right font-semibold">Balance</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody>
            {data.invoices.map(inv => {
              const isOut = OUTSTANDING.includes(inv.status) && inv.balancePence > 0;
              return (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{inv.number ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(inv.issueDate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtPence(inv.totalPence)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{isOut ? fmtPence(inv.balancePence) : <span className="text-emerald-600">Paid</span>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => exportInvoicePdf(inv, letterhead(data))} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">PDF</button>
                      {isOut && data.stripeConfigured && (
                        <button onClick={() => pay(inv.id)} disabled={busy === inv.id} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy === inv.id ? '…' : 'Pay'}</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.invoices.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No invoices to show.</td></tr>}
          </tbody>
        </table>
      </div>

      {data.bankDetails && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Payment details</p>
          <p className="mt-1 whitespace-pre-line text-[13px] text-slate-600">{data.bankDetails}</p>
        </div>
      )}
      {data.invoiceFooter && <p className="mt-4 text-center text-[12px] text-slate-400">{data.invoiceFooter}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-sm sm:p-8">{children}</div>
      <p className="mt-4 text-center text-[11px] text-slate-400">Powered by SMITH</p>
    </div>
  );
}
