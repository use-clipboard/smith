'use client';

import { ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTabContext } from '@/components/ui/TabContext';
import AnimatedDonut from '@/components/ui/AnimatedDonut';

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

/** SVG donut — now a thin adapter over the shared AnimatedDonut so every donut
 *  in the app (dashboard, clients, team, MTD IT) animates identically:
 *  hovering a segment highlights it and swaps the centre to that segment's
 *  label + value. Keeps the original `segments` API so callers don't change. */
export function Donut({
  segments, size = 96, thickness = 13, centerValue, centerSub,
}: {
  segments: { value: number; color: string; label?: string }[];
  size?: number;
  thickness?: number;
  centerValue?: string | number;
  centerSub?: string;
}) {
  return (
    <AnimatedDonut
      slices={segments.map((s, i) => ({ id: String(i), label: s.label ?? '', value: s.value, color: s.color }))}
      size={size}
      thickness={thickness}
      centerValue={centerValue !== undefined ? String(centerValue) : undefined}
      centerTitle={centerSub}
    />
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
