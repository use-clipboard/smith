'use client';

import { useState } from 'react';
import { AlertTriangle, Pause, Play, Square, X, Minus } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { fmtStopwatch, timerElapsedMs } from '@/lib/timesheets/format';

/**
 * Persistent floating timers. Mounted once at the app root (inside
 * TimesheetsProvider) so they stay visible on every screen.
 *
 * Layout: at most ONE timer is maximised (the full card with pause/stop) — the
 * rest sit as small coloured pills bottom-left (title + live time), so three
 * running timers no longer bury the screen. Click a pill to bring it up (which
 * minimises whichever was maximised); minimise the card to drop everything to
 * pills. The choice persists across navigation via localStorage. Renders nothing
 * when no timer is open.
 */
const MAX_KEY = 'smith:timer-maximized';
const NONE = '__none__'; // sentinel: user explicitly minimised everything

export default function FloatingTimer() {
  const { timers, nowMs, pauseTimer, resumeTimer, stopTimer, staleTimerNotice, dismissStaleTimerNotice } = useTimesheets();
  const [maximized, setMaximized] = useState<string | null>(() => {
    try { return typeof window !== 'undefined' ? localStorage.getItem(MAX_KEY) : null; } catch { return null; }
  });
  const persistMax = (v: string | null) => {
    setMaximized(v);
    try { if (v) localStorage.setItem(MAX_KEY, v); else localStorage.removeItem(MAX_KEY); } catch { /* ignore */ }
  };

  if (timers.length === 0 && !staleTimerNotice) return null;

  // Which timer is full-size. '__none__' = all minimised; a stale/missing choice
  // falls back to the counting timer (else the first) so there's always a
  // sensible default card until the user decides otherwise.
  let maxId: string | null;
  if (maximized === NONE) maxId = null;
  else if (maximized && timers.some(t => t.id === maximized)) maxId = maximized;
  else maxId = (timers.find(t => !t.paused) ?? timers[0])?.id ?? null;

  const maxTimer = timers.find(t => t.id === maxId) ?? null;
  const minimised = timers.filter(t => t.id !== maxId);

  return (
    <div className="fixed bottom-4 left-4 z-[70] flex flex-col items-start gap-2">
      {staleTimerNotice && (
        <div className="w-[300px] rounded-[14px] border border-amber-300 bg-amber-50 px-3.5 py-2.5 shadow-[0_16px_48px_rgba(31,38,88,0.18)]">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="flex-1 text-[11.5px] leading-snug text-amber-900">{staleTimerNotice}</p>
            <button
              onClick={dismissStaleTimerNotice}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-0.5 text-amber-700 hover:bg-amber-100"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Minimised timers — coloured pills (the timer's colour), title + live
          time. Click to maximise (auto-minimises whichever was up). */}
      {minimised.length > 0 && (
        <div className="flex flex-row flex-wrap items-center gap-1.5 max-w-[min(560px,calc(100vw-2rem))]">
          {minimised.map(t => {
            const counting = !t.paused;
            const elapsed = timerElapsedMs(t, nowMs);
            return (
              <button
                key={t.id}
                onClick={() => persistMax(t.id)}
                aria-label={`Expand timer: ${t.label || t.clientName || 'Internal'}`}
                className="flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-white shadow-[0_8px_24px_rgba(31,38,88,0.28)] transition-transform hover:scale-[1.03]"
                style={{ background: t.color }}
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  {counting && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />}
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" style={{ opacity: counting ? 1 : 0.6 }} />
                </span>
                <span className="max-w-[130px] truncate text-[11.5px] font-semibold">{t.label || t.clientName || 'Internal'}</span>
                <span className="font-mono text-[11.5px] font-bold tabular-nums">{fmtStopwatch(elapsed)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Maximised timer — full card with controls. */}
      {maxTimer && (() => {
        const t = maxTimer;
        const counting = !t.paused;
        const elapsed = timerElapsedMs(t, nowMs);
        return (
          <div
            className="w-[300px] overflow-hidden rounded-[18px] border bg-white/85 shadow-[0_16px_48px_rgba(31,38,88,0.22)] backdrop-blur-xl transition-opacity"
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
              <button
                onClick={() => persistMax(NONE)}
                aria-label="Minimise timer"
                className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--text-secondary)]"
              >
                <Minus size={15} />
              </button>
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
      })()}
    </div>
  );
}
