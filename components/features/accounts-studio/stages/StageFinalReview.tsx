'use client';

import { useMemo, useState } from 'react';
import { Check, AlertTriangle, ArrowRight, RefreshCw, ShieldCheck, Clock3 } from 'lucide-react';
import { StudioCard, ValidationStyle } from '../primitives';
import { computeValidations } from '@/lib/accounts-studio/validations';
import type { Engagement, ValidationCheck } from '../types';

export default function StageFinalReview({
  engagement, advance,
}: {
  engagement: Engagement;
  advance: () => void;
}) {
  const [running, setRunning] = useState(false);
  // Checks are DERIVED live from the engagement — always current, no template.
  const checks = useMemo(() => computeValidations(engagement), [engagement]);
  const passed = checks.filter(c => c.status === 'pass').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  const allClear = warnings === 0 && failed === 0;

  // Re-run is a light re-check affordance — the checks already reflect live state.
  function rerun() {
    setRunning(true);
    setTimeout(() => setRunning(false), 450);
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Summary banner */}
      <StudioCard className="mb-5 overflow-hidden">
        <div className="flex items-center gap-4 px-6 py-5">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${allClear ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
            <ShieldCheck size={26} />
          </div>
          <div className="flex-1">
            <h3 className="text-[16px] font-bold text-[var(--text-primary)]">
              {allClear ? 'All compliance checks passed' : `${warnings + failed} item${warnings + failed === 1 ? '' : 's'} need attention`}
            </h3>
            <p className="text-[12.5px] text-[var(--text-muted)]">Compliance validation for {engagement.companyName} — {engagement.framework}.</p>
          </div>
          <div className="hidden gap-2 sm:flex">
            <Pill n={passed} label="Passed" cls="bg-emerald-100 text-emerald-700" />
            <Pill n={warnings} label="Warnings" cls="bg-amber-100 text-amber-700" />
            {failed > 0 && <Pill n={failed} label="Failed" cls="bg-rose-100 text-rose-700" />}
          </div>
          <button onClick={rerun} disabled={running} className="btn-secondary shrink-0">
            <RefreshCw size={14} className={running ? 'animate-spin' : ''} /> Re-run
          </button>
        </div>
      </StudioCard>

      {/* Validation cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {checks.map(c => <ValidationCard key={c.id} check={running ? { ...c, status: 'running' } : c} />)}
      </div>

      <div className="mt-5">
        <button onClick={advance} className="btn-primary w-full justify-center">
          Continue to Approve &amp; Publish <ArrowRight size={15} />
        </button>
        {!allClear && (
          <p className="mt-2 text-center text-[11.5px] text-[var(--text-muted)]">
            You can publish with open warnings — they&apos;ll be flagged on the approval pack.
          </p>
        )}
      </div>
    </div>
  );
}

function ValidationCard({ check }: { check: ValidationCheck }) {
  const s = ValidationStyle(check.status);
  const Icon = check.status === 'running' ? Clock3 : check.status === 'pass' ? Check : AlertTriangle;
  return (
    <div className={`flex items-start gap-3 rounded-[18px] border px-4 py-3.5 ${s.ring}`}>
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${s.iconCls} ${check.status === 'running' ? 'animate-pulse' : ''}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-[var(--text-primary)]">{check.label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {check.status === 'running' ? 'Validating…' : check.detail}
        </p>
      </div>
    </div>
  );
}

function Pill({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className={`rounded-xl px-3 py-1.5 text-center ${cls}`}>
      <p className="text-[15px] font-bold tabular-nums leading-none">{n}</p>
      <p className="text-[10px] font-medium">{label}</p>
    </div>
  );
}
