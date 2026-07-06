'use client';

import { ArrowRight, Building2, Ruler, BookOpen, CalendarRange, Sparkles, TrendingUp, Scale, AlertCircle } from 'lucide-react';
import { ENTITY_LABELS, SIZE_LABELS } from '../data';
import { StudioCard } from '../primitives';
import StatementsView from '../StatementsView';
import type { Engagement } from '../types';

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `(£${abs})` : `£${abs}`;
}
function isoToUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export default function StagePreparation({
  engagement, advance,
}: {
  engagement: Engagement;
  advance: () => void;
}) {
  const stmts = engagement.statements;

  // Statements are built during Import. If we somehow got here without them,
  // guide the user back rather than showing an empty shell.
  if (!stmts || !engagement.importInfo) {
    return (
      <div className="mx-auto max-w-lg">
        <StudioCard className="p-6 text-center">
          <AlertCircle size={26} className="mx-auto mb-3 text-amber-500" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">No imported data yet</h3>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Go back to Import Data and pull a trial balance from the client&apos;s bookkeeping book first.</p>
        </StudioCard>
      </div>
    );
  }

  const info = engagement.importInfo;
  const periodLabel = `For the period ${isoToUk(info.from)} to ${isoToUk(info.to)}`;

  const detections = [
    { icon: Building2,     label: 'Entity type',      value: ENTITY_LABELS[engagement.entityType] },
    { icon: Ruler,         label: 'Company size',     value: SIZE_LABELS[engagement.size] },
    { icon: BookOpen,      label: 'Framework',        value: engagement.framework },
    { icon: CalendarRange, label: 'Reporting period', value: `${engagement.periodStart} – ${engagement.periodEnd}` },
  ];

  const headline = [
    { label: 'Turnover',         value: stmts.profitLoss.turnoverTotal },
    { label: 'Gross profit',     value: stmts.profitLoss.grossProfit },
    { label: 'Profit for year',  value: stmts.profitLoss.netProfit },
    { label: 'Total assets',     value: stmts.balanceSheet.totalAssets },
    { label: 'Net assets',       value: stmts.balanceSheet.netAssets },
  ];

  return (
    <div className="space-y-4">
      <StudioCard className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={18} /></span>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Statutory accounts prepared</h3>
            <p className="text-[12px] text-[var(--text-muted)]">
              Built from the imported trial balance — {info.bookName}, {periodLabel.toLowerCase()}.
              {stmts.hasPrior ? ' Comparatives included.' : ' No prior year found.'}
            </p>
          </div>
        </div>
      </StudioCard>

      {/* Detection + headline figures */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StudioCard className="p-5">
          <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><Building2 size={14} className="text-[var(--accent)]" /> What SMITH detected</h4>
          <div className="grid grid-cols-2 gap-2">
            {detections.map(d => (
              <div key={d.label} className="rounded-xl border border-black/5 bg-white/60 px-3 py-2.5">
                <p className="text-[11px] text-[var(--text-muted)]">{d.label}</p>
                <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{d.value}</p>
              </div>
            ))}
          </div>
        </StudioCard>

        <StudioCard className="p-5">
          <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><TrendingUp size={14} className="text-[var(--accent)]" /> Headline figures</h4>
          <div className="space-y-1.5">
            {headline.map(h => (
              <div key={h.label} className="flex items-center justify-between border-b border-black/5 py-1.5 last:border-0">
                <span className="text-[12.5px] text-[var(--text-secondary)]">{h.label}</span>
                <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{money(h.value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Scale size={12} /> A cash flow statement is omitted under the small-company / FRS 105 exemptions where applicable.
          </p>
        </StudioCard>
      </div>

      {/* The real statements */}
      <StatementsView statements={stmts} periodLabel={periodLabel} />

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to Notes & Disclosures <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
