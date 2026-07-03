'use client';

import { useState } from 'react';
import { Users, Trophy, X, Maximize2 } from 'lucide-react';
import type { StaffRow } from '@/lib/timesheets/compute';
import { GlassCard, SectionHeader, ProgressBar } from '../shared/ui';
import Avatar from '@/components/ui/Avatar';
import { useOpenProfile } from '@/components/features/team/useOpenProfile';
import { fmtDuration, fmtPct, fmtGBPCompact } from '@/lib/timesheets/format';

/** Rows above this are hidden behind a scroll / "View all" lightbox so the
 *  panel never grows unbounded on large teams. */
const MAX_VISIBLE = 5;

function capColor(util: number): string {
  if (util >= 0.95) return '#F43F5E'; // over/at the line — rose
  if (util >= 0.8) return '#10B981';  // healthy — emerald
  if (util >= 0.55) return '#F59E0B'; // light — amber
  return '#94A3B8';                    // very light — slate
}

const MEDALS = ['#F59E0B', '#94A3B8', '#B45309'];

// ─── Shared row renderers (used by both the panel and the lightbox) ───────────

function CapacityRow({ r, onOpen }: { r: StaffRow; onOpen: (id: string, name: string) => void }) {
  const util = r.capacityMinutes ? r.minutes / r.capacityMinutes : 0;
  return (
    <div className="flex items-center gap-3">
      <Avatar name={r.staff.name} avatarUrl={r.staff.avatarUrl} userId={r.staff.id} size={30} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpen(r.staff.id, r.staff.name)}
            className="min-w-0 truncate text-left text-[12.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline transition-colors"
          >
            {r.staff.name}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
            {fmtDuration(r.minutes)} <span className="opacity-50">/ {Math.round(r.capacityMinutes / 60)}h</span>
          </span>
        </div>
        <ProgressBar value={util} color={capColor(util)} />
      </div>
    </div>
  );
}

function LeaderboardRow({ r, rank, max, onOpen }: { r: StaffRow; rank: number; max: number; onOpen: (id: string, name: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-5 shrink-0 items-center justify-center">
        {rank < 3 ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: MEDALS[rank] }}>{rank + 1}</span>
        ) : (
          <span className="text-[11px] font-semibold text-[var(--text-muted)]">{rank + 1}</span>
        )}
      </div>
      <Avatar name={r.staff.name} avatarUrl={r.staff.avatarUrl} userId={r.staff.id} size={30} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpen(r.staff.id, r.staff.name)}
            className="min-w-0 truncate text-left text-[12.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline transition-colors"
          >
            {r.staff.name}
          </button>
          <span className="shrink-0 text-[12px] font-bold text-[var(--text-primary)]">{fmtGBPCompact(r.chargeablePence)}</span>
        </div>
        <ProgressBar value={r.chargeablePence / max} color={`hsl(${r.staff.hue} 70% 58%)`} height={5} />
      </div>
      <span className="w-11 shrink-0 text-right text-[10.5px] text-[var(--text-muted)]">{fmtPct(r.billablePct)} bill.</span>
    </div>
  );
}

// ─── "View all" lightbox ──────────────────────────────────────────────────────

function ListLightbox({ title, subtitle, icon, count, onClose, children }: {
  title: string; subtitle: string; icon: React.ReactNode; count: number;
  onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F0F1A]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[82vh] w-full max-w-xl flex-col rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">{icon}</div>
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">{title}</h3>
              <p className="text-[11px] text-[var(--text-muted)]">{subtitle} · {count} {count === 1 ? 'person' : 'people'}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function ViewAllButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
    >
      <Maximize2 size={11} /> View all
    </button>
  );
}

// ─── Panels ───────────────────────────────────────────────────────────────────

export function TeamCapacityPanel({ rows }: { rows: StaffRow[] }) {
  const openProfile = useOpenProfile();
  const [showAll, setShowAll] = useState(false);
  const totalLogged = rows.reduce((s, r) => s + r.minutes, 0);
  const totalCap = rows.reduce((s, r) => s + r.capacityMinutes, 0);
  const firmUtil = totalCap ? rows.reduce((s, r) => s + r.billable, 0) / totalCap : 0;
  const overflowing = rows.length > MAX_VISIBLE;

  return (
    <GlassCard>
      <SectionHeader
        title="Team capacity"
        subtitle="Logged vs contracted hours this week"
        right={
          <div className="flex items-center gap-2.5">
            {overflowing && <ViewAllButton onClick={() => setShowAll(true)} />}
            <div className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
              <Users size={13} /> {fmtPct(firmUtil)} utilised
            </div>
          </div>
        }
      />
      {/* Bounded to ~5 rows; the rest scrolls in-place (or via View all). */}
      <div
        className={`space-y-3 ${overflowing ? 'overflow-y-auto scrollbar-thin pr-1' : ''}`}
        style={overflowing ? { maxHeight: 214 } : undefined}
      >
        {rows.map(r => <CapacityRow key={r.staff.id} r={r} onOpen={openProfile} />)}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3 text-[11px]">
        <span className="text-[var(--text-muted)]">
          Firm total{overflowing ? <span className="opacity-70"> · {rows.length} people</span> : null}
        </span>
        <span className="font-semibold text-[var(--text-primary)]">{fmtDuration(totalLogged)} logged</span>
      </div>

      {showAll && (
        <ListLightbox
          title="Team capacity"
          subtitle="Logged vs contracted hours this week"
          icon={<Users size={18} />}
          count={rows.length}
          onClose={() => setShowAll(false)}
        >
          <div className="space-y-3">
            {rows.map(r => <CapacityRow key={r.staff.id} r={r} onOpen={openProfile} />)}
          </div>
        </ListLightbox>
      )}
    </GlassCard>
  );
}

export function StaffLeaderboard({ rows }: { rows: StaffRow[] }) {
  const openProfile = useOpenProfile();
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(1, ...rows.map(r => r.chargeablePence));
  const overflowing = rows.length > MAX_VISIBLE;

  return (
    <GlassCard>
      <SectionHeader
        title="Staff leaderboard"
        subtitle="Chargeable value generated this week"
        right={
          <div className="flex items-center gap-2.5">
            {overflowing && <ViewAllButton onClick={() => setShowAll(true)} />}
            <Trophy size={16} className="text-amber-500" />
          </div>
        }
      />
      <div
        className={`space-y-2.5 ${overflowing ? 'overflow-y-auto scrollbar-thin pr-1' : ''}`}
        style={overflowing ? { maxHeight: 210 } : undefined}
      >
        {rows.map((r, i) => <LeaderboardRow key={r.staff.id} r={r} rank={i} max={max} onOpen={openProfile} />)}
      </div>

      {showAll && (
        <ListLightbox
          title="Staff leaderboard"
          subtitle="Chargeable value generated this week"
          icon={<Trophy size={18} />}
          count={rows.length}
          onClose={() => setShowAll(false)}
        >
          <div className="space-y-2.5">
            {rows.map((r, i) => <LeaderboardRow key={r.staff.id} r={r} rank={i} max={max} onOpen={openProfile} />)}
          </div>
        </ListLightbox>
      )}
    </GlassCard>
  );
}
