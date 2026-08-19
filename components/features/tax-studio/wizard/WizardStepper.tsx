'use client';

import { Check } from 'lucide-react';

export interface WizardStepDef { n: number; label: string }

export const WIZARD_STEPS: WizardStepDef[] = [
  { n: 1, label: 'Choose Return Type' },
  { n: 2, label: 'Select Client' },
  { n: 3, label: 'Tax Year' },
  { n: 4, label: 'Roll Forward' },
  { n: 5, label: 'Review & Confirm' },
];

export default function WizardStepper({
  current, onSelect, furthest, steps = WIZARD_STEPS,
}: {
  current: number;
  furthest: number;
  onSelect: (n: number) => void;
  steps?: WizardStepDef[];
}) {
  return (
    <div className="flex items-center">
      {steps.map((s, i) => {
        const done = s.n < current;
        const isCurrent = s.n === current;
        const reachable = s.n <= furthest;
        return (
          <div key={s.n} className="flex flex-1 items-center last:flex-none">
            <button
              onClick={() => reachable && onSelect(s.n)}
              disabled={!reachable}
              className={`flex items-center gap-2.5 ${reachable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors ${
                done ? 'bg-emerald-500 text-white'
                : isCurrent ? 'bg-[var(--accent)] text-white'
                : 'border border-slate-300 bg-white text-slate-400'
              }`}>
                {done ? <Check size={15} /> : s.n}
              </span>
              <span className={`whitespace-nowrap text-[13px] font-semibold ${
                isCurrent ? 'text-[var(--accent)]' : done ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}>
                {s.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-px flex-1 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
