'use client';

import { Sparkles, Check, X, RefreshCw, Mail, MicVocal, CheckSquare, ClipboardCheck, FileSearch, Gauge, CalendarDays, Wand2 } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { SOURCE_META } from '@/lib/timesheets/suggestions';
import type { SuggestionSource } from '@/lib/timesheets/types';
import { fmtDuration } from '@/lib/timesheets/format';
import { GlassCard } from '../shared/ui';

const ICONS: Record<SuggestionSource, typeof Mail> = {
  email: Mail, meeting: MicVocal, task: CheckSquare, accounts_review: ClipboardCheck,
  capture: FileSearch, performance: Gauge, calendar: CalendarDays,
};

export default function AiSuggestionsPanel() {
  const { suggestions, scanning, scanForWork, acceptSuggestion, dismissSuggestion } = useTimesheets();

  const totalMin = suggestions.reduce((s, x) => s + x.suggestedMinutes, 0);

  function acceptAll() {
    // Accept a stable snapshot — acceptSuggestion mutates the list.
    suggestions.map(s => s.id).forEach(id => acceptSuggestion(id));
  }

  return (
    <GlassCard padded={false} className="overflow-hidden">
      {/* Gradient header */}
      <div className="relative overflow-hidden px-5 py-4"
        style={{ background: 'linear-gradient(120deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
        <div className="pointer-events-none absolute -right-6 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-white">AI suggested time</h3>
              <p className="text-[11px] text-white/75">
                {suggestions.length > 0
                  ? `${suggestions.length} unrecorded item${suggestions.length > 1 ? 's' : ''} · ${fmtDuration(totalMin)} detected`
                  : 'Work captured quietly from across SMITH'}
              </p>
            </div>
          </div>
          <button
            onClick={scanForWork}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/30 disabled:opacity-60"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Scan for work'}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="p-3">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500">
              <Check size={22} />
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">You&apos;re all caught up</p>
            <p className="max-w-xs text-xs text-[var(--text-muted)]">
              SMITH watches Email, Meeting Notes, Tasks, Capture, Accounts Review, Performance and your Calendar. New work will appear here to confirm.
            </p>
            <button onClick={scanForWork} className="btn-secondary mt-1"><Wand2 size={14} /> Run a scan</button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {suggestions.map(s => {
                const meta = SOURCE_META[s.source];
                const Icon = ICONS[s.source];
                return (
                  <div key={s.id} className="group flex items-center gap-3 rounded-2xl border border-black/5 bg-white/70 p-3 transition-colors hover:border-[var(--accent)]/30 hover:bg-white">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: `hsl(${meta.hue} 80% 96%)`, color: `hsl(${meta.hue} 70% 45%)` }}>
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{s.clientName}</p>
                        <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-muted)]">{meta.label}</span>
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-muted)]">{s.rationale}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-bold text-[var(--text-primary)]">{fmtDuration(s.suggestedMinutes)}</p>
                      <div className="mt-0.5 flex items-center justify-end gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.confidence > 0.85 ? '#10B981' : s.confidence > 0.75 ? '#F59E0B' : '#94A3B8' }} />
                        <span className="text-[9.5px] text-[var(--text-muted)]">{Math.round(s.confidence * 100)}%</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => acceptSuggestion(s.id)}
                        aria-label="Accept suggestion"
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 text-white transition-transform hover:scale-105 hover:bg-emerald-600"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => dismissSuggestion(s.id)}
                        aria-label="Dismiss suggestion"
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/5 text-[var(--text-muted)] transition-colors hover:bg-black/10"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={acceptAll}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[var(--accent)]/30 bg-[var(--accent)]/5 py-2.5 text-[13px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
            >
              <Check size={15} /> Approve all ({fmtDuration(totalMin)})
            </button>
          </>
        )}
      </div>
    </GlassCard>
  );
}
