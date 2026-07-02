'use client';

import { Users, Trophy } from 'lucide-react';
import type { StaffRow } from '@/lib/timesheets/compute';
import { GlassCard, SectionHeader, TsAvatar, ProgressBar } from '../shared/ui';
import { fmtDuration, fmtPct, fmtGBPCompact } from '@/lib/timesheets/format';

function capColor(util: number): string {
  if (util >= 0.95) return '#F43F5E'; // over/at the line — rose
  if (util >= 0.8) return '#10B981';  // healthy — emerald
  if (util >= 0.55) return '#F59E0B'; // light — amber
  return '#94A3B8';                    // very light — slate
}

export function TeamCapacityPanel({ rows }: { rows: StaffRow[] }) {
  const totalLogged = rows.reduce((s, r) => s + r.minutes, 0);
  const totalCap = rows.reduce((s, r) => s + r.capacityMinutes, 0);
  const firmUtil = totalCap ? rows.reduce((s, r) => s + r.billable, 0) / totalCap : 0;

  return (
    <GlassCard>
      <SectionHeader
        title="Team capacity"
        subtitle="Logged vs contracted hours this week"
        right={
          <div className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
            <Users size={13} /> {fmtPct(firmUtil)} utilised
          </div>
        }
      />
      <div className="space-y-3">
        {rows.map(r => {
          const util = r.capacityMinutes ? r.minutes / r.capacityMinutes : 0;
          return (
            <div key={r.staff.id} className="flex items-center gap-3">
              <TsAvatar name={r.staff.name} hue={r.staff.hue} size={30} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{r.staff.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                    {fmtDuration(r.minutes)} <span className="opacity-50">/ {Math.round(r.capacityMinutes / 60)}h</span>
                  </span>
                </div>
                <ProgressBar value={util} color={capColor(util)} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3 text-[11px]">
        <span className="text-[var(--text-muted)]">Firm total</span>
        <span className="font-semibold text-[var(--text-primary)]">{fmtDuration(totalLogged)} logged</span>
      </div>
    </GlassCard>
  );
}

const MEDALS = ['#F59E0B', '#94A3B8', '#B45309'];

export function StaffLeaderboard({ rows }: { rows: StaffRow[] }) {
  const top = rows.slice(0, 6);
  const max = Math.max(1, ...top.map(r => r.chargeablePence));

  return (
    <GlassCard>
      <SectionHeader
        title="Staff leaderboard"
        subtitle="Chargeable value generated this week"
        right={<Trophy size={16} className="text-amber-500" />}
      />
      <div className="space-y-2.5">
        {top.map((r, i) => (
          <div key={r.staff.id} className="flex items-center gap-3">
            <div className="flex w-5 shrink-0 items-center justify-center">
              {i < 3 ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: MEDALS[i] }}>{i + 1}</span>
              ) : (
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">{i + 1}</span>
              )}
            </div>
            <TsAvatar name={r.staff.name} hue={r.staff.hue} size={30} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{r.staff.name}</span>
                <span className="shrink-0 text-[12px] font-bold text-[var(--text-primary)]">{fmtGBPCompact(r.chargeablePence)}</span>
              </div>
              <ProgressBar value={r.chargeablePence / max} color={`hsl(${r.staff.hue} 70% 58%)`} height={5} />
            </div>
            <span className="w-11 shrink-0 text-right text-[10.5px] text-[var(--text-muted)]">{fmtPct(r.billablePct)} bill.</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
