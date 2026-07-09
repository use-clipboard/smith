'use client';

import { Check, AlertTriangle, Circle, Sparkles, Clock3 } from 'lucide-react';
import type { SectionStatus, ValidationStatus } from './types';

/** Large white glass card used throughout Accounts Studio. */
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

const SECTION_PILL: Record<SectionStatus, { label: string; cls: string; icon: typeof Check }> = {
  complete:      { label: 'Complete',     cls: 'bg-emerald-100 text-emerald-700', icon: Check },
  'needs-review':{ label: 'Needs review', cls: 'bg-amber-100 text-amber-700',     icon: AlertTriangle },
  missing:       { label: 'Missing',      cls: 'bg-rose-100 text-rose-600',       icon: Circle },
  draft:         { label: 'AI draft',     cls: 'bg-[var(--accent)]/10 text-[var(--accent)]', icon: Sparkles },
};

export function SectionStatusPill({ status, compact = false }: { status: SectionStatus; compact?: boolean }) {
  const s = SECTION_PILL[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      <Icon size={11} />{!compact && s.label}
    </span>
  );
}

/** Small round status dot for the section navigation list. */
export function SectionStatusDot({ status }: { status: SectionStatus }) {
  const map: Record<SectionStatus, string> = {
    complete: 'text-emerald-500',
    'needs-review': 'text-amber-500',
    missing: 'text-rose-400',
    draft: 'text-[var(--accent)]',
  };
  if (status === 'complete') return <Check size={15} className={map.complete} />;
  if (status === 'needs-review') return <AlertTriangle size={14} className={map['needs-review']} />;
  if (status === 'draft') return <Sparkles size={14} className={map.draft} />;
  return <Circle size={13} className={map.missing} />;
}

type BadgeTone = 'draft' | 'progress' | 'ready' | 'filed' | 'sent' | 'approved' | 'rejected' | 'submitted';
const STATUS_BADGE: Record<BadgeTone, string> = {
  draft:     'bg-slate-100 text-slate-600',
  progress:  'bg-[var(--accent)]/10 text-[var(--accent)]',
  ready:     'bg-sky-100 text-sky-700',
  filed:     'bg-emerald-100 text-emerald-700',
  sent:      'bg-sky-100 text-sky-700',
  approved:  'bg-violet-100 text-violet-700',
  rejected:  'bg-amber-100 text-amber-700',
  submitted: 'bg-emerald-100 text-emerald-700',
};

export function EngagementStatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_BADGE[tone]}`}>{label}</span>;
}

const VALIDATION_STYLE: Record<ValidationStatus, { ring: string; icon: typeof Check; iconCls: string; chip: string }> = {
  pass:    { ring: 'border-emerald-200/70 bg-emerald-50/60', icon: Check,         iconCls: 'bg-emerald-500',  chip: 'text-emerald-700' },
  warn:    { ring: 'border-amber-200/70 bg-amber-50/60',     icon: AlertTriangle, iconCls: 'bg-amber-500',     chip: 'text-amber-700' },
  fail:    { ring: 'border-rose-200/70 bg-rose-50/60',       icon: AlertTriangle, iconCls: 'bg-rose-500',      chip: 'text-rose-700' },
  running: { ring: 'border-slate-200/70 bg-white/60',        icon: Clock3,        iconCls: 'bg-slate-400',     chip: 'text-slate-500' },
};

export function ValidationStyle(status: ValidationStatus) {
  return VALIDATION_STYLE[status];
}
