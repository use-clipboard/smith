'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X, Clock3, Inbox, Send, RefreshCw } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { inWeek, totals } from '@/lib/timesheets/compute';
import type { TimeEntry } from '@/lib/timesheets/types';
import { fmtDateUK, fmtHours, fmtPct, addDays } from '@/lib/timesheets/format';
import { GlassCard, SectionHeader, ProgressBar } from '../shared/ui';
import Avatar from '@/components/ui/Avatar';
import { useOpenProfile } from '@/components/features/team/useOpenProfile';

export default function Approvals() {
  const { weekStatuses, staff, entries, reviewWeek, refreshWeeks, isAdmin, userId } = useTimesheets();
  const openProfile = useOpenProfile();
  const [rejecting, setRejecting] = useState<string | null>(null); // `${userId}__${weekStart}`
  const [note, setNote] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // The provider loads week statuses once on mount, but the Timesheets tab stays
  // mounted for the whole session — so a teammate's later submission wouldn't show
  // until a hard refresh. Re-pull whenever this view is opened.
  useEffect(() => { void refreshWeeks(); }, [refreshWeeks]);

  async function manualRefresh() {
    setRefreshing(true);
    try { await refreshWeeks(); } finally { setRefreshing(false); }
  }

  const staffById = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff]);

  // Admins see everything (incl. weeks with no manager — the fallback);
  // managers see only weeks routed to them.
  const mine = (w: { managerId: string | null }) => isAdmin || w.managerId === userId;

  const rows = useMemo(() => {
    return Object.values(weekStatuses)
      .filter(w => w.status === 'submitted' && mine(w))
      .map(w => ({ ...w, staff: staffById.get(w.userId) }))
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStatuses, staffById, isAdmin, userId]);

  // The normal entries feed is RLS-scoped to the current user, so a submitter's
  // hours aren't in `entries`. Fetch each pending week's entries (permission-
  // checked server-side) so the approver sees real hours, not zeros. Own weeks
  // use the already-loaded local entries.
  const [weekEntries, setWeekEntries] = useState<Record<string, TimeEntry[]>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    for (const r of rows) {
      const key = `${r.userId}__${r.weekStart}`;
      if (r.userId === userId) {
        setWeekEntries(prev => ({ ...prev, [key]: inWeek(entries, r.weekStart, userId) }));
        continue;
      }
      if (fetchedRef.current.has(key)) continue;
      fetchedRef.current.add(key);
      fetch(`/api/timesheets/week-entries?userId=${r.userId}&weekStart=${r.weekStart}`)
        .then(res => (res.ok ? res.json() : { entries: [] }))
        .then(d => { if (!cancelled) setWeekEntries(prev => ({ ...prev, [key]: (d.entries ?? []) as TimeEntry[] })); })
        .catch(() => { fetchedRef.current.delete(key); });
    }
    return () => { cancelled = true; };
  }, [rows, entries, userId]);

  const reviewedRows = useMemo(() => {
    return Object.values(weekStatuses)
      .filter(w => (w.status === 'approved' || w.status === 'rejected') && mine(w))
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStatuses, isAdmin, userId]);

  function doReject(userId: string, weekStart: string) {
    reviewWeek(userId, weekStart, 'reject', note.trim() || undefined);
    setRejecting(null);
    setNote('');
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <GlassCard>
        <SectionHeader
          title="Timesheet approvals"
          subtitle={isAdmin ? 'Weeks submitted by the team — including any without a manager set.' : 'Weeks submitted by the people who report to you.'}
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={manualRefresh}
                disabled={refreshing}
                aria-label="Refresh pending approvals"
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold text-[var(--text-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--text-secondary)] disabled:opacity-50"
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
              </button>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-600">
                <Clock3 size={13} /> {rows.length} pending
              </span>
            </div>
          }
        />

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"><Inbox size={22} /></div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Nothing to approve</p>
            <p className="max-w-xs text-xs text-[var(--text-muted)]">Submitted weeks from your team will appear here for one-click approval.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map(r => {
              const key = `${r.userId}__${r.weekStart}`;
              const isRejecting = rejecting === key;
              const ents = weekEntries[key];
              const t = ents ? totals(ents) : null;
              return (
                <div key={key} className="rounded-2xl border border-black/5 bg-white/60 p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.staff?.name ?? 'Team member'} avatarUrl={r.staff?.avatarUrl} userId={r.staff?.id} size={36} />
                    <div className="min-w-0 flex-1">
                      {r.staff?.id ? (
                        <button
                          type="button"
                          onClick={() => openProfile(r.staff!.id, r.staff!.name)}
                          className="block max-w-full truncate text-left text-[13.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline transition-colors"
                        >
                          {r.staff.name}
                        </button>
                      ) : (
                        <p className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">Team member</p>
                      )}
                      <p className="text-[11px] text-[var(--text-muted)]">Week of {fmtDateUK(r.weekStart)} – {fmtDateUK(addDays(r.weekStart, 6))}</p>
                    </div>
                    <div className="hidden text-right sm:block">
                      {t ? (
                        <>
                          <p className="text-[13px] font-bold text-[var(--text-primary)]">{fmtHours(t.total)}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{fmtPct(t.billablePct)} billable</p>
                        </>
                      ) : (
                        <p className="text-[11px] text-[var(--text-muted)]">Loading…</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => reviewWeek(r.userId, r.weekStart, 'approve')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-600"
                      >
                        <CheckCircle2 size={15} /> Approve
                      </button>
                      <button
                        onClick={() => { setRejecting(isRejecting ? null : key); setNote(''); }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-black/5 px-3 py-2 text-[12.5px] font-semibold text-[var(--text-secondary)] hover:bg-black/10"
                      >
                        <X size={15} /> Reject
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 pl-[48px]">
                    <ProgressBar value={t?.billablePct ?? 0} color="#10B981" height={5} />
                  </div>
                  {isRejecting && (
                    <div className="mt-3 flex items-center gap-2 pl-[48px]">
                      <input
                        autoFocus value={note} onChange={e => setNote(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') doReject(r.userId, r.weekStart); }}
                        placeholder="Reason (optional) — sent back to the team member"
                        className="input-base !py-1.5 flex-1"
                      />
                      <button onClick={() => doReject(r.userId, r.weekStart)} className="btn-primary !bg-rose-500 hover:!bg-rose-600">Send back</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {reviewedRows.length > 0 && (
        <GlassCard>
          <SectionHeader title="Recently reviewed" subtitle="Latest approvals and returns" />
          <div className="space-y-1.5">
            {reviewedRows.map(r => {
              const s = staffById.get(r.userId);
              return (
                <div key={`${r.userId}__${r.weekStart}`} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <Avatar name={s?.name ?? 'Team member'} avatarUrl={s?.avatarUrl} userId={s?.id} size={28} />
                  {s?.id ? (
                    <button
                      type="button"
                      onClick={() => openProfile(s.id, s.name)}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline transition-colors"
                    >
                      {s.name}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">Team member</span>
                  )}
                  <span className="text-[11px] text-[var(--text-muted)]">Week of {fmtDateUK(r.weekStart)}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {r.status === 'approved' ? <CheckCircle2 size={11} /> : <Send size={11} />}
                    {r.status === 'approved' ? 'Approved' : 'Returned'}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
