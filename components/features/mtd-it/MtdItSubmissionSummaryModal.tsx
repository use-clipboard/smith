'use client';

/**
 * MtdItSubmissionSummaryModal — read-only summary of a quarter already filed
 * with HMRC. Shows each filed source + figures, the HMRC reference, the client
 * approval status, and when/by whom it was filed. Offers a downloadable text
 * receipt and a PDF confirmation, plus an option to reopen the quarter.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, Download, Landmark, FileText, FolderOpen } from 'lucide-react';
import { buildPnL } from '@/lib/mtdIt/pnl';
import { renderApprovalPdf } from '@/lib/mtdIt/approvalPdf';

interface Submission {
  id: string;
  business_id: string;
  type_of_business: string;
  tax_year: string;
  period_to: string;
  income: number;
  expenses: number;
  ok: boolean;
  hmrc_status: number | null;
  hmrc_reference: string | null;
  submitted_at: string;
  submitted_by: string | null;
}
interface Approval {
  sent_at: string | null;
  approved_at: string | null;
  changes_requested_at: string | null;
  recipient_email: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  'self-employment': 'Self-employment', 'uk-property': 'UK property', 'foreign-property': 'Foreign property',
};
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uk = (iso: string) => { const [y, m, d] = (iso ?? '').slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : iso; };
const dt = (iso: string) => new Date(iso).toLocaleString('en-GB');

export default function MtdItSubmissionSummaryModal({
  quarterId, quarter, clientName, quarterLabel, taxYearLabel, onClose, onReopen,
}: {
  quarterId: string;
  quarter: 1 | 2 | 3 | 4;
  clientName: string;
  quarterLabel: string;
  taxYearLabel: string;
  onClose: () => void;
  onReopen: (quarter: 1 | 2 | 3 | 4) => void;
}) {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sr, ar] = await Promise.all([
        fetch(`/api/mtd-it/quarters/${quarterId}/submissions`),
        fetch(`/api/mtd-it/quarters/${quarterId}/approvals/latest`),
      ]);
      const sd = await sr.json().catch(() => ({}));
      if (!sr.ok) { setError(sd.error ?? 'Could not load the submission.'); return; }
      setSubs((sd.submissions ?? []) as Submission[]);
      if (ar.ok) { const ad = await ar.json().catch(() => ({})); setApproval(ad.approval ?? null); }
    } catch { setError('Could not load the submission.'); }
  }, [quarterId]);
  useEffect(() => { void load(); }, [load]);

  // Latest filing per business (list is newest-first).
  const latest = (() => {
    if (!subs) return [];
    const seen = new Set<string>();
    return subs.filter(s => { if (seen.has(s.business_id)) return false; seen.add(s.business_id); return true; });
  })();

  const approvalLine =
    approval?.approved_at ? `Client approved on ${dt(approval.approved_at)}`
    : approval?.changes_requested_at ? `Client requested changes on ${dt(approval.changes_requested_at)}`
    : approval?.sent_at ? `Sent to client on ${dt(approval.sent_at)} — not yet approved`
    : 'Not sent to client for approval';

  function downloadReceipt() {
    const lines = [
      'MTD IT — submission receipt',
      `Client: ${clientName}`,
      `Period: ${quarterLabel} ${taxYearLabel}`,
      `Approval: ${approvalLine}`,
      `Generated: ${dt(new Date().toISOString())}`,
      '',
      ...latest.map(s =>
        `${s.ok ? 'FILED' : 'FAILED'}  ${TYPE_LABEL[s.type_of_business] ?? s.type_of_business}` +
        ` · income ${gbp(s.income)} · expenses ${gbp(s.expenses)} · to ${uk(s.period_to)}` +
        `${s.hmrc_reference ? ` · HMRC ref ${s.hmrc_reference}` : ''}` +
        ` · ${dt(s.submitted_at)}${s.submitted_by ? ` · ${s.submitted_by}` : ''}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mtd-it-receipt-${clientName.replace(/\s+/g, '-')}-${quarterLabel}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  // Re-generate the client approval P&L report (the same PDF sent for approval).
  async function downloadPdf() {
    setPdfBusy(true); setError('');
    try {
      const r = await fetch(`/api/mtd-it/quarters/${quarterId}/report-data`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? 'Could not load the report data.'); return; }
      const streamKeys = (['sole', 'uk_rental', 'foreign_rental'] as const).filter(s => d.streams?.[s]);
      const pnls = streamKeys.map(stream =>
        buildPnL({ stream, entries: d.entries, trades: d.trades, properties: d.properties, fxRates: d.fxRates }));
      const blob = await renderApprovalPdf({
        pnls,
        clientName: d.clientName, clientRef: d.clientRef,
        quarterLabel, taxYearLabel, rangeFrom: d.rangeFrom, rangeTo: d.rangeTo,
        consolidated: d.consolidated, entries: d.entries,
        brandPrimaryColor: d.brandPrimaryColor,
        pdfInclude: { kpiCards: true, chart: false, categoryTables: true, transactionDetail: true, quarterlyComparison: false },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `mtd-it-report-${clientName.replace(/\s+/g, '-')}-${quarterLabel}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Could not generate the report.'); }
    finally { setPdfBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
            <Landmark size={15} className="text-emerald-600" /> Filed with HMRC — {clientName} · {quarterLabel} {taxYearLabel}
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          {/* Approval confirmation */}
          <div className={`rounded-lg border px-3 py-2 text-xs inline-flex items-center gap-2 ${approval?.approved_at ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {approval?.approved_at ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {approvalLine}
          </div>

          {subs === null ? (
            <p className="text-sm text-gray-400 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          ) : latest.length === 0 ? (
            <p className="text-sm text-gray-400">No submission record found for this quarter.</p>
          ) : (
            <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {latest.map(s => (
                <li key={s.id} className="px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{TYPE_LABEL[s.type_of_business] ?? s.type_of_business}</span>
                    {s.ok
                      ? <span className="text-emerald-700 inline-flex items-center gap-1 text-xs"><CheckCircle2 size={13} /> Filed</span>
                      : <span className="text-rose-700 inline-flex items-center gap-1 text-xs"><AlertTriangle size={13} /> Failed ({s.hmrc_status})</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-600">
                    <span>Income <strong className="tabular-nums">{gbp(s.income)}</strong></span>
                    <span>Expenses <strong className="tabular-nums">{gbp(s.expenses)}</strong></span>
                    <span className="text-slate-400">to {uk(s.period_to)}</span>
                  </div>
                  {s.hmrc_reference && <div className="text-[11px] text-slate-500 mt-1">HMRC reference <span className="font-mono">{s.hmrc_reference}</span></div>}
                  <div className="text-[10px] text-slate-400 mt-0.5">{dt(s.submitted_at)}{s.submitted_by ? ` · ${s.submitted_by}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-2">
          <button onClick={() => onReopen(quarter)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">
            <FolderOpen size={13} /> Reopen &amp; Edit Quarter
          </button>
          <div className="flex items-center gap-2">
            {latest.length > 0 && (
              <>
                <button onClick={downloadReceipt} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">
                  <Download size={13} /> Receipt
                </button>
                <button onClick={() => void downloadPdf()} disabled={pdfBusy} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-50">
                  {pdfBusy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Download report
                </button>
              </>
            )}
            <button onClick={onClose} className="btn-primary text-sm">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
