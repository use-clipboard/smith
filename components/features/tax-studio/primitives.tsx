'use client';

import type { ReturnStatus } from './types';
import { STATUS_META } from './data';

/** Large white glass card — the Tax Studio surface (matches Accounts Studio). */
export function StudioCard({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[22px] border border-white/60 bg-white/70 shadow-[0_8px_32px_rgba(31,38,88,0.10)] backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: ReturnStatus }) {
  const m = STATUS_META[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${m.tone}`}>{m.label}</span>;
}

/** Thin section heading used across stage panels. */
export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{title}</h3>
      {sub && <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

/** A small "Estimate" chip — reused everywhere a Phase-1 figure is approximate. */
export function EstimateChip({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ${className}`}>
      Estimate
    </span>
  );
}
