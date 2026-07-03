'use client';

import { Check, RotateCcw, X } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';

/**
 * Brief "Time logged — Undo" toast shown after a timer is stopped, like the
 * undo on a sent email. Mounted app-wide (in AppShell) next to the floating
 * timer; the depleting bar tracks the undo window.
 */
export default function TimerUndoToast() {
  const { timerUndo, undoTimer, dismissTimerUndo } = useTimesheets();
  if (!timerUndo) return null;

  const remainingMs = Math.max(0, timerUndo.expiresAt - Date.now());

  return (
    <div className="fixed bottom-4 left-4 z-[70] w-[300px]">
      <div className="overflow-hidden rounded-[16px] border border-white/10 bg-[#1A1A2E] text-white shadow-[0_16px_48px_rgba(15,15,26,0.35)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Check size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold leading-tight">Time logged</p>
            <p className="truncate text-[10.5px] leading-tight text-white/60">{timerUndo.label}</p>
          </div>
          <button
            onClick={undoTimer}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-white/25"
          >
            <RotateCcw size={13} /> Undo
          </button>
          <button onClick={dismissTimerUndo} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-white/40 hover:text-white">
            <X size={14} />
          </button>
        </div>
        <div className="h-1 bg-white/10">
          <div
            className="h-full origin-left bg-emerald-400"
            style={{ animation: `smith-undo-bar ${remainingMs}ms linear forwards` }}
          />
        </div>
      </div>
    </div>
  );
}
