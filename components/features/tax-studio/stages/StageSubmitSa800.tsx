'use client';

import { CheckCircle2, XCircle, ShieldCheck, FileCheck2, Landmark } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeSa800 } from '../calc';
import { fmtMoney, fmtDateUK } from '../data';
import type { TaxReturn } from '../types';

// SA800 Submit — records the return as filed. Online filing (legacy GovTalk /
// Transaction Engine, vendor 9626) is a later phase; for now, file via HMRC's
// route and record it here.
export default function StageSubmitSa800({ ret, patch }: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
}): JSX.Element {
  const sa = ret.sa800;
  const c = computeSa800(sa, ret.taxYear, { periodStart: sa?.periodStart, periodEnd: sa?.periodEnd });
  const approved = ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';
  const submitted = ret.approvalStatus === 'submitted';

  const checks: { ok: boolean; label: string; detail?: string }[] = [
    { ok: !!sa?.periodStart && !!sa?.periodEnd, label: 'Accounting period set', detail: `${fmtDateUK(sa?.periodStart ?? '')} – ${fmtDateUK(sa?.periodEnd ?? '')}` },
    { ok: !!ret.utr, label: 'Partnership UTR entered', detail: ret.utr ?? undefined },
    { ok: (sa?.statement.partners.length ?? 0) > 0, label: 'Partners added', detail: `${sa?.statement.partners.length ?? 0}` },
    { ok: Math.abs(c.unallocated) <= 1, label: 'Profit fully allocated', detail: fmtMoney(c.allocatedProfit) },
    { ok: approved, label: 'Approval recorded' },
  ];
  const ready = checks.every(chk => chk.ok);

  function markFiled() {
    patch(r => ({
      ...r, approvalStatus: 'submitted', submittedAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'filed', label: 'SA800 marked as filed with HMRC' }],
    }));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <StudioCard className="p-5">
        <div className="mb-3 flex items-center gap-1.5"><ShieldCheck size={15} className="text-[var(--accent)]" /><h3 className="text-[15px] font-bold text-[var(--text-primary)]">Readiness</h3></div>
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

      <StudioCard className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Landmark size={18} /></div>
          <div className="flex-1">
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">SA800 online filing</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">File the Partnership Tax Return to HMRC.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Coming soon</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">Direct SA800 online filing isn&apos;t wired up yet. For now, file through HMRC&apos;s route and record it as filed below.</p>
        </div>
      </StudioCard>

      <StudioCard className="p-5">
        <h3 className="mb-1 text-[15px] font-bold text-[var(--text-primary)]">Record filing</h3>
        {submitted ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <FileCheck2 size={18} className="shrink-0 text-emerald-600" />
            <div>
              <p className="text-[13px] font-bold text-emerald-800">Filed</p>
              <p className="text-[11.5px] text-emerald-700">{ret.submittedAt ? `Recorded ${fmtDateUK(ret.submittedAt)}` : 'Recorded as filed'}</p>
            </div>
          </div>
        ) : (
          <button onClick={markFiled} disabled={!ready} className="btn-primary disabled:opacity-40"><CheckCircle2 size={15} /> Mark as filed</button>
        )}
        {!submitted && !ready && <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">Complete every readiness check above first.</p>}
      </StudioCard>
    </div>
  );
}
