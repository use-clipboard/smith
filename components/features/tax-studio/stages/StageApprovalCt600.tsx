'use client';

import { ArrowRight, FileText, CheckCircle2, Banknote, CalendarClock } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeCt600, ct600PaymentDue, ct600FilingDue } from '../calc';
import { fmtMoney, fmtDateUK } from '../data';
import type { TaxReturn } from '../types';

export default function StageApprovalCt600({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const c = computeCt600(ret.ct600, ret.taxYear);
  const approved = ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';
  const paymentDue = ct600PaymentDue(ret.periodEnd);
  const filingDue = ct600FilingDue(ret.periodEnd);

  function markApproved() {
    patch(r => ({
      ...r,
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'approved', label: 'CT600 approval recorded' }],
    }));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Approval-pack summary --------------------------------------------------- */}
      <StudioCard className="overflow-hidden">
        <div className="border-b border-black/5 px-5 py-4">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><FileText size={13} /> Approval pack</p>
          <h3 className="mt-1 text-[16px] font-bold text-[var(--text-primary)]">{ret.clientName} — CT600 for the period ending {fmtDateUK(ret.periodEnd ?? '')}</h3>
        </div>
        <div className="space-y-1 px-5 py-4">
          <PackRow label="Total profits" value={fmtMoney(c.totalProfits)} />
          <PackRow label="Profits chargeable to Corporation Tax" value={fmtMoney(c.pctct)} />
          <PackRow label="Corporation Tax due" value={fmtMoney(c.corporationTax)} strong />
        </div>
        <div className="grid grid-cols-1 gap-2 border-t border-black/5 px-5 py-4 sm:grid-cols-2">
          <KeyDate icon={Banknote} label="Payment due" value={fmtDateUK(paymentDue)} />
          <KeyDate icon={CalendarClock} label="Filing deadline" value={fmtDateUK(filingDue)} />
        </div>
      </StudioCard>

      {/* Approval lifecycle ------------------------------------------------------ */}
      <StudioCard className="p-5">
        <h3 className="mb-3 text-[15px] font-bold text-[var(--text-primary)]">Client approval</h3>
        {approved ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            <div>
              <p className="text-[13px] font-bold text-emerald-800">Approved</p>
              <p className="text-[11.5px] text-emerald-700">{ret.approvedAt ? `Recorded ${fmtDateUK(ret.approvedAt)}` : 'Approval recorded'}</p>
            </div>
          </div>
        ) : (
          <button onClick={markApproved} className="btn-primary w-full justify-center">
            <CheckCircle2 size={15} /> Mark as approved
          </button>
        )}
        <p className="mt-3 text-[10.5px] text-[var(--text-muted)]">Client approval pack PDF for CT600 is coming soon.</p>
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to submit <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function PackRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12.5px] text-[var(--text-secondary)]">{label}</span>
      <span className={`text-[13px] font-bold ${strong ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}

function KeyDate({ icon: Icon, label, value }: { icon: typeof Banknote; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/60 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Icon size={12} /> {label}</p>
      <p className="text-[14px] font-bold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
