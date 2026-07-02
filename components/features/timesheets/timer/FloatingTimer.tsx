'use client';

import { useState } from 'react';
import { Pause, Play, Square, ChevronDown, ChevronUp } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { fmtStopwatch } from '@/lib/timesheets/format';
import { TYPE_COLORS } from '@/lib/timesheets/palette';

/**
 * Persistent floating timer. Mounted once at the app root (inside
 * TimesheetsProvider) so it stays visible on every screen while time is
 * being tracked. Renders nothing when no timer is active.
 */
export default function FloatingTimer() {
  const { timer, elapsedMs, pauseTimer, resumeTimer, stopTimer } = useTimesheets();
  const [expanded, setExpanded] = useState(true);

  if (!timer.running) return null;

  const dotColor = TYPE_COLORS[timer.type];

  return (
    <div className="fixed bottom-4 left-4 z-[70] w-[300px]">
      <div className="overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-[0_16px_48px_rgba(31,38,88,0.22)] backdrop-blur-xl">
        {/* Header row — always visible */}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {!timer.paused && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: dotColor }} />
            )}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: timer.paused ? '#94A3B8' : dotColor }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold leading-tight text-[var(--text-primary)]">
              {timer.clientName || 'Internal'}
            </p>
            <p className="truncate text-[10.5px] leading-tight text-[var(--text-muted)]">{timer.activity}</p>
          </div>
          <div className="font-mono text-[17px] font-bold tabular-nums text-[var(--text-primary)]">
            {fmtStopwatch(elapsedMs)}
          </div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="rounded-md p-0.5 text-[var(--text-muted)] hover:bg-black/5"
            aria-label={expanded ? 'Collapse timer' : 'Expand timer'}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>

        {expanded && (
          <div className="flex items-center gap-2 border-t border-black/5 px-4 py-2.5">
            {timer.paused ? (
              <button onClick={resumeTimer} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)]/10 py-2 text-[13px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/15">
                <Play size={15} /> Resume
              </button>
            ) : (
              <button onClick={pauseTimer} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black/5 py-2 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-black/10">
                <Pause size={15} /> Pause
              </button>
            )}
            <button
              onClick={() => stopTimer(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-500 py-2 text-[13px] font-semibold text-white hover:bg-rose-600"
            >
              <Square size={13} fill="currentColor" /> Stop &amp; log
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
