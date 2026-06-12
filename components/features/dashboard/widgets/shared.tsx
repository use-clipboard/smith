'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTabContext } from '@/components/ui/TabContext';

/** Open a tool in a tab (focuses it if already open) — used by widget "View all" links. */
export function useOpenTool() {
  const { openTab } = useTabContext();
  return (moduleId: string, title: string, route: string, icon: LucideIcon) =>
    openTab({ id: moduleId, title, route, icon });
}

/** Shared glass card shell matching the default dashboard widgets. */
export function WidgetCard({
  icon, title, onViewAll, children,
}: {
  icon: React.ReactNode;
  title: string;
  onViewAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">{icon}</div>
          <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
            View all <ExternalLink size={10} />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/** A labelled count row (icon dot + label on the left, big number on the right). */
export function StatRow({
  label, value, color, hint,
}: {
  label: string;
  value: number | string;
  color: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2 bg-white/40">
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm text-[var(--text-secondary)] truncate">{label}</span>
      </span>
      <span className="flex items-baseline gap-1 shrink-0">
        <span className="text-lg font-bold leading-none" style={{ color }}>{value}</span>
        {hint && <span className="text-[10px] text-[var(--text-muted)]">{hint}</span>}
      </span>
    </div>
  );
}

/** Lightweight SVG donut. segments are drawn in order; remainder shows as a
 *  track. When a segment carries a `label`, hovering it shows a dark pill
 *  tooltip ("Label: value") above the donut. */
export function Donut({
  segments, size = 96, thickness = 13, centerValue, centerSub,
}: {
  segments: { value: number; color: string; label?: string }[];
  size?: number;
  thickness?: number;
  centerValue?: string | number;
  centerSub?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const active = hover != null ? segments[hover] : null;
  return (
    <div className="relative inline-flex shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(15,15,26,0.08)" strokeWidth={thickness} />
          {segments.map((s, i) => {
            const len = (s.value / total) * circ;
            const interactive = !!s.label && s.value > 0;
            const seg = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
                className={interactive ? 'cursor-pointer transition-opacity hover:opacity-80' : undefined}
                onMouseEnter={interactive ? () => setHover(i) : undefined}
                onMouseLeave={interactive ? () => setHover(prev => (prev === i ? null : prev)) : undefined}
              />
            );
            offset += len;
            return seg;
          })}
        </g>
        {centerValue !== undefined && (
          <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--text-primary)', fontSize: 22, fontWeight: 700 }}>
            {centerValue}
          </text>
        )}
        {centerSub && (
          <text x="50%" y="64%" textAnchor="middle" style={{ fill: 'var(--text-muted)', fontSize: 9 }}>
            {centerSub}
          </text>
        )}
      </svg>
      {active?.label && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-7 px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium shadow-lg whitespace-nowrap pointer-events-none z-10"
          role="tooltip"
        >
          {active.label}: {active.value}
        </div>
      )}
    </div>
  );
}

/** Small inline loading state for widgets. */
export function WidgetLoading() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
    </div>
  );
}
