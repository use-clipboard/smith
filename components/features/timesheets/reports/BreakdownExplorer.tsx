'use client';

import { useMemo, useState } from 'react';
import type { TimeEntry, TsStaff } from '@/lib/timesheets/types';
import { groupTree, valueOf, type GroupDim } from '@/lib/timesheets/compute';
import { fmtDuration, fmtPct, fmtGBPCompact } from '@/lib/timesheets/format';
import { colorAt } from '@/lib/timesheets/palette';
import BreakdownTree from './BreakdownTree';

const PRESETS: { id: string; label: string; dims: GroupDim[] }[] = [
  { id: 'client-staff-task', label: 'Client › Staff › Task', dims: ['client', 'staff', 'task'] },
  { id: 'staff-client-task', label: 'Staff › Client › Task', dims: ['staff', 'client', 'task'] },
  { id: 'client-task-staff', label: 'Client › Task › Staff', dims: ['client', 'task', 'staff'] },
  { id: 'task-staff',        label: 'Task › Staff',         dims: ['task', 'staff'] },
  { id: 'department-staff-client', label: 'Department › Staff › Client', dims: ['department', 'staff', 'client'] },
  { id: 'staff-activity',    label: 'Staff › Activity',     dims: ['staff', 'activity'] },
];

export default function BreakdownExplorer({ entries, staff }: { entries: TimeEntry[]; staff: TsStaff[] }) {
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const preset = PRESETS.find(p => p.id === presetId) ?? PRESETS[0];

  const staffName = useMemo(() => {
    const m = new Map(staff.map(s => [s.id, s.name]));
    return (id: string) => m.get(id) ?? 'Unknown';
  }, [staff]);

  const nodes = useMemo(() => groupTree(entries, preset.dims, staffName), [entries, preset.dims, staffName]);

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
  const billableMinutes = entries.reduce((s, e) => s + (e.type === 'billable' ? e.minutes : 0), 0);
  const totalValue = entries.reduce((s, e) => s + valueOf(e), 0);

  return (
    <div className="space-y-4">
      {/* Group-by + totals */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Group by</span>
          <select
            value={presetId}
            onChange={e => setPresetId(e.target.value)}
            className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--text-primary)] outline-none"
          >
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="flex gap-5">
          <div className="text-right">
            <p className="text-[15px] font-bold text-[var(--text-primary)] tabular-nums">{fmtDuration(totalMinutes)}</p>
            <p className="text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Total</p>
          </div>
          <div className="text-right">
            <p className="text-[15px] font-bold text-[var(--text-primary)] tabular-nums">{fmtPct(totalMinutes ? billableMinutes / totalMinutes : 0)}</p>
            <p className="text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Billable</p>
          </div>
          <div className="text-right">
            <p className="text-[15px] font-bold text-[var(--text-primary)] tabular-nums">{fmtGBPCompact(totalValue)}</p>
            <p className="text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Fees</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-muted)]">
        Click any row to drill in — from {preset.label.toLowerCase()} down to the individual time entries.
      </p>

      <BreakdownTree nodes={nodes} colorFor={colorAt} />
    </div>
  );
}
