'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, Sparkles, Beaker, CheckCircle2, Circle, PencilLine } from 'lucide-react';
import { StudioCard, SectionTitle, EstimateChip } from '../primitives';
import DocumentExtract from '../DocumentExtract';
import ConnectedImports from '../ConnectedImports';
import { seedSuggestions, seedReviewPoints, fmtMoney } from '../data';
import { estimateSa100 } from '../calc';
import { analyseReturn } from '../persistence';
import type { TaxReturn, Sa100Income } from '../types';

// A realistic SA100 profile used to demonstrate the workspace end-to-end while
// live cross-module imports are built. Clearly labelled "sample" in the UI.
const SAMPLE_INCOME: Sa100Income = {
  employment: [{ id: 'e1', employer: 'Marner Consulting Ltd', pay: 62000, taxDeducted: 12200, benefits: 3200 }],
  selfEmployment: [],
  property: [{ id: 'p1', address: '14 Bridge Road, Leeds', profit: 6400 }],
  dividends: 8000,
  savingsInterest: 850,
  pensionsIncome: 0,
  otherIncome: 0,
  giftAid: 500,
  pensionContributions: 4000,
  studentLoanPlan: 0,
};

export default function StageAnalyse({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}) {
  const [running, setRunning] = useState(false);
  const est = estimateSa100(ret.income, ret.taxYear);
  const hasFigures = est.totalIncome > 0;

  function loadSample() {
    patch(r => ({ ...r, income: SAMPLE_INCOME }));
  }

  async function runAnalysis() {
    setRunning(true);
    const stamp = () => ({ id: `t-${Date.now()}`, at: new Date().toISOString(), kind: 'analysed' as const, label: 'SMITH analysed the return' });
    try {
      const res = await analyseReturn(ret);
      // Carry over any review points the user already resolved / opportunities
      // already sent to the sandbox, matched by text, so a re-run doesn't reset them.
      patch(r => {
        const resolved = new Set(r.reviewPoints.filter(p => p.resolved).map(p => p.issue));
        const applied = new Set(r.suggestions.filter(s => s.appliedToSandbox).map(s => s.title));
        return {
          ...r,
          reviewPoints: res.reviewPoints.map(p => ({ ...p, resolved: resolved.has(p.issue) })),
          suggestions: res.suggestions.map(s => ({ ...s, appliedToSandbox: applied.has(s.title) })),
          timeline: [...r.timeline, stamp()],
        };
      });
    } catch {
      // AI unavailable — fall back to the heuristic checks so the flow completes.
      patch(r => ({
        ...r,
        suggestions: r.suggestions.length ? r.suggestions : seedSuggestions(r.income),
        reviewPoints: r.reviewPoints.length ? r.reviewPoints : seedReviewPoints(r.income),
        timeline: [...r.timeline, stamp()],
      }));
    } finally {
      setRunning(false);
      advance();
    }
  }

  return (
    <div className="space-y-4">
      <StudioCard className="overflow-hidden">
        <div className="relative px-5 py-5" style={{ background: 'linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)' }}>
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/80"><Sparkles size={13} /> AI analysis</p>
          <h3 className="mt-1 text-[17px] font-bold text-white">SMITH assembles the return</h3>
          <p className="mt-1 max-w-lg text-[12.5px] text-white/85">
            Figures are pulled from the connected modules, cross-checked against last year, and the return is assembled ready for your review.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-3">
          <Metric label="Total income" value={fmtMoney(est.totalIncome)} estimate />
          <Metric label="Estimated tax" value={fmtMoney(est.totalTax)} estimate />
          <Metric label="Balancing payment" value={fmtMoney(est.balancingPayment)} estimate />
        </div>
      </StudioCard>

      {/* Read the client's documents (P60, dividend vouchers, etc.) with AI. */}
      <DocumentExtract ret={ret} patch={patch} />

      {/* Connected tools grid: MTD IT, Accounts Studio, Bookkeeping, Landlord
          (+ Payroll/Partnership soon). Each panel can pull from any client. */}
      <ConnectedImports ret={ret} patch={patch} />

      {!hasFigures && (
        <StudioCard className="p-5">
          <SectionTitle title="No figures yet" sub="Upload the client's documents above and SMITH will read them, or pull from a connected module. If there's nothing to import — say just dividends and a pension — key the figures in yourself. You can edit everything on the next step." />
          <div className="flex flex-wrap gap-2">
            <button onClick={advance} className="btn-primary">
              <PencilLine size={14} /> Enter figures manually <ArrowRight size={14} />
            </button>
            <button onClick={loadSample} className="btn-secondary">
              <Beaker size={14} /> Load sample figures (demo)
            </button>
          </div>
        </StudioCard>
      )}

      <StudioCard className="p-5">
        <SectionTitle title="What SMITH checks" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            'Missing data & unfiled sources',
            'Large variances vs last year',
            'Duplicate or double-counted income',
            'Unexpected or disallowable expenses',
            'Tax risks & likely-enquiry areas',
            'Planning & allowance opportunities',
          ].map((c, i) => (
            <div key={c} className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
              {hasFigures ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Circle size={13} className="text-slate-300" />}
              {c}{i === 5 && <EstimateChip className="ml-1" />}
            </div>
          ))}
        </div>
      </StudioCard>

      <div className="flex items-center justify-between">
        <p className="text-[12px] text-[var(--text-muted)]">{hasFigures ? 'Ready — run the analysis to continue.' : 'Load figures (or connect data) to begin.'}</p>
        <button onClick={runAnalysis} disabled={running || !hasFigures} className="btn-primary disabled:opacity-40">
          {running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {running ? 'Analysing…' : 'Run analysis'} {!running && <ArrowRight size={15} />}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, estimate }: { label: string; value: string; estimate?: boolean }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">{label} {estimate && <EstimateChip />}</p>
      <p className="text-[18px] font-extrabold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
