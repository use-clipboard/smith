'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { IMPORT_SOURCES, IMPORT_STEPS, ENTITY_LABELS } from '../data';
import { StudioCard } from '../primitives';
import type { Engagement, ImportSourceId } from '../types';

export default function StageImport({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const [importing, setImporting] = useState<ImportSourceId | null>(engagement.source);
  const [step, setStep] = useState(engagement.source ? IMPORT_STEPS.length : -1);

  const done = step >= IMPORT_STEPS.length;

  useEffect(() => {
    if (importing === null || done) return;
    const t = setTimeout(() => setStep(s => s + 1), 780);
    return () => clearTimeout(t);
  }, [importing, step, done]);

  function start(id: ImportSourceId) {
    patch(e => ({ ...e, source: id }));
    setImporting(id);
    setStep(0);
  }

  // ── Importing / imported view ──────────────────────────────────────────────
  if (importing !== null) {
    const src = IMPORT_SOURCES.find(s => s.id === importing);
    return (
      <div className="mx-auto max-w-2xl">
        <StudioCard className="overflow-hidden">
          <div className="relative flex flex-col items-center gap-2 px-8 py-9 text-white"
            style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
            <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              {src && <src.icon size={26} className="text-white" />}
            </div>
            <h3 className="text-lg font-bold">{done ? 'Import complete' : `Importing from ${src?.name}`}</h3>
            <p className="text-[13px] text-white/80">{done ? 'Ledger read and statutory accounts prepared for review.' : 'Reading the ledger and detecting the entity…'}</p>
          </div>

          <div className="space-y-1 px-6 py-6">
            {IMPORT_STEPS.map((label, i) => {
              const state = i < step ? 'done' : i === step ? 'active' : 'wait';
              return (
                <div key={label} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${state === 'active' ? 'bg-[var(--accent)]/5' : ''}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-[var(--accent)] text-white' : 'border border-slate-200 bg-white text-slate-300'
                  }`}>
                    {state === 'done' ? <Check size={13} /> : state === 'active' ? <Loader2 size={13} className="animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
                  </span>
                  <span className={`text-[13.5px] font-medium ${state === 'wait' ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{label}</span>
                </div>
              );
            })}
          </div>

          {done && (
            <div className="border-t border-black/5 px-6 py-5">
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Detected label="Company" value={engagement.companyName} />
                <Detected label="Entity" value={ENTITY_LABELS[engagement.entityType]} />
                <Detected label="Framework" value={engagement.framework} />
                <Detected label="Period end" value={engagement.periodEnd} />
                <Detected label="Company no." value={engagement.companyNumber} />
                <Detected label="Comparatives" value={`Year to ${engagement.comparativePeriod}`} />
              </div>
              <button onClick={advance} className="btn-primary w-full justify-center">
                Continue to AI Preparation <ArrowRight size={15} />
              </button>
            </div>
          )}
        </StudioCard>
      </div>
    );
  }

  // ── Source picker ──────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
        <ShieldCheck size={15} className="text-emerald-500" />
        No manual mapping needed — SMITH matches the trial balance automatically.
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {IMPORT_SOURCES.map(s => (
          <button
            key={s.id}
            onClick={() => s.enabled && start(s.id)}
            disabled={!s.enabled}
            aria-disabled={!s.enabled}
            className={`group flex flex-col items-start gap-3 rounded-[20px] border border-white/60 bg-white/70 p-4 text-left shadow-[0_8px_32px_rgba(31,38,88,0.08)] backdrop-blur-md transition-all ${
              s.enabled
                ? 'hover:-translate-y-0.5 hover:border-[var(--accent)]/30 hover:shadow-[0_12px_40px_rgba(31,38,88,0.14)]'
                : 'cursor-not-allowed opacity-55'
            }`}
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              s.native ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-slate-100 text-slate-500'
            } ${s.enabled ? 'group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]' : ''}`}>
              <s.icon size={19} />
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--text-primary)]">
                {s.name}
                {s.native && <span className="rounded bg-[var(--accent)]/10 px-1.5 py-px text-[9px] font-bold uppercase text-[var(--accent)]">SMITH</span>}
                {!s.enabled && <span className="rounded bg-amber-100 px-1.5 py-px text-[9px] font-bold uppercase text-amber-700">Soon</span>}
              </p>
              <p className="text-[11.5px] text-[var(--text-muted)]">{s.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Detected({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white/60 px-3 py-2">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-[var(--text-primary)]">
        <Check size={12} className="text-emerald-500" />{value}
      </p>
    </div>
  );
}
