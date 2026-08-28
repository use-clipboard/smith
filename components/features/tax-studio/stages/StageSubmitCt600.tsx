'use client';

import { CheckCircle2, XCircle, Landmark, ShieldCheck, FileCheck2 } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeCt600 } from '../calc';
import { fmtMoney, fmtDateUK } from '../data';
import type { TaxReturn } from '../types';

export default function StageSubmitCt600({
  ret, patch,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
}): JSX.Element {
  const c = computeCt600(ret.ct600, ret.taxYear);
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

      {/* Online filing (coming soon) -------------------------------------------- */}
      <StudioCard className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Landmark size={18} /></div>
          <div className="flex-1">
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">CT600 online filing</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Submit the CT600 to HMRC&apos;s Corporation Tax Online service.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Coming soon</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
            Direct CT600 filing — generating the iXBRL computation and accounts and submitting through HMRC&apos;s
            Corporation Tax Online service — isn&apos;t wired up yet. For now, file the return through HMRC&apos;s portal or
            your existing route and record it as filed below.
          </p>
        </div>
      </StudioCard>

      {/* Manual filing ----------------------------------------------------------- */}
      <StudioCard className="p-5">
        <h3 className="mb-1 text-[15px] font-bold text-[var(--text-primary)]">Manual filing</h3>
        <p className="mb-3 text-[12px] text-[var(--text-muted)]">Once the CT600 has been filed with HMRC, record it here to complete the workflow.</p>
        {submitted ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <FileCheck2 size={18} className="shrink-0 text-emerald-600" />
            <div>
              <p className="text-[13px] font-bold text-emerald-800">Filed</p>
              <p className="text-[11.5px] text-emerald-700">{ret.submittedAt ? `Recorded ${fmtDateUK(ret.submittedAt)}` : 'Recorded as filed'}</p>
            </div>
          </div>
        ) : (
          <button onClick={markFiled} disabled={!ready} className="btn-primary disabled:opacity-40">
            <CheckCircle2 size={15} /> Mark as filed
          </button>
        )}
        {!submitted && !ready && (
          <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">Complete every readiness check above before marking the return as filed.</p>
        )}
      </StudioCard>
    </div>
  );
}
