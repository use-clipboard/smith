'use client';

import { ArrowRight, Calculator, Sparkles, Users } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeSa800 } from '../calc';
import { fmtMoney } from '../data';
import type { TaxReturn } from '../types';

export default function StageAnalyseSa800({ ret, advance }: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const sa = ret.sa800;
  const c = computeSa800(sa, ret.taxYear, { periodStart: sa?.periodStart, periodEnd: sa?.periodEnd });

  return (
    <div className="space-y-4">
      <StudioCard className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]"><Calculator size={15} /> Partnership computation</h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{c.taxYear}</span>
        </div>
        <Row label="Net profit per accounts" value={fmtMoney(c.netProfitPerAccounts)} />
        {c.disallowable > 0 && <Row label="Add: disallowable" value={fmtMoney(c.disallowable)} />}
        {c.capitalAllowances > 0 && <Row label="Less: capital allowances" value={`(${fmtMoney(c.capitalAllowances)})`} />}
        <div className="my-2 rounded-xl bg-[var(--accent)]/5 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">{c.loss > 0 ? 'Allowable loss' : 'Net profit for tax'}</span>
            <span className="text-[15px] font-extrabold text-[var(--accent)]">{fmtMoney(c.loss > 0 ? c.loss : c.profit)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-black/5 pt-2">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><Users size={14} /> Allocated to {c.partnerShares.length} partner{c.partnerShares.length === 1 ? '' : 's'}</span>
          <span className="text-[15px] font-extrabold text-[var(--accent)]">{fmtMoney(c.allocatedProfit)}</span>
        </div>
      </StudioCard>

      <StudioCard className="p-5">
        <div className="mb-2 flex items-center gap-1.5"><Sparkles size={15} className="text-[var(--accent)]" /><h3 className="text-[15px] font-bold text-[var(--text-primary)]">Where the figures come from</h3></div>
        <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          On the <strong className="font-semibold text-[var(--text-primary)]">Review</strong> step you enter (or link from
          Accounts Studio / Bookkeeping) the partnership&apos;s trading result and allocate the profit to the partners. The
          computation and each partner&apos;s share update as you go.
        </p>
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">Continue to review <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[12px] text-[var(--text-muted)]">{label}</span>
      <span className="text-[12.5px] text-[var(--text-secondary)]">{value}</span>
    </div>
  );
}
