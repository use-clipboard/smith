'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Play, Plus, Square } from 'lucide-react';
import { useTimesheets } from './TimesheetsProvider';
import { fmtDuration, fmtStopwatch, todayIso } from '@/lib/timesheets/format';
import EntryModal from './shared/EntryModal';

/**
 * Timesheets launcher embedded in the Tasks tool. Lets a user start the global
 * Timesheets timer (or log time) against a specific task, and shows the total
 * Timesheets time recorded on it. Renders nothing for users without Timesheets
 * access (preview gate), so it never affects the rest of the team.
 */
export default function TaskTimesheetLink({
  taskId, taskTitle, clientId, clientName, isInternal,
}: {
  taskId: string;
  taskTitle: string;
  clientId: string | null;
  clientName: string;
  isInternal: boolean;
}) {
  const { allowed, activities, startTimer, stopTimer, timer, elapsedMs } = useTimesheets();
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null);
  const [logging, setLogging] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const timingThis = timer.running && timer.taskId === taskId;

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetch(`/api/timesheets/entries?taskId=${taskId}`)
      .then(r => (r.ok ? r.json() : { entries: [] }))
      .then(d => {
        if (cancelled) return;
        const mins = ((d.entries ?? []) as { minutes: number }[]).reduce((s, e) => s + (e.minutes || 0), 0);
        setTotalMinutes(mins);
      })
      .catch(() => { if (!cancelled) setTotalMinutes(0); });
    return () => { cancelled = true; };
  }, [allowed, taskId, refreshKey]);

  // Refresh the total when a timer for this task stops.
  useEffect(() => {
    if (!timingThis) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timingThis]);

  if (!allowed) return null;

  const start = () => {
    const act = activities.find(a => a.type === (isInternal ? 'internal' : 'billable')) ?? activities[0];
    startTimer({
      clientId,
      clientName: clientName || 'Internal',
      taskId,
      taskTitle,
      activity: act.label,
      department: act.department,
      type: act.type,
    });
  };

  return (
    <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600"><Clock size={15} /></div>
          <span className="text-sm font-semibold text-gray-800">Timesheets</span>
        </div>
        {totalMinutes != null && (
          <span className="text-xs text-gray-500">
            <span className="font-bold text-gray-800">{fmtDuration(totalMinutes)}</span> logged
          </span>
        )}
      </div>

      {timingThis ? (
        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
          <span className="relative flex h-2 w-2">
            {!timer.paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-60" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <span className="flex-1 font-mono text-sm font-bold tabular-nums text-gray-800">{fmtStopwatch(elapsedMs)}</span>
          <button onClick={() => stopTimer(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-600">
            <Square size={12} fill="currentColor" /> Stop &amp; log
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={start} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            <Play size={14} /> Start timer
          </button>
          <button onClick={() => setLogging(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Plus size={14} /> Log time
          </button>
        </div>
      )}

      {logging && (
        <EntryModal
          prefill={{ date: todayIso(), taskId, taskTitle, clientId }}
          onClose={() => { setLogging(false); refresh(); }}
        />
      )}
    </div>
  );
}
