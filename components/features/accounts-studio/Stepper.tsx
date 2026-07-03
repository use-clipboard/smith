'use client';

import { Check } from 'lucide-react';
import { STAGES } from './data';
import type { Engagement, StageId } from './types';

export default function Stepper({
  engagement, current, onSelect,
}: {
  engagement: Engagement;
  current: StageId;
  onSelect: (id: StageId) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STAGES.map((stage, i) => {
        const status = engagement.stageStatus[stage.id];
        const isCurrent = stage.id === current;
        const done = status === 'complete';
        const reachable = done || isCurrent || status === 'active';
        return (
          <div key={stage.id} className="flex items-center">
            <button
              onClick={() => reachable && onSelect(stage.id)}
              disabled={!reachable}
              className={`group flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors ${
                isCurrent ? 'bg-[var(--accent)]/10' : reachable ? 'hover:bg-black/[0.03]' : 'cursor-not-allowed opacity-55'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done ? 'bg-emerald-500 text-white'
                  : isCurrent ? 'bg-[var(--accent)] text-white'
                  : 'border border-slate-300 bg-white text-slate-400'
                }`}
              >
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[13px] font-semibold ${
                isCurrent ? 'text-[var(--accent)]' : done ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}>
                {stage.label}
              </span>
            </button>
            {i < STAGES.length - 1 && (
              <div className={`mx-0.5 h-px w-5 shrink-0 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
