'use client';

import { Check, CheckCircle2, Sparkles, CalendarClock } from 'lucide-react';
import { RETURN_TYPES } from '../data';
import { RETURN_TYPE_INFO } from './wizardData';
import type { ReturnTypeId } from '../types';

export default function StepReturnType({
  selected, onSelect,
}: {
  selected: ReturnTypeId;
  onSelect: (id: ReturnTypeId) => void;
}) {
  const info = RETURN_TYPE_INFO[selected];
  const rt = RETURN_TYPES.find(r => r.id === selected)!;
  const SelIcon = rt.icon;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      {/* Left — cards */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <h3 className="text-[16px] font-bold text-[var(--text-primary)]">1. Choose Return Type</h3>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">Select the type of return you want to prepare.</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RETURN_TYPES.map(r => {
            const Icon = r.icon;
            const isSel = selected === r.id;
            return (
              <button
                key={r.id}
                onClick={() => r.enabled && onSelect(r.id)}
                disabled={!r.enabled}
                className={`relative flex flex-col items-center rounded-2xl border p-4 text-center transition-all ${
                  isSel ? 'border-[var(--accent)] bg-[var(--accent)]/[0.06] ring-1 ring-[var(--accent)]'
                  : r.enabled ? 'border-[var(--border)] bg-white/70 hover:border-[var(--accent)]/40 hover:shadow-sm'
                  : 'border-[var(--border)] bg-slate-50/60 opacity-55'
                }`}
              >
                {isSel && <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-white"><Check size={12} /></span>}
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isSel ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-slate-100 text-[var(--text-muted)]'}`}>
                  <Icon size={22} />
                </div>
                <p className="mt-2.5 text-[13px] font-bold text-[var(--text-primary)]">{r.label} ({r.form})</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">{r.blurb}</p>
                {!r.enabled && <span className="absolute left-2.5 top-2.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">Soon</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Sparkles size={17} className="shrink-0 text-[var(--accent)]" />
            <div>
              <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Not sure which return type?</p>
              <p className="text-[11.5px] text-[var(--text-muted)]">SMITH can recommend the right return based on your client&apos;s data.</p>
            </div>
          </div>
          <button className="btn-secondary shrink-0 whitespace-nowrap" disabled title="">Get Recommendation</button>
        </div>
      </div>

      {/* Right — info panel */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Return Type Information</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><SelIcon size={24} /></div>
          <div>
            <h4 className="text-[15px] font-bold text-[var(--text-primary)]">{rt.label} ({rt.form})</h4>
          </div>
        </div>
        <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">{info.description}</p>

        <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Includes</p>
        <ul className="mt-2 space-y-1.5">
          {info.includes.map(inc => (
            <li key={inc} className="flex items-start gap-2 text-[12.5px] text-[var(--text-secondary)]">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" /> {inc}
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Connected data sources</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {info.sources.map(s => (
            <div key={s.label} className="flex flex-col items-center gap-1 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--accent)] shadow-sm"><s.icon size={16} /></div>
              <span className="text-[10px] text-[var(--text-muted)]">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl bg-[var(--accent)]/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]"><CalendarClock size={14} className="text-[var(--accent)]" /> Typical timeline</p>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{info.timelineWindow}</p>
          <p className="text-[11px] text-[var(--text-muted)]">Last submission: {info.lastSubmission}</p>
        </div>
      </div>
    </div>
  );
}
