'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Landmark, ShieldCheck, FileCheck2, AlertTriangle, Loader2, Send } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeCt600 } from '../calc';
import { fmtMoney, fmtDateUK } from '../data';
import { fetchJson } from '@/lib/fetchJson';
import type { TaxReturn } from '../types';

export default function StageSubmitCt600({
  ret, patch,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
}): JSX.Element {
  const c = computeCt600(ret.ct600, ret.taxYear, { periodStart: ret.periodStart, periodEnd: ret.periodEnd });
  const approved = ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';
  const submitted = ret.approvalStatus === 'submitted';

  const checks: { ok: boolean; label: string; detail?: string }[] = [
    { ok: !!ret.periodStart && !!ret.periodEnd, label: 'Accounting period set', detail: `${fmtDateUK(ret.periodStart ?? '')} – ${fmtDateUK(ret.periodEnd ?? '')}` },
    { ok: !!ret.companyRegNumber, label: 'Company registration number entered', detail: ret.companyRegNumber ?? undefined },
    { ok: !!ret.utr, label: 'CT UTR entered', detail: ret.utr ?? undefined },
    { ok: c.turnover > 0 || c.totalProfits > 0 || c.corporationTax > 0, label: 'Return figures entered', detail: fmtMoney(c.corporationTax) },
    { ok: approved, label: 'Client approval recorded' },
  ];
  // Every readiness check must pass before the return can be recorded as filed —
  // a blank return (no period, UTR or figures) must not reach a "filed" state.
  const ready = checks.every(chk => chk.ok);

  // HMRC online-filing state.
  const [credsReady, setCredsReady] = useState<boolean | null>(null);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ irmark: string; message: string } | null>(null);
  const [isTest, setIsTest] = useState(true);

  useEffect(() => {
    let live = true;
    fetchJson<{ ready: boolean }>('/api/firms/ct-filing', { cache: 'no-store' })
      .then(s => { if (live) setCredsReady(!!s.ready); })
      .catch(() => { if (live) setCredsReady(false); });
    return () => { live = false; };
  }, []);

  async function fileToHmrc() {
    setFiling(true); setError(''); setPending(null);
    try {
      const res = await fetch(`/api/tax-studio/returns/${ret.id}/ct-submit`, { method: 'POST' });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (typeof json.isTest === 'boolean') setIsTest(json.isTest);
      if (!res.ok) throw new Error((json.error as string) || 'HMRC rejected the return.');
      if (json.accepted) {
        patch(r => ({
          ...r,
          approvalStatus: 'submitted', submittedAt: json.submittedAt as string, submissionRef: json.irmark as string,
          timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: json.submittedAt as string, kind: 'filed', label: `Filed CT600 to HMRC${json.isTest ? ' (test)' : ''} — IRmark ${json.irmark}` }],
        }));
      } else if (json.pending) {
        setPending({ irmark: json.irmark as string, message: (json.message as string) || 'Submitted — HMRC is still processing.' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Filing failed.');
    } finally {
      setFiling(false);
    }
  }

  const canFile = ready && credsReady === true && !filing && !submitted;

  function markFiled() {
    patch(r => ({
      ...r,
      approvalStatus: 'submitted',
      submittedAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'filed', label: 'CT600 marked as filed with HMRC' }],
    }));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Readiness --------------------------------------------------------------- */}
      <StudioCard className="p-5">
        <div className="mb-3 flex items-center gap-1.5">
          <ShieldCheck size={15} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Readiness</h3>
        </div>
        <div className="space-y-2">
          {checks.map(chk => (
            <div key={chk.label} className="flex items-center gap-2.5 text-[12.5px]">
              {chk.ok ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> : <XCircle size={15} className="shrink-0 text-rose-400" />}
              <span className={chk.ok ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{chk.label}</span>
              {chk.detail && <span className="ml-auto text-[11.5px] font-semibold text-[var(--text-secondary)]">{chk.detail}</span>}
            </div>
          ))}
        </div>
      </StudioCard>

      {/* Online filing ----------------------------------------------------------- */}
      <StudioCard className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Landmark size={18} /></div>
          <div className="flex-1">
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">File CT600 online with HMRC</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Submit the CT600 — with the computation and accounts iXBRL — to HMRC&apos;s Corporation Tax Online service.</p>
          </div>
          {isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Test</span>}
        </div>
        <div className="px-5 py-4">
          {submitted ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <FileCheck2 size={18} className="shrink-0 text-emerald-600" />
              <div>
                <p className="text-[13px] font-bold text-emerald-800">Filed</p>
                <p className="text-[11.5px] text-emerald-700">{ret.submissionRef ? `IRmark ${ret.submissionRef}` : ret.submittedAt ? `Recorded ${fmtDateUK(ret.submittedAt)}` : 'Filed with HMRC'}</p>
              </div>
            </div>
          ) : (
            <>
              {credsReady === false && (
                <p className="mb-3 flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
                  <AlertTriangle size={13} /> HMRC CT filing isn&apos;t set up yet. Add your Government Gateway credentials in{' '}
                  <a href="/settings?tab=sa-filing" className="font-semibold underline">Settings → Tax Studio</a>.
                </p>
              )}
              {!ready && (
                <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
                  <AlertTriangle size={13} /> Complete every readiness check above before filing.
                </p>
              )}
              {pending && (
                <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[11.5px] text-sky-700">{pending.message} (IRmark {pending.irmark}). We&apos;ll confirm the outcome once HMRC responds.</p>
              )}
              {error && (
                <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700"><XCircle size={13} className="mt-px shrink-0" /> {error}</p>
              )}
              <button onClick={fileToHmrc} disabled={!canFile} className="btn-primary disabled:opacity-40">
                {filing ? <><Loader2 size={15} className="animate-spin" /> Filing…</> : <><Send size={15} /> File CT600 to HMRC{isTest ? ' (test)' : ''}</>}
              </button>
            </>
          )}
        </div>
      </StudioCard>

      {/* Manual filing (fallback) ------------------------------------------------ */}
      {!submitted && (
        <StudioCard className="p-5">
          <h3 className="mb-1 text-[15px] font-bold text-[var(--text-primary)]">Filed elsewhere?</h3>
          <p className="mb-3 text-[12px] text-[var(--text-muted)]">If the CT600 was filed through HMRC&apos;s portal or another route, record it here instead of filing online above.</p>
          <button onClick={markFiled} disabled={!ready} className="btn-secondary bg-white disabled:opacity-40">
            <CheckCircle2 size={15} /> Mark as filed
          </button>
          {!ready && (
            <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">Complete every readiness check above first.</p>
          )}
        </StudioCard>
      )}
    </div>
  );
}
