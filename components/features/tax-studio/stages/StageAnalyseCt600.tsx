'use client';

import { ArrowRight, Calculator, Sparkles, Link2, CheckCircle2 } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeCt600 } from '../calc';
import { fmtMoney } from '../data';
import type { TaxReturn } from '../types';

export default function StageAnalyseCt600({
  ret, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const c = computeCt600(ret.ct600, ret.taxYear, { periodStart: ret.periodStart, periodEnd: ret.periodEnd });
  const connected = ret.connected ?? [];

  return (
    <div className="space-y-4">
      {/* Corporation-tax estimate ------------------------------------------------ */}
      <StudioCard className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]">
            <Calculator size={15} /> CT600 computation estimate
          </h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{c.taxYear}</span>
        </div>

        <Row label="Taxable trading profit" value={fmtMoney(c.taxableTradingProfit)} />
        <Row label="Total profits" value={fmtMoney(c.totalProfits)} bold />
        {c.totalProfits - c.pctct > 0 && <Row label="Less: losses & reliefs" value={`(${fmtMoney(c.totalProfits - c.pctct)})`} />}

        <div className="my-2 rounded-xl bg-[var(--accent)]/5 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">Profits chargeable to Corporation Tax</span>
            <span className="text-[15px] font-extrabold text-[var(--accent)]">{fmtMoney(c.pctct)}</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">Corporation Tax @ {c.ctRatePct.toFixed(1)}%</p>
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-black/5 pt-2">
          <span className="text-[13px] font-bold text-[var(--text-primary)]">Corporation Tax</span>
          <span className="text-[19px] font-extrabold text-[var(--accent)]">{fmtMoney(c.corporationTax)}</span>
        </div>
      </StudioCard>

      {/* Where the figures come from -------------------------------------------- */}
      <StudioCard className="p-5">
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles size={15} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Where the figures come from</h3>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          On the <strong className="font-semibold text-[var(--text-primary)]">Review</strong> step you can enter and adjust
          the company&apos;s figures directly on the Trading &amp; Professional Profits and Losses panels. To save keying them
          in, use <strong className="font-semibold text-[var(--text-primary)]">Import from Accounts Studio</strong> on that
          step — SMITH pulls the trading result straight from the company&apos;s accounts, and the Corporation Tax
          computation updates as you go.
        </p>
      </StudioCard>

      {/* Connected data summary ------------------------------------------------- */}
      <StudioCard className="p-5">
        <div className="mb-2 flex items-center gap-1.5">
          <Link2 size={15} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Connected data</h3>
        </div>
        {connected.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {connected.map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{s.label}</p>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">{s.value}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-[var(--text-muted)]">No connected data yet.</p>
        )}
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to review <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[12px] ${bold ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
      <span className={`text-[12.5px] ${bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}
