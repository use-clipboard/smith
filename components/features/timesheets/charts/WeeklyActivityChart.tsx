'use client';

import { useState } from 'react';
import type { DayBucket } from '@/lib/timesheets/compute';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/timesheets/palette';
import { fmtDuration } from '@/lib/timesheets/format';

interface Props {
  days: DayBucket[];
  /** Optional daily target line, in hours (e.g. 7.5). */
  targetHours?: number;
  height?: number;
}

const SEGMENTS = [
  { key: 'billable', color: TYPE_COLORS.billable, label: TYPE_LABELS.billable },
  { key: 'nonBillable', color: TYPE_COLORS.non_billable, label: TYPE_LABELS.non_billable },
  { key: 'internal', color: TYPE_COLORS.internal, label: TYPE_LABELS.internal },
] as const;

export default function WeeklyActivityChart({ days, targetHours, height = 240 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const maxMin = Math.max(60, ...days.map(d => d.total));
  // Round the axis up to a whole hour above the tallest bar.
  const axisMax = Math.ceil(maxMin / 60) * 60;
  const gridHours = Array.from({ length: axisMax / 60 + 1 }, (_, i) => i);

  return (
    <div>
      <div className="flex" style={{ height }}>
        {/* Y axis */}
        <div className="relative w-8 shrink-0 text-[10px] text-[var(--text-muted)]">
          {gridHours.slice().reverse().map(h => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2"
              style={{ top: `${(1 - h / (axisMax / 60)) * 100}%` }}
            >
              {h}h
            </div>
          ))}
        </div>

        {/* Plot */}
        <div className="relative flex-1">
          {/* gridlines */}
          {gridHours.map(h => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-dashed border-black/[0.06]"
              style={{ top: `${(1 - h / (axisMax / 60)) * 100}%` }}
            />
          ))}
          {/* target line */}
          {targetHours != null && targetHours * 60 <= axisMax && (
            <div
              className="absolute left-0 right-0 border-t-2 border-dashed border-[var(--accent)]/40"
              style={{ top: `${(1 - (targetHours * 60) / axisMax) * 100}%` }}
            >
              <span className="absolute -top-4 right-0 text-[9px] font-semibold text-[var(--accent)]/70">
                Target {targetHours}h
              </span>
            </div>
          )}

          {/* bars */}
          <div className="absolute inset-0 flex items-end justify-around gap-2 pb-0">
            {days.map((d, i) => {
              const isHover = hover === i;
              return (
                <div
                  key={d.date}
                  className="relative flex h-full flex-1 flex-col justify-end items-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* tooltip */}
                  {isHover && d.total > 0 && (
                    <div className="absolute bottom-full mb-2 z-20 w-40 rounded-xl bg-[#1A1A2E] p-2.5 text-white shadow-xl">
                      <p className="mb-1 text-[11px] font-semibold">{d.label} · {fmtDuration(d.total)}</p>
                      {SEGMENTS.map(s => {
                        const v = d[s.key];
                        if (!v) return null;
                        return (
                          <div key={s.key} className="flex items-center justify-between text-[10px] text-white/80">
                            <span className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                              {s.label}
                            </span>
                            <span>{fmtDuration(v)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div
                    className="relative flex w-full max-w-[38px] flex-col-reverse overflow-hidden rounded-lg transition-transform duration-200"
                    style={{
                      height: `${(d.total / axisMax) * 100}%`,
                      transform: isHover ? 'scaleY(1.02)' : 'scaleY(1)',
                      transformOrigin: 'bottom',
                    }}
                  >
                    {SEGMENTS.map(s => (
                      d[s.key] > 0 ? (
                        <div key={s.key} style={{ height: `${(d[s.key] / d.total) * 100}%`, background: s.color }} />
                      ) : null
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* X labels */}
      <div className="flex pl-8">
        <div className="flex flex-1 justify-around gap-2">
          {days.map(d => (
            <div key={d.date} className="flex-1 text-center text-[10px] font-medium text-[var(--text-muted)]">
              {d.label}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-center gap-4">
        {SEGMENTS.map(s => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
