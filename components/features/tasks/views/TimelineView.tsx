'use client';

import { useMemo, useState } from 'react';
import type { Task } from '@/types';

// Timeline (Gantt-style) — dated tasks laid out across a horizontal range from
// today to ~8 weeks out (plus an overdue lane on the far left). Each bar runs
// from the task's start (created date, clamped) to its due date, coloured by
// status. Hover a bar for full details; click a row to open the detail panel.

interface Props {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

const STATUS_COLOR: Record<string, string> = {
  not_started: '#94a3b8', in_progress: '#2563eb', records_here: '#7c3aed',
  review: '#0891b2', waiting_on_client: '#d97706', complete: '#16a34a',
};
const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started', in_progress: 'In Progress', records_here: 'Records Here',
  review: 'Review', waiting_on_client: 'Waiting on Client', complete: 'Complete',
};

const DAY = 86_400_000;
const WEEKS = 8;

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function fmtDate(iso: string): string { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}-${m[2]}-${m[1]}` : iso; }
function dueInfo(t: Task): { text: string; overdue: boolean } {
  if (!t.due_date) return { text: 'No due date', overdue: false };
  const today = startOfToday();
  const due = new Date(t.due_date); due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / DAY);
  const date = fmtDate(t.due_date);
  if (t.status === 'complete') return { text: `Due ${date}`, overdue: false };
  if (days < 0) return { text: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue · ${date}`, overdue: true };
  if (days === 0) return { text: `Due today · ${date}`, overdue: true };
  return { text: `Due ${date} · in ${days} day${days === 1 ? '' : 's'}`, overdue: false };
}

export default function TimelineView({ tasks, onTaskClick }: Props) {
  const [hover, setHover] = useState<{ t: Task; x: number; y: number } | null>(null);

  const { rows, weeks, hiddenNoDate, todayLeft } = useMemo(() => {
    const today = startOfToday();
    const rangeStart = new Date(today); rangeStart.setDate(today.getDate() - 7); // 1 wk overdue lane
    const rangeEnd = new Date(today); rangeEnd.setDate(today.getDate() + WEEKS * 7);
    const span = rangeEnd.getTime() - rangeStart.getTime();

    const dated = tasks.filter(t => t.due_date);
    const hiddenNoDate = tasks.length - dated.length;

    const rows = dated
      .map(t => {
        const due = new Date(t.due_date as string); due.setHours(0, 0, 0, 0);
        const created = t.created_at ? new Date(t.created_at) : new Date(due.getTime() - 3 * DAY);
        const barStart = Math.max(created.getTime(), rangeStart.getTime());
        const barEnd = Math.min(Math.max(due.getTime(), barStart + DAY), rangeEnd.getTime());
        const left = ((barStart - rangeStart.getTime()) / span) * 100;
        const width = Math.max(((barEnd - barStart) / span) * 100, 1.5);
        const overdue = due < today && t.status !== 'complete';
        return { t, due: due.getTime(), left, width, overdue };
      })
      .sort((a, b) => a.due - b.due)
      .slice(0, 60);

    const weeks = Array.from({ length: WEEKS + 1 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() + i * 7);
      const left = ((d.getTime() - rangeStart.getTime()) / span) * 100;
      return { label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), left };
    });

    const todayLeft = ((today.getTime() - rangeStart.getTime()) / span) * 100;

    return { rows, weeks, hiddenNoDate, todayLeft };
  }, [tasks]);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          {/* Week ruler */}
          <div className="grid grid-cols-[220px_1fr] border-b border-gray-100">
            <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Task</div>
            <div className="relative h-9">
              {weeks.map((w, i) => (
                <div key={i} className="absolute top-0 bottom-0 flex items-center" style={{ left: `${w.left}%` }}>
                  <span className="text-[10.5px] font-semibold text-gray-400 -translate-x-1/2 whitespace-nowrap">{w.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {/* Today marker line across all rows */}
            <div className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: `calc(220px + (100% - 220px) * ${todayLeft / 100})` }}>
              <div className="w-px h-full bg-indigo-400/70" />
            </div>

            {rows.length === 0
              ? <p className="text-center text-sm text-gray-400 py-16">No dated tasks to plot.</p>
              : rows.map(({ t, left, width, overdue }) => {
                const color = STATUS_COLOR[t.status] ?? '#6366f1';
                return (
                  <button
                    key={t.id}
                    onClick={() => onTaskClick(t)}
                    className="grid grid-cols-[220px_1fr] items-center w-full text-left border-b border-gray-50 hover:bg-gray-50/70 transition-colors"
                  >
                    <div className="px-4 py-2.5 min-w-0">
                      <p className="text-[12.5px] font-semibold text-gray-800 truncate">{t.title}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {t.is_internal ? 'Internal' : (t.client?.name ?? '—')}
                        {t.client?.client_ref && <span className="font-mono"> · {t.client.client_ref}</span>}
                      </p>
                    </div>
                    <div className="relative h-9 pr-3">
                      <div
                        onMouseEnter={e => setHover({ t, x: e.clientX, y: e.clientY })}
                        onMouseMove={e => setHover({ t, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHover(null)}
                        className="absolute top-1/2 -translate-y-1/2 h-[22px] rounded-md flex items-center px-2 shadow-sm cursor-pointer"
                        style={{ left: `${left}%`, width: `${width}%`, background: color, boxShadow: overdue ? '0 0 0 2px #fecaca' : undefined }}
                      >
                        <span className="text-[10px] font-semibold text-white truncate">{t.title}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
      {hiddenNoDate > 0 && (
        <p className="text-[11.5px] text-gray-400 px-4 py-2 border-t border-gray-100">{hiddenNoDate} task{hiddenNoDate === 1 ? '' : 's'} without a due date {hiddenNoDate === 1 ? 'is' : 'are'} not shown on the timeline.</p>
      )}

      {/* Hover detail — black pill */}
      {hover && (() => {
        const di = dueInfo(hover.t);
        const c = STATUS_COLOR[hover.t.status] ?? '#6366f1';
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        return (
          <div className="fixed z-[95] pointer-events-none" style={{ left: Math.min(hover.x + 14, vw - 290), top: hover.y + 14 }}>
            <div className="bg-gray-900 text-white rounded-lg shadow-2xl px-3 py-2.5 max-w-[270px]">
              <p className="text-[12.5px] font-semibold leading-snug">{hover.t.title}</p>
              <p className="text-[11px] text-gray-300 mt-0.5">
                {hover.t.is_internal ? 'Internal' : (hover.t.client?.name ?? '—')}
                {hover.t.client?.client_ref && <span className="text-gray-400 font-mono"> · {hover.t.client.client_ref}</span>}
              </p>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                <span className="text-[11px] font-semibold" style={{ color: c }}>{STATUS_LABEL[hover.t.status] ?? hover.t.status}</span>
              </div>
              <p className={`text-[11px] mt-1 ${di.overdue ? 'text-red-300 font-semibold' : 'text-gray-300'}`}>{di.text}</p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
