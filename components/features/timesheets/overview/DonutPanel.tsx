'use client';

import { ReactNode } from 'react';
import DonutChart from '../charts/DonutChart';
import { GlassCard, SectionHeader } from '../shared/ui';
import { fmtDuration, fmtHours } from '@/lib/timesheets/format';

export interface DonutRow {
  id: string;
  label: string;
  minutes: number;
  color: string;
}

export default function DonutPanel({
  title, subtitle, rows, centerLabel, right,
}: {
  title: string;
  subtitle?: string;
  rows: DonutRow[];
  centerLabel: string;
  right?: ReactNode;
}) {
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  return (
    <GlassCard>
      <SectionHeader title={title} subtitle={subtitle} right={right} />
      <div className="flex items-center gap-5">
        <DonutChart
          size={168}
          thickness={24}
          slices={rows.map(r => ({ id: r.id, label: r.label, value: r.minutes, color: r.color }))}
          centerTitle={centerLabel}
          centerValue={fmtHours(total)}
          formatValue={fmtDuration}
        />
        <div className="min-w-0 flex-1 space-y-2">
          {rows.slice(0, 6).map(r => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">{r.label}</span>
              <span className="shrink-0 text-[12px] font-semibold text-[var(--text-primary)]">{fmtDuration(r.minutes)}</span>
              <span className="w-9 shrink-0 text-right text-[10.5px] text-[var(--text-muted)]">
                {total ? Math.round((r.minutes / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
