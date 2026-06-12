'use client';

import { type DueWindow, DUE_WINDOW_CONFIG } from './dueWindow';

interface Props {
  value: DueWindow;
  onChange: (v: DueWindow) => void;
  /** Total count for the "All" chip (typically the unfiltered task list size). */
  totalCount: number;
  /** Per-bucket counts for the other chips. */
  counts: Record<Exclude<DueWindow, 'all'>, number>;
  className?: string;
}

export default function DueWindowChips({ value, onChange, totalCount, counts, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <button
        onClick={() => onChange('all')}
        className={`px-3 py-1.5 rounded-full text-xs font-semibold shadow-md transition-colors border ${
          value === 'all'
            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
            : 'bg-white text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'
        }`}
      >
        All <span className={value === 'all' ? 'text-white/70 ml-1' : 'text-[var(--text-muted)] ml-1'}>{totalCount}</span>
      </button>
      {(['overdue', 'today', 'this_week', 'later', 'no_due'] as const).map(w => {
        const cfg = DUE_WINDOW_CONFIG[w];
        const count = counts[w];
        const isActive = value === w;
        return (
          <button
            key={w}
            onClick={() => onChange(isActive ? 'all' : w)}
            disabled={count === 0 && !isActive}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shadow-md transition-colors border ${
              isActive ? cfg.activeCls + ' border-transparent' : 'bg-white text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'
            } ${count === 0 && !isActive ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {cfg.label} <span className={isActive ? 'opacity-80 ml-1' : 'text-[var(--text-muted)] ml-1'}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
