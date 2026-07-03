'use client';

import { useState } from 'react';
import { Info, Lock } from 'lucide-react';
import type { TsStaff } from '@/lib/timesheets/types';
import { useTimesheets } from '../TimesheetsProvider';
import { GlassCard, SectionHeader, TsAvatar } from '../shared/ui';
import { fmtGBP } from '@/lib/timesheets/format';

function RateRow({ s, editable, deptOptions, onCommit }: {
  s: TsStaff;
  editable: boolean;
  deptOptions: string[];
  onCommit: (patch: { ratePence?: number; weeklyCapacityHours?: number; department?: string }) => void;
}) {
  const [rate, setRate] = useState(String(Math.round(s.ratePence / 100)));
  const [cap, setCap] = useState(String(s.weeklyCapacityHours));

  const commitRate = () => {
    const pounds = Math.max(0, Math.round(Number(rate) || 0));
    setRate(String(pounds));
    if (pounds * 100 !== s.ratePence) onCommit({ ratePence: pounds * 100 });
  };
  const commitCap = () => {
    const hrs = Math.max(0, Math.min(168, Number(cap) || 0));
    setCap(String(hrs));
    if (hrs !== s.weeklyCapacityHours) onCommit({ weeklyCapacityHours: hrs });
  };

  const weeklyValue = Math.round((s.weeklyCapacityHours) * s.ratePence);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white/60 px-3 py-2.5">
      <TsAvatar name={s.name} hue={s.hue} size={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{s.name}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{s.role}</p>
      </div>

      {/* Department */}
      <div className="hidden shrink-0 md:block">
        <label className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Department</label>
        <select
          value={deptOptions.includes(s.department) ? s.department : 'Unassigned'}
          disabled={!editable}
          onChange={e => onCommit({ department: e.target.value })}
          className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2 py-1 text-[12.5px] font-medium text-[var(--text-primary)] outline-none disabled:opacity-60"
        >
          {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Rate £/hr */}
      <div className="shrink-0">
        <label className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Rate / hr</label>
        <div className="flex items-center rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2 py-1">
          <span className="text-[12px] text-[var(--text-muted)]">£</span>
          <input
            type="number" min={0} step={5} value={rate} disabled={!editable}
            onChange={e => setRate(e.target.value)}
            onBlur={commitRate}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-14 bg-transparent text-right text-[13px] font-semibold text-[var(--text-primary)] outline-none disabled:opacity-60"
          />
        </div>
      </div>

      {/* Capacity h/wk */}
      <div className="shrink-0">
        <label className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Capacity / wk</label>
        <div className="flex items-center rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2 py-1">
          <input
            type="number" min={0} max={168} step={0.5} value={cap} disabled={!editable}
            onChange={e => setCap(e.target.value)}
            onBlur={commitCap}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-12 bg-transparent text-right text-[13px] font-semibold text-[var(--text-primary)] outline-none disabled:opacity-60"
          />
          <span className="text-[12px] text-[var(--text-muted)]">h</span>
        </div>
      </div>

      {/* Weekly value at capacity */}
      <div className="hidden w-24 shrink-0 text-right sm:block">
        <label className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-[var(--text-muted)]">Weekly value</label>
        <p className="text-[13px] font-bold text-[var(--text-primary)]">{fmtGBP(weeklyValue)}</p>
      </div>

      {!editable && <Lock size={13} className="shrink-0 text-[var(--text-muted)]" />}
    </div>
  );
}

export default function RatesSettings() {
  const { staff, meId, isAdmin, updateStaffRate, mode, departments } = useTimesheets();
  const deptOptions = [...departments, 'Unassigned'];

  const totalWeekly = staff.reduce((sum, s) => sum + Math.round(s.weeklyCapacityHours * s.ratePence), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <GlassCard>
        <SectionHeader
          title="Team, rates & capacity"
          subtitle="Department, standard hourly rate and contracted weekly hours per person — these drive utilisation, chargeable value, recovery, the department split and the leaderboard."
        />

        <div className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-[12px] ${
          mode === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-[var(--accent)]/20 bg-[var(--accent)]/[0.06] text-[var(--text-secondary)]'
        }`}>
          <Info size={15} className="mt-0.5 shrink-0" />
          <p>
            {mode === 'demo'
              ? 'Demo mode — changes are saved locally on this device only. Apply the Timesheets migration to store rates firm-wide.'
              : isAdmin
                ? 'As an admin you can set rates and capacity for the whole team. Changes save instantly.'
                : 'You can edit your own rate and capacity. Ask an admin to change other team members.'}
          </p>
        </div>

        <div className="space-y-2">
          {staff.map(s => (
            <RateRow
              key={s.id}
              s={s}
              editable={isAdmin || s.id === meId}
              deptOptions={deptOptions}
              onCommit={patch => updateStaffRate(s.id, patch)}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
          <span className="text-[12px] text-[var(--text-muted)]">Total team capacity value / week</span>
          <span className="text-[15px] font-bold text-[var(--text-primary)]">{fmtGBP(totalWeekly)}</span>
        </div>
      </GlassCard>
    </div>
  );
}
