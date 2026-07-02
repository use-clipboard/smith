'use client';

import { ReactNode } from 'react';
import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { hueColor } from '@/lib/timesheets/palette';

/** Standard glass panel used across the module (matches SMITH tool cards). */
export function GlassCard({
  children, className = '', padded = true,
}: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div
      className={`rounded-[20px] bg-white/[0.72] backdrop-blur-md border border-white/60 shadow-[0_8px_32px_rgba(31,38,88,0.08)] ${padded ? 'p-5' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  title, subtitle, right,
}: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-bold text-[var(--text-primary)] tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Glass metric tile with an icon chip, big value, and optional delta / gauge. */
export function KpiCard({
  label, value, sub, icon: Icon, tint = '#6366F1', deltaRatio, gauge,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tint?: string;
  deltaRatio?: number;
  gauge?: ReactNode;
}) {
  const up = (deltaRatio ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-[20px] bg-white/[0.72] backdrop-blur-md border border-white/60 shadow-[0_8px_32px_rgba(31,38,88,0.08)] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(31,38,88,0.14)]">
      {/* corner glow */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-40 blur-2xl transition-opacity group-hover:opacity-70"
        style={{ background: tint }}
      />
      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
          <p className="mt-1.5 text-[26px] font-bold leading-none text-[var(--text-primary)]">{value}</p>
          {(sub || deltaRatio != null) && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px]">
              {deltaRatio != null && (
                <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(Math.round(deltaRatio * 100))}%
                </span>
              )}
              {sub && <span className="text-[var(--text-muted)] truncate">{sub}</span>}
            </div>
          )}
        </div>
        {gauge ?? (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: `${tint}1f`, color: tint }}
          >
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Initials avatar coloured from a stored hue. */
export function TsAvatar({ name, hue, size = 32 }: { name: string; hue: number; size?: number }) {
  const initials = name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${hueColor(hue, 72, 62)}, ${hueColor(hue + 24, 72, 50)})`,
      }}
    >
      {initials}
    </div>
  );
}

/** Thin rounded progress bar. `value` 0–1 (clamped visually). */
export function ProgressBar({
  value, color = '#6366F1', track = 'rgba(15,23,42,0.08)', height = 6,
}: { value: number; color?: string; track?: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: track }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
      />
    </div>
  );
}

/** Segmented pill toggle (e.g. Me / Team, week nav). */
export function SegToggle<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-[var(--bg-nav-hover)] p-1">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            value === o.value ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small coloured type badge. */
export function TypeBadge({ type }: { type: 'billable' | 'non_billable' | 'internal' }) {
  const map = {
    billable: { label: 'Billable', cls: 'bg-emerald-50 text-emerald-600' },
    non_billable: { label: 'Non-billable', cls: 'bg-violet-50 text-violet-600' },
    internal: { label: 'Internal', cls: 'bg-indigo-50 text-indigo-600' },
  } as const;
  const m = map[type];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{m.label}
  </span>;
}
