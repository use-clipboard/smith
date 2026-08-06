'use client';

import { useMemo } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2, Info, RotateCcw } from 'lucide-react';
import { fmtMoney } from '../data';
import {
  ROLL_CATEGORIES, categoryHasData, categoryValueLabel, categoryNote, type RollKey,
} from './wizardData';
import type { Sa100Income } from '../types';
import type { WizardClient } from './wizardData';

export default function StepRollForward({
  priorYear, priorIncome, roll, onToggle, onSetAll, client,
}: {
  priorYear: string | null;
  priorIncome: Sa100Income | null;
  roll: Record<RollKey, boolean>;
  onToggle: (k: RollKey) => void;
  onSetAll: (v: boolean) => void;
  client: WizardClient | null;
}) {
  const income = priorIncome;

  const summary = useMemo(() => {
    let ready = 0, review = 0, na = 0;
    for (const cat of ROLL_CATEGORIES) {
      const has = income ? categoryHasData(cat.key, income) : false;
      const note = income ? categoryNote(cat.key, income) : { review: false };
      if (!has) na++;
      else if (note.review) review++;
      else ready++;
    }
    const total = ready + review + na;
    return { ready, review, na, pct: total ? Math.round((ready / total) * 100) : 0 };
  }, [income]);

  const notes = useMemo(() => {
    if (!income) return [] as { text: string; review: boolean }[];
    return ROLL_CATEGORIES.filter(c => categoryHasData(c.key, income) || c.key === 'personal')
      .map(c => categoryNote(c.key, income))
      .filter((n, i, arr) => arr.findIndex(x => x.text === n.text) === i)
      .slice(0, 6);
  }, [income]);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      {/* Roll-forward table */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text-primary)]">4. Roll Forward{priorYear ? ` from ${priorYear}` : ''}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
              <Sparkles size={13} className="text-[var(--accent)]" />
              {income ? 'SMITH has analysed last year’s return — choose what to carry forward.' : 'No prior Tax Studio return — you’ll start fresh and add figures in Analyse.'}
            </p>
          </div>
          {income && (
            <div className="flex items-center gap-3">
              <button onClick={() => onSetAll(false)} className="text-[11.5px] font-semibold text-[var(--text-secondary)] hover:underline">Deselect all</button>
              <button onClick={() => onSetAll(true)} className="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><RotateCcw size={12} /> Select all</button>
            </div>
          )}
        </div>

        {income ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-black/5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Last year</th>
                  <th className="py-2 pr-3 text-center">Roll forward</th>
                  <th className="py-2 pr-3">AI notes</th>
                </tr>
              </thead>
              <tbody>
                {ROLL_CATEGORIES.map(cat => {
                  const has = categoryHasData(cat.key, income);
                  const note = categoryNote(cat.key, income);
                  const on = roll[cat.key];
                  return (
                    <tr key={cat.key} className="border-b border-black/5 text-[12.5px]">
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold text-[var(--text-primary)]">{cat.label}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{cat.sub}</p>
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-[var(--text-secondary)]">{categoryValueLabel(cat.key, income, fmtMoney)}</td>
                      <td className="py-2.5 pr-3 text-center">
                        <Toggle on={on} disabled={!has && cat.key !== 'personal'} onClick={() => onToggle(cat.key)} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex items-center gap-1.5 ${note.review ? 'text-amber-700' : 'text-[var(--text-muted)]'}`}>
                          {note.review ? <AlertTriangle size={13} /> : has ? <CheckCircle2 size={13} className="text-emerald-500" /> : <Info size={13} />}
                          {note.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-white/50 px-4 py-6 text-center">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Nothing to roll forward yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-[var(--text-muted)]">This is {client?.name ?? 'the client'}&apos;s first return in Tax Studio. Continue and SMITH will help you build the figures in the workspace.</p>
          </div>
        )}
      </div>

      {/* Summary + notes */}
      <div className="space-y-4">
        <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Imported data summary</p>
          <div className="mt-3 flex items-center gap-4">
            <Donut pct={summary.pct} />
            <div className="space-y-1.5 text-[12px]">
              <Legend color="bg-emerald-500" label="Data ready to use" value={summary.ready} />
              <Legend color="bg-[var(--accent)]" label="Review required" value={summary.review} />
              <Legend color="bg-slate-300" label="Not applicable" value={summary.na} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><Sparkles size={12} className="text-[var(--accent)]" /> Roll forward notes</p>
          {notes.length ? (
            <ul className="mt-2 space-y-1.5">
              {notes.map((n, i) => (
                <li key={i} className={`flex items-start gap-2 text-[12px] ${n.review ? 'text-amber-700' : 'text-[var(--text-secondary)]'}`}>
                  {n.review ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" />}
                  {n.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">SMITH’s year-on-year comparison will appear here once there is a prior year to compare.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${disabled ? 'cursor-not-allowed bg-slate-200 opacity-50' : on ? 'bg-[var(--accent)]' : 'bg-slate-300'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Donut({ pct }: { pct: number }) {
  const circ = 2 * Math.PI * 26;
  return (
    <div className="relative h-[72px] w-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="8" className="stroke-slate-200/70" />
        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-[var(--accent)]"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-extrabold text-[var(--text-primary)]">{pct}%</span>
        <span className="text-[9px] text-[var(--text-muted)]">Ready</span>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="flex-1 text-[var(--text-secondary)]">{label}</span>
      <span className="font-semibold text-[var(--text-primary)]">{value}</span>
    </div>
  );
}
