'use client';

import { ArrowRight, FileText, CheckCircle2, Users } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeSa800 } from '../calc';
import { fmtMoney } from '../data';
import type { TaxReturn } from '../types';

export default function StageApprovalSa800({ ret, patch, advance }: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const sa = ret.sa800;
  const c = computeSa800(sa, ret.taxYear, { periodStart: sa?.periodStart, periodEnd: sa?.periodEnd });
  const approved = ret.approvalStatus === 'approved' || ret.approvalStatus === 'submitted';

  const missing: string[] = [];
  if (!sa?.periodStart || !sa?.periodEnd) missing.push('accounting period');
  if (!ret.utr) missing.push('partnership UTR');
  if (!(c.netProfitPerAccounts !== 0 || c.profit > 0 || c.loss > 0)) missing.push('trading figures');
  if (!(sa?.statement.partners.length)) missing.push('partners');
  const canApprove = missing.length === 0;

  function markApproved() {
    if (!canApprove) return;
    patch(r => ({
      ...r, approvalStatus: 'approved', approvedAt: new Date().toISOString(),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'approved', label: 'SA800 approval recorded' }],
    }));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <StudioCard className="overflow-hidden">
        <div className="border-b border-black/5 px-5 py-4">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><FileText size={13} /> Approval pack</p>
          <h3 className="mt-1 text-[16px] font-bold text-[var(--text-primary)]">{sa?.businessName || ret.clientName} — Partnership Tax Return {c.taxYear}</h3>
        </div>
        <div className="space-y-1 px-5 py-4">
          <PackRow label={c.loss > 0 ? 'Allowable loss' : 'Net profit for tax'} value={fmtMoney(c.loss > 0 ? c.loss : c.profit)} strong />
          <PackRow label="Allocated to partners" value={fmtMoney(c.allocatedProfit)} />
        </div>
        <div className="border-t border-black/5 px-5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Users size={12} /> Partner allocation</p>
          {c.partnerShares.map(p => (
            <div key={p.id} className="flex items-center justify-between py-0.5 text-[12.5px]">
              <span className="text-[var(--text-secondary)]">{p.name || 'Partner'} — {p.sharePct}%</span>
              <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(p.profitShare)}</span>
            </div>
          ))}
        </div>
      </StudioCard>

      <StudioCard className="p-5">
        <h3 className="mb-3 text-[15px] font-bold text-[var(--text-primary)]">Approval</h3>
        {approved ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            <div>
              <p className="text-[13px] font-bold text-emerald-800">Approved</p>
              <p className="text-[11.5px] text-emerald-700">Approval recorded</p>
            </div>
          </div>
        ) : (
          <button onClick={markApproved} disabled={!canApprove} className="btn-primary w-full justify-center disabled:opacity-40">
            <CheckCircle2 size={15} /> Mark as approved
          </button>
        )}
        {!approved && !canApprove && (
          <p className="mt-2 text-[10.5px] text-rose-500">Add the {missing.join(', ')} before recording approval.</p>
        )}
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">Continue to submit <ArrowRight size={15} /></button>
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
