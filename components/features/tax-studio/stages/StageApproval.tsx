'use client';

import { useEffect, useState } from 'react';
import { Send, CheckCircle2, Clock, FileText, PenLine, Mail, ArrowRight } from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { fmtMoney, fmtDateUK } from '../data';
import { computeSa100Full, paymentPlan } from '../calc';
import { markApprovalSent } from '../persistence';
import SendApprovalModal from '../SendApprovalModal';
import type { TaxReturn } from '../types';

export default function StageApproval({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}) {
  const [showSend, setShowSend] = useState(false);
  const [sentToast, setSentToast] = useState<{ viaCompose?: boolean } | null>(null);
  const c = computeSa100Full(ret.income, ret.taxYear);
  const plan = paymentPlan(ret.income, ret.taxYear);
  const janRefund = plan.janDue < -0.5;
  const sent = ret.approvalStatus === 'sent' || ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';
  const approved = ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';

  // Auto-dismiss the confirmation toast after a few seconds.
  useEffect(() => {
    if (!sentToast) return;
    const t = setTimeout(() => setSentToast(null), 6000);
    return () => clearTimeout(t);
  }, [sentToast]);

  // When the compose window actually sends this client's approval email, flip the
  // return to 'sent'. This honors the compose hand-off contract: a prepared draft
  // (still sitting in the compose window) is never recorded as sent.
  useEffect(() => {
    function onComposeSent(ev: Event) {
      const ids = ((ev as CustomEvent).detail?.clientIds ?? []) as string[];
      if (ret.clientId && ids.length && !ids.includes(ret.clientId)) return;
      recordSent();
    }
    window.addEventListener('smith:compose-sent', onComposeSent);
    return () => window.removeEventListener('smith:compose-sent', onComposeSent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ret.clientId, ret.id]);

  // Flip the return to 'sent' + log the timeline once (idempotent).
  function recordSent() {
    markApprovalSent(ret.id).catch(() => { /* local patch keeps the UI in step */ });
    patch(r => (r.approvalStatus === 'sent' || r.approvalStatus === 'approved' || r.approvalStatus === 'submitted' ? r : {
      ...r, approvalStatus: 'sent', sentAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'sent', label: 'Approval pack sent to client' }],
    }));
  }

  // The send modal handed off. Direct send (no Email Triage) → the email really
  // went out, so record it. Email Triage hand-off → it's in the compose window;
  // we pop a toast (like the MTD IT tool) and let the preparer carry on — the
  // status flips when it's actually sent (the compose-sent listener above).
  function handleSent(info?: { viaCompose?: boolean }) {
    if (!info?.viaCompose) recordSent();
    setSentToast({ viaCompose: info?.viaCompose });
    setShowSend(false);
  }
  function markApproved() {
    patch(r => ({
      ...r, approvalStatus: 'approved', approvedAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'approved', label: 'Client approval recorded (approved outside SMITH)' }],
    }));
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Approval pack preview */}
        <StudioCard className="overflow-hidden">
          <div className="border-b border-black/5 px-5 py-4">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><FileText size={13} /> Approval pack</p>
            <h3 className="mt-1 text-[16px] font-bold text-[var(--text-primary)]">{ret.clientName} — {ret.taxYear} tax return</h3>
          </div>
          <div className="space-y-1 px-5 py-4">
            <PackRow label="Total income" value={fmtMoney(c.totalIncome)} />
            <PackRow label="Total tax & NIC due" value={fmtMoney(c.totalDue)} />
            <PackRow label={janRefund ? `Refund ${plan.janDate}` : `Due ${plan.janDate}`} value={fmtMoney(Math.abs(plan.janDue))} strong />
            {plan.julDue > 0 && <PackRow label={`Due ${plan.julDate}`} value={fmtMoney(plan.julDue)} strong />}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-black/5 px-5 py-4 text-center">
            {[
              { icon: FileText, label: 'PDF pack', sub: 'SA302 + return' },
              { icon: Mail, label: 'Email + portal', sub: 'Sent to client' },
              { icon: PenLine, label: 'E-signature', sub: 'Typed-name' },
            ].map(f => (
              <div key={f.label} className="rounded-xl bg-white/60 py-3">
                <f.icon size={16} className="mx-auto text-[var(--accent)]" />
                <p className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">{f.label}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{f.sub}</p>
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
              {!approved && (
                <button onClick={() => setShowSend(true)} className="btn-primary w-full justify-center">
                  <Send size={15} /> {sent ? 'Resend for approval' : 'Send for approval'}
                </button>
              )}
              {!approved && (
                <button onClick={markApproved} className="btn-secondary w-full justify-center">
                  <CheckCircle2 size={15} /> Record approval manually
                </button>
              )}
              {approved && (
                <button onClick={advance} className="btn-primary w-full justify-center">
                  Continue to submission <ArrowRight size={15} />
                </button>
              )}
            </div>
            <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">
              The client reviews a branded portal and approves by typing their name (e-signature) — you&apos;re notified when they respond. If they&apos;ve approved another way (email, phone or a signed copy), use <strong>Record approval manually</strong> to proceed straight to submission — sending the SMITH email is optional.
            </p>
          </StudioCard>
        </div>
      </div>

      {showSend && <SendApprovalModal ret={ret} onClose={() => setShowSend(false)} onSent={(info) => handleSent(info)} />}

      {/* Confirmation toast — anchored top-centre so it clears the bottom-right
          compose window during the Email Triage hand-off. Auto-dismisses. */}
      {sentToast && (
        <div className="fixed left-1/2 top-6 z-[70] flex max-w-sm -translate-x-1/2 items-start gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 shadow-[0_16px_50px_rgba(31,38,88,0.22)]">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="text-[13px]">
            <div className="font-semibold text-[var(--text-primary)]">
              {sentToast.viaCompose ? 'Ready in your compose window' : 'Approval email sent'}
            </div>
            <div className="mt-0.5 text-[11.5px] text-[var(--text-secondary)]">
              {sentToast.viaCompose
                ? <>The approval email is drafted with the pack attached. Review it and hit <strong>Send</strong> when you&apos;re ready.</>
                : <>The client will be notified. You can also record approval manually if they respond another way.</>}
            </div>
          </div>
        </div>
      )}
    </>
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
