'use client';

/**
 * MtdItSubmitModal — file the quarter's YTD cumulative update to HMRC.
 *
 * Shows the server-computed figures per business source (preview), then submits
 * each self-employment source via the cumulative period-summary API. Property
 * sources are shown but held (field codelist pending verification). Gated on the
 * quarter being client-approved.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Landmark, AlertTriangle, CheckCircle2, Building2, CalendarClock, Download } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { collectFraudData, HMRC_OBLIGATION_SCENARIOS } from '@/lib/hmrc/clientFraudData';

interface PreviewSource {
  typeOfBusiness: 'self-employment' | 'uk-property' | 'foreign-property';
  businessId: string | null;
  name: string;
  periodStartDate: string;
  periodEndDate: string;
  income: number;
  consolidatedExpenses: number;
  expensesByField: Record<string, number>;
  rowCount: number;
  warnings: string[];
}
type SubmitResult =
  | { name: string; typeOfBusiness: string; status: 'submitted'; businessId: string; reference: string | null }
  | { name: string; typeOfBusiness: string; status: 'skipped' | 'error'; reason: string };

interface PastSubmission {
  id: string;
  business_id: string;
  type_of_business: string;
  tax_year: string;
  period_to: string;
  ok: boolean;
  hmrc_status: number | null;
  hmrc_reference: string | null;
  submitted_at: string;
  submitted_by: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  'self-employment': 'Self-employment', 'uk-property': 'UK property', 'foreign-property': 'Foreign property',
};
const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uk = (iso: string) => { const [y, m, d] = iso.split('-'); return d ? `${d}/${m}/${y}` : iso; };

interface ObligationItem { businessId?: string; typeOfBusiness?: string; periodStartDate?: string; periodEndDate?: string; dueDate?: string; status?: string; receivedDate?: string }

export default function MtdItSubmitModal({
  quarterId, clientId, quarterStatus, onClose, onSubmitted,
}: {
  quarterId: string;
  clientId: string;
  quarterStatus: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [preview, setPreview] = useState<PreviewSource[] | null>(null);
  const [error, setError] = useState('');
  const [useConsolidated, setUseConsolidated] = useState(false);
  const [testScenario, setTestScenario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<SubmitResult[] | null>(null);
  const [history, setHistory] = useState<PastSubmission[] | null>(null);
  const [obligations, setObligations] = useState<ObligationItem[] | null>(null);
  const [obligLoading, setObligLoading] = useState(false);
  const [obligErr, setObligErr] = useState('');

  async function checkObligations() {
    setObligLoading(true); setObligErr('');
    try {
      const fraudData = collectFraudData();
      const r = await fetch(`/api/mtd-it/clients/${clientId}/obligations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraudData, testScenario: testScenario || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setObligErr(d.error ?? 'Could not load obligations.'); return; }
      // Defensive flatten — HMRC groups detail rows under each business.
      const raw = (d.obligations ?? []) as Array<Record<string, unknown>>;
      const flat: ObligationItem[] = [];
      for (const g of raw) {
        const details = (g.obligationDetails ?? g.details ?? [g]) as Array<Record<string, unknown>>;
        for (const det of details) {
          flat.push({
            businessId: (g.businessId ?? g.referenceNumber ?? det.businessId) as string | undefined,
            typeOfBusiness: (g.typeOfBusiness ?? det.typeOfBusiness) as string | undefined,
            periodStartDate: (det.periodStartDate ?? det.inboundCorrespondenceFromDate) as string | undefined,
            periodEndDate: (det.periodEndDate ?? det.inboundCorrespondenceToDate) as string | undefined,
            dueDate: (det.dueDate ?? det.inboundCorrespondenceDueDate) as string | undefined,
            status: (det.status) as string | undefined,
            receivedDate: (det.receivedDate ?? det.inboundCorrespondenceDateReceived) as string | undefined,
          });
        }
      }
      setObligations(flat);
    } catch { setObligErr('Could not load obligations.'); }
    finally { setObligLoading(false); }
  }

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`/api/mtd-it/quarters/${quarterId}/submissions`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setHistory((d.submissions ?? []) as PastSubmission[]);
    } catch { /* non-critical */ }
  }, [quarterId]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/mtd-it/quarters/${quarterId}/update-preview`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? 'Could not compute the figures.'); return; }
      setPreview((d.results ?? []) as PreviewSource[]);
    } catch { setError('Could not compute the figures.'); }
  }, [quarterId]);
  useEffect(() => { void load(); void loadHistory(); }, [load, loadHistory]);

  async function submit() {
    setSubmitting(true); setError('');
    try {
      const fraudData = collectFraudData();
      const r = await fetch(`/api/mtd-it/quarters/${quarterId}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraudData, testScenario: testScenario || undefined, useConsolidated }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? 'Submission failed.'); return; }
      setResults(d.results as SubmitResult[]);
      void loadHistory();
      if (d.quarterStatus === 'submitted') onSubmitted();
    } finally { setSubmitting(false); }
  }

  const submittable = (preview ?? []).filter(s => s.typeOfBusiness !== 'foreign-property' && s.businessId);
  const alreadyFiled = quarterStatus === 'submitted';

  // Post-submit result state.
  const done = results !== null;
  const filed = results?.filter(r => r.status === 'submitted') ?? [];
  const errored = results?.filter(r => r.status === 'error') ?? [];
  const skipped = results?.filter(r => r.status === 'skipped') ?? [];
  const outcome: 'success' | 'partial' | 'failed' =
    !done ? 'failed'
    : errored.length === 0 && skipped.length === 0 && filed.length > 0 ? 'success'
    : filed.length > 0 ? 'partial' : 'failed';

  function downloadReceipt() {
    const lines = [
      'MTD IT — submission receipt',
      `Generated: ${new Date().toLocaleString('en-GB')}`,
      '',
      ...(results ?? []).map(r => r.status === 'submitted'
        ? `FILED    ${TYPE_LABEL[r.typeOfBusiness] ?? r.typeOfBusiness} · ${r.name}${r.reference ? ` · HMRC ref ${r.reference}` : ''}`
        : `${r.status.toUpperCase().padEnd(8)} ${TYPE_LABEL[r.typeOfBusiness] ?? r.typeOfBusiness} · ${r.name} · ${r.reason}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mtd-it-submission-receipt.txt'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2"><Landmark size={15} className="text-indigo-600" /> Submit to HMRC — quarterly update</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {alreadyFiled && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 inline-flex items-center gap-2"><CheckCircle2 size={14} /> This quarter has already been filed with HMRC. Re-submitting will amend the cumulative figures.</div>
          )}
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          {!done && (preview === null ? (
            <p className="text-sm text-gray-400 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Computing year-to-date figures…</p>
          ) : preview.length === 0 ? (
            <p className="text-sm text-gray-400">No business sources found for this client.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">Year-to-date cumulative figures, recomputed from the approved entries. Self-employment and UK property are filed now; foreign property is shown for reference (coming soon).</p>
              {preview.map((s, i) => {
                const held = s.typeOfBusiness === 'foreign-property';
                const unmapped = !s.businessId;
                return (
                  <div key={i} className={`rounded-lg border p-3 ${held || unmapped ? 'border-gray-200 bg-gray-50' : 'border-indigo-100 bg-indigo-50/30'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800 inline-flex items-center gap-1.5"><Building2 size={13} className="text-slate-400" /> {s.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">{TYPE_LABEL[s.typeOfBusiness]}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-4 text-xs text-slate-600">
                      <span>Income <strong className="tabular-nums">{gbp(s.income)}</strong></span>
                      <span>Expenses <strong className="tabular-nums">{gbp(s.consolidatedExpenses)}</strong></span>
                      <span className="text-slate-400">{uk(s.periodStartDate)}–{uk(s.periodEndDate)} · {s.rowCount} rows</span>
                    </div>
                    {held && <p className="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1"><AlertTriangle size={10} /> Foreign property filing coming soon.</p>}
                    {unmapped && !held && <p className="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1"><AlertTriangle size={10} /> Not linked to an HMRC business — map it on the HMRC setup screen.</p>}
                    {s.warnings.map((w, j) => <p key={j} className="text-[11px] text-amber-700 mt-1 inline-flex items-start gap-1"><AlertTriangle size={10} className="mt-0.5" /> {w}</p>)}
                  </div>
                );
              })}
            </>
          ))}

          {/* HMRC obligations (deadlines + open/fulfilled) */}
          {!done && (
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">HMRC obligations</p>
              <button onClick={() => void checkObligations()} disabled={obligLoading} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {obligLoading ? <Loader2 size={12} className="animate-spin" /> : <CalendarClock size={12} />} Check obligations
              </button>
            </div>
            {obligErr && <p className="text-[11px] text-rose-700 mt-1.5">{obligErr}</p>}
            {obligations && (obligations.length === 0
              ? <p className="text-[11px] text-slate-400 mt-1.5">No obligations returned by HMRC.</p>
              : (
                <ul className="mt-1.5 space-y-1">
                  {obligations.map((o, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600">
                        {o.typeOfBusiness ? `${TYPE_LABEL[o.typeOfBusiness] ?? o.typeOfBusiness} · ` : ''}
                        {o.periodStartDate ? uk(o.periodStartDate) : '?'}–{o.periodEndDate ? uk(o.periodEndDate) : '?'}
                        {o.dueDate && <span className="text-slate-400"> · due {uk(o.dueDate)}</span>}
                      </span>
                      <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${String(o.status).toLowerCase() === 'fulfilled' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {String(o.status).toLowerCase() === 'fulfilled' ? 'Fulfilled' : 'Open'}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
          )}

          {/* Result panel — shown after submitting. */}
          {done && results && (
            <div className="space-y-3">
              <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
                outcome === 'success' ? 'border-emerald-200 bg-emerald-50' :
                outcome === 'partial' ? 'border-amber-200 bg-amber-50' :
                                        'border-rose-200 bg-rose-50'}`}>
                {outcome === 'success'
                  ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                  : <AlertTriangle size={20} className={`shrink-0 mt-0.5 ${outcome === 'partial' ? 'text-amber-600' : 'text-rose-600'}`} />}
                <div>
                  <p className={`text-sm font-semibold ${outcome === 'success' ? 'text-emerald-800' : outcome === 'partial' ? 'text-amber-800' : 'text-rose-800'}`}>
                    {outcome === 'success' ? 'Submitted to HMRC' : outcome === 'partial' ? 'Partially submitted' : 'Submission failed'}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {outcome === 'success' ? `${filed.length} update${filed.length === 1 ? '' : 's'} filed successfully.`
                      : outcome === 'partial' ? `${filed.length} filed, ${errored.length} failed${skipped.length ? `, ${skipped.length} skipped` : ''}.`
                      : `Nothing was filed${errored.length ? ` — ${errored.length} error${errored.length === 1 ? '' : 's'}` : ''}.`}
                  </p>
                </div>
              </div>

              <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {results.map((r, i) => (
                  <li key={i} className="px-3 py-2.5 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm text-slate-800">{r.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-400 ml-1.5">{TYPE_LABEL[r.typeOfBusiness] ?? r.typeOfBusiness}</span>
                      {r.status === 'submitted' && r.reference && (
                        <div className="text-[11px] text-slate-500 mt-0.5">HMRC ref <span className="font-mono">{r.reference}</span></div>
                      )}
                      {r.status !== 'submitted' && (
                        <div className={`text-[11px] mt-0.5 ${r.status === 'error' ? 'text-rose-700' : 'text-slate-500'}`}>{r.reason}</div>
                      )}
                    </div>
                    {r.status === 'submitted'
                      ? <span className="shrink-0 text-emerald-700 inline-flex items-center gap-1 text-xs"><CheckCircle2 size={13} /> Filed</span>
                      : r.status === 'error'
                        ? <span className="shrink-0 text-rose-700 inline-flex items-center gap-1 text-xs"><AlertTriangle size={13} /> Failed</span>
                        : <span className="shrink-0 text-slate-400 text-xs">Skipped</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Previous submissions (audit trail) — hidden while showing a result. */}
          {!done && history && history.length > 0 && (
            <div className="rounded-lg border border-slate-200">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-3 pt-2.5">Previous submissions</p>
              <ul className="divide-y divide-slate-100 mt-1">
                {history.map(h => (
                  <li key={h.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-slate-700">{TYPE_LABEL[h.type_of_business] ?? h.type_of_business}</span>
                      <span className="text-slate-400"> · to {uk(h.period_to)} · {h.tax_year}</span>
                      {h.hmrc_reference && <span className="text-slate-400"> · ref <span className="font-mono">{h.hmrc_reference}</span></span>}
                      <div className="text-[10px] text-slate-400">{new Date(h.submitted_at).toLocaleString('en-GB')}{h.submitted_by ? ` · ${h.submitted_by}` : ''}</div>
                    </div>
                    {h.ok
                      ? <span className="shrink-0 text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Filed</span>
                      : <span className="shrink-0 text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> {h.hmrc_status ?? 'Error'}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {done ? (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
            {filed.length > 0 && (
              <button onClick={downloadReceipt} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">
                <Download size={13} /> Download receipt
              </button>
            )}
            {outcome !== 'success' && (
              <button onClick={() => { setResults(null); setError(''); }} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">Try again</button>
            )}
            <button onClick={onClose} className="btn-primary text-sm">Done</button>
          </div>
        ) : (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-600 inline-flex items-center gap-1.5">
                <input type="checkbox" checked={useConsolidated} onChange={e => setUseConsolidated(e.target.checked)} className="rounded border-gray-300" />
                Consolidated expenses
              </label>
              <Tooltip label="Sandbox only — controls HMRC's test data. Ignored in production.">
                <select value={testScenario} onChange={e => setTestScenario(e.target.value)} className="text-xs px-2 py-1 border border-gray-200 rounded bg-white">
                  {HMRC_OBLIGATION_SCENARIOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">Close</button>
              <button onClick={() => void submit()} disabled={submitting || submittable.length === 0} className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />} Submit {submittable.length ? `(${submittable.length})` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
