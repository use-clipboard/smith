'use client';

import { useState } from 'react';
import { Send, CheckCircle2, Clock, FileText, PenLine, Mail, ArrowRight, Loader2 } from 'lucide-react';
import { StudioCard, SectionTitle, EstimateChip } from '../primitives';
import { fmtMoney, fmtDateUK } from '../data';
import { estimateSa100 } from '../calc';
import type { TaxReturn } from '../types';

export default function StageApproval({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}) {
  const [sending, setSending] = useState(false);
  const est = estimateSa100(ret.income, ret.taxYear);
  const sent = ret.approvalStatus === 'sent' || ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';
  const approved = ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';

  function markSent() {
    setSending(true);
    setTimeout(() => {
      patch(r => ({
        ...r, approvalStatus: 'sent', sentAt: new Date().toISOString(),
        timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'sent', label: 'Approval pack sent to client' }],
      }));
      setSending(false);
    }, 700);
  }
  function markApproved() {
    patch(r => ({
      ...r, approvalStatus: 'approved', approvedAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'approved', label: 'Client approved the return' }],
    }));
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {/* Approval pack preview */}
      <StudioCard className="overflow-hidden">
        <div className="border-b border-black/5 px-5 py-4">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><FileText size={13} /> Approval pack</p>
          <h3 className="mt-1 text-[16px] font-bold text-[var(--text-primary)]">{ret.clientName} — {ret.taxYear} tax return</h3>
        </div>
        <div className="space-y-1 px-5 py-4">
          <PackRow label="Total income" value={fmtMoney(est.totalIncome)} estimate />
          <PackRow label="Income tax due" value={fmtMoney(est.incomeTax + est.dividendTax)} estimate />
          <PackRow label="Balancing payment (31 Jan)" value={fmtMoney(est.balancingPayment)} estimate />
          <PackRow label="First payment on account" value={fmtMoney(est.paymentOnAccount)} estimate />
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-black/5 px-5 py-4 text-center">
          {[
            { icon: FileText, label: 'PDF pack' },
            { icon: Mail, label: 'Email + portal' },
            { icon: PenLine, label: 'E-signature' },
          ].map(f => (
            <div key={f.label} className="rounded-xl bg-white/60 py-3">
              <f.icon size={16} className="mx-auto text-[var(--accent)]" />
              <p className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">{f.label}</p>
              <p className="text-[10px] text-[var(--text-muted)]">Later increment</p>
            </div>
          ))}
        </div>
      </StudioCard>

      {/* Status + actions */}
      <div className="space-y-4">
        <StudioCard className="p-5">
          <SectionTitle title="Client approval" />
          <div className="space-y-2.5">
            <StatusStep done={sent} active={!sent} icon={Send} label="Send approval pack" detail={ret.sentAt ? `Sent ${fmtDateUK(ret.sentAt)}` : 'Not sent yet'} />
            <StatusStep done={approved} active={sent && !approved} icon={CheckCircle2} label="Client approves" detail={ret.approvedAt ? `Approved ${fmtDateUK(ret.approvedAt)}` : 'Awaiting client'} />
            <StatusStep done={false} active={approved} icon={Clock} label="Ready to file" detail="Proceed to submit" />
          </div>

          <div className="mt-4 space-y-2">
            {!sent && (
              <button onClick={markSent} disabled={sending} className="btn-primary w-full justify-center disabled:opacity-50">
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Mark approval pack as sent
              </button>
            )}
            {sent && !approved && (
              <button onClick={markApproved} className="btn-secondary w-full justify-center">
                <CheckCircle2 size={15} /> Record client approval
              </button>
            )}
            {approved && (
              <button onClick={advance} className="btn-primary w-full justify-center">
                Continue to submission <ArrowRight size={15} />
              </button>
            )}
          </div>
          <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">
            Phase 1 records the approval milestones. Live email send, the client portal and e-signature reuse the Accounts Studio approval flow in a later increment.
          </p>
        </StudioCard>
      </div>
    </div>
  );
}

function PackRow({ label, value, estimate }: { label: string; value: string; estimate?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">{label} {estimate && <EstimateChip />}</span>
      <span className="text-[13px] font-bold text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function StatusStep({ done, active, icon: Icon, label, detail }: { done: boolean; active: boolean; icon: typeof Send; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--accent)] text-white' : 'border border-slate-300 bg-white text-slate-400'}`}>
        <Icon size={15} />
      </div>
      <div>
        <p className={`text-[12.5px] font-semibold ${done || active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{detail}</p>
      </div>
    </div>
  );
}
