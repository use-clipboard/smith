'use client';

import { Pause, Play, Square } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { fmtStopwatch, timerElapsedMs } from '@/lib/timesheets/format';

/**
 * Persistent floating timers. Mounted once at the app root (inside
 * TimesheetsProvider) so they stay visible on every screen. Shows up to 3
 * concurrent timers stacked bottom-left; only one ever counts at a time (the
 * others are paused). Renders nothing when no timer is open.
 */
export default function FloatingTimer() {
  const { timers, nowMs, pauseTimer, resumeTimer, stopTimer } = useTimesheets();
  if (timers.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[70] w-[300px] space-y-2">
      {timers.map(t => {
        const counting = !t.paused;
        const elapsed = timerElapsedMs(t, nowMs);
        return (
          <div
            key={t.id}
            className="overflow-hidden rounded-[18px] border bg-white/85 shadow-[0_16px_48px_rgba(31,38,88,0.22)] backdrop-blur-xl transition-opacity"
            style={{ borderColor: counting ? `${t.color}66` : 'rgba(255,255,255,0.6)', opacity: counting ? 1 : 0.92 }}
          >
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {counting && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: t.color }} />}
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: counting ? t.color : '#94A3B8' }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold leading-tight text-[var(--text-primary)]">
                  {t.label || t.clientName || 'Internal'}
                </p>
                <p className="truncate text-[10.5px] leading-tight text-[var(--text-muted)]">
                  {t.clientName || 'Internal'}{t.activity ? ` · ${t.activity}` : ''}
                </p>
              </div>
              <div className="font-mono text-[15px] font-bold tabular-nums text-[var(--text-primary)]">
                {fmtStopwatch(elapsed)}
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-black/5 px-4 py-2">
              {counting ? (
                <button
                  onClick={() => pauseTimer(t.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-black/10"
                >
                  <Pause size={14} /> Pause
                </button>
              ) : (
                <button
                  onClick={() => resumeTimer(t.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: t.color }}
                >
                  <Play size={14} /> Resume
                </button>
              )}
              <button
                onClick={() => stopTimer(t.id, true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-500 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-600"
              >
                <Square size={12} fill="currentColor" /> Stop &amp; log
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
