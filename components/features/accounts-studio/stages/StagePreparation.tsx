'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, ArrowRight, Building2, Ruler, Moon, BadgeCheck, BookOpen, CalendarRange } from 'lucide-react';
import { PREPARATION_STEPS, ENTITY_LABELS, SIZE_LABELS } from '../data';
import { StudioCard } from '../primitives';
import type { Engagement } from '../types';

export default function StagePreparation({
  engagement, advance,
}: {
  engagement: Engagement;
  advance: () => void;
}) {
  const total = PREPARATION_STEPS.length;
  // If the stage is already complete (revisiting), show it finished.
  const alreadyDone = engagement.stageStatus.preparation === 'complete';
  const [step, setStep] = useState(alreadyDone ? total : 0);
  const done = step >= total;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setStep(s => s + 1), 620);
    return () => clearTimeout(t);
  }, [step, done]);

  const pct = Math.round((Math.min(step, total) / total) * 100);

  const detections = [
    { icon: Building2,    label: 'Entity type',       value: ENTITY_LABELS[engagement.entityType] },
    { icon: Ruler,        label: 'Company size',      value: SIZE_LABELS[engagement.size] },
    { icon: Moon,         label: 'Dormant status',    value: engagement.dormant ? 'Dormant' : 'Trading' },
    { icon: BadgeCheck,   label: 'Micro-entity',      value: engagement.microEligible ? 'Eligible' : 'Not eligible' },
    { icon: BookOpen,     label: 'Framework',         value: engagement.framework },
    { icon: CalendarRange,label: 'Reporting period',  value: `${engagement.periodStart} – ${engagement.periodEnd}` },
  ];

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-5">
      {/* Preparation checklist */}
      <StudioCard className="overflow-hidden lg:col-span-3">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">SMITH is preparing the accounts</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Financial statements, notes, policies and reports — built automatically.</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-[var(--accent)] tabular-nums">{pct}%</p>
            <p className="text-[11px] text-[var(--text-muted)]">Preparation score</p>
          </div>
        </div>
        <div className="h-1.5 w-full bg-slate-100">
          <div className="h-full rounded-r-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="space-y-0.5 px-4 py-4">
          {PREPARATION_STEPS.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'wait';
            return (
              <div key={s.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${state === 'active' ? 'bg-[var(--accent)]/5' : ''}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-[var(--accent)] text-white' : 'border border-slate-200 bg-white'
                }`}>
                  {state === 'done' ? <Check size={11} /> : state === 'active' ? <Loader2 size={11} className="animate-spin" /> : null}
                </span>
                <span className={`text-[13px] font-medium ${state === 'wait' ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{s.label}</span>
                {state === 'active' && <span className="ml-auto text-[11px] text-[var(--accent)]">running…</span>}
              </div>
            );
          })}
        </div>
        {done && (
          <div className="border-t border-black/5 px-6 py-4">
            <button onClick={advance} className="btn-primary w-full justify-center">
              Continue to Accounts Review <ArrowRight size={15} />
            </button>
          </div>
        )}
      </StudioCard>

      {/* Detection cards */}
      <div className="space-y-3 lg:col-span-2">
        <StudioCard className="p-5">
          <h4 className="mb-3 text-[13px] font-bold text-[var(--text-primary)]">What SMITH detected</h4>
          <div className="space-y-2">
            {detections.map(d => (
              <div key={d.label} className="flex items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                  <d.icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-[var(--text-muted)]">{d.label}</p>
                  <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{d.value}</p>
                </div>
                <Check size={15} className="text-emerald-500" />
              </div>
            ))}
          </div>
        </StudioCard>
        <StudioCard className="p-4">
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">Comparatives.</span> Prior year balances matched from the {engagement.comparativePeriod} filed accounts. Cash flow statement omitted under the small-company exemption.
          </p>
        </StudioCard>
      </div>
    </div>
  );
}
