'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X, Clock3, Inbox, Send, RefreshCw, ChevronDown, Pencil } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { inWeek, totals, valueOf } from '@/lib/timesheets/compute';
import type { TimeEntry } from '@/lib/timesheets/types';
import { fmtDateUK, fmtHours, fmtPct, fmtDuration, fmtGBPCompact, addDays } from '@/lib/timesheets/format';
import { TYPE_COLORS } from '@/lib/timesheets/palette';
import { GlassCard, SectionHeader, ProgressBar } from '../shared/ui';
import Avatar from '@/components/ui/Avatar';
import { useOpenProfile } from '@/components/features/team/useOpenProfile';
import AdjustEntryModal, { type AdjustPatch } from './AdjustEntryModal';

export default function Approvals() {
  const { weekStatuses, staff, entries, reviewWeek, refreshWeeks, isAdmin, userId, defaultRatePence } = useTimesheets();
  const openProfile = useOpenProfile();
  const [rejecting, setRejecting] = useState<string | null>(null); // `${userId}__${weekStart}`
  const [note, setNote] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ entry: TimeEntry; ownerId: string; ownerName: string; key: string } | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [toast, setToast] = useState('');

  async function saveAdjust(patch: AdjustPatch) {
    if (!editing) return;
    setSavingAdjust(true);
    try {
      const res = await fetch(`/api/timesheets/entries/${editing.entry.id}/adjust`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed');
      const { entry: updated } = await res.json() as { entry: TimeEntry };
      setWeekEntries(prev => ({ ...prev, [editing.key]: (prev[editing.key] ?? []).map(e => (e.id === updated.id ? updated : e)) }));
      setToast(`Entry adjusted — ${editing.ownerName.split(' ')[0]} notified`);
      setEditing(null);
    } catch {
      setToast('Could not save the adjustment');
    } finally {
      setSavingAdjust(false);
      window.setTimeout(() => setToast(''), 2800);
    }
  }

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

  // Lazily fetch entries for an expanded *reviewed* (approved) week — pending
  // weeks are fetched eagerly above; reviewed ones only when opened.
  useEffect(() => {
    if (!expandedKey) return;
    const r = reviewedRows.find(x => `${x.userId}__${x.weekStart}` === expandedKey);
    if (!r || r.status !== 'approved') return;
    if (weekEntries[expandedKey] || fetchedRef.current.has(expandedKey)) return;
    if (r.userId === userId) { setWeekEntries(prev => ({ ...prev, [expandedKey]: inWeek(entries, r.weekStart, userId) })); return; }
    fetchedRef.current.add(expandedKey);
    let cancelled = false;
    fetch(`/api/timesheets/week-entries?userId=${r.userId}&weekStart=${r.weekStart}`)
      .then(res => (res.ok ? res.json() : { entries: [] }))
      .then(d => { if (!cancelled) setWeekEntries(prev => ({ ...prev, [expandedKey]: (d.entries ?? []) as TimeEntry[] })); })
      .catch(() => fetchedRef.current.delete(expandedKey));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, reviewedRows, entries, userId]);

  // Shared renderer for a week's entries with a per-entry adjust pencil.
  const renderEntries = (key: string, ownerId: string, ownerName: string) => {
    const ents = weekEntries[key];
    return (
      <div className="mt-2 space-y-0.5 rounded-xl border border-black/5 bg-black/[0.015] p-1.5">
        {!ents && <p className="py-3 text-center text-[11px] text-[var(--text-muted)]">Loading…</p>}
        {ents && ents.length === 0 && <p className="py-3 text-center text-[11px] text-[var(--text-muted)]">No entries this week.</p>}
        {ents && ents.map(e => (
          <div key={e.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/80">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TYPE_COLORS[e.type] }} />
            <span className="w-11 shrink-0 text-[10.5px] tabular-nums text-[var(--text-muted)]">{fmtDateUK(e.date).slice(0, 5)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">{e.taskTitle || e.activity || 'Work'}</p>
              <p className="truncate text-[10px] text-[var(--text-muted)]">
                {e.clientName || 'Internal'}{e.editedBy ? <span className="text-amber-600"> · adjusted</span> : null}
              </p>
            </div>
            <span className="w-12 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-[var(--text-primary)]">{fmtDuration(e.minutes)}</span>
            <span className="w-12 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--text-muted)]">{e.type === 'billable' ? fmtGBPCompact(valueOf(e)) : '—'}</span>
            <button
              onClick={() => setEditing({ entry: e, ownerId, ownerName, key })}
              className="shrink-0 rounded-lg p-1 text-[var(--text-muted)] hover:bg-black/10 hover:text-[var(--accent)]"
              aria-label="Adjust this entry"
            >
              <Pencil size={13} />
            </button>
          </div>
        ))}
      </div>
    );
  };

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

                  {/* View & adjust the underlying entries */}
                  <div className="pl-[48px]">
                    <button
                      onClick={() => setExpandedKey(k => (k === key ? null : key))}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                    >
                      <ChevronDown size={12} className={`transition-transform ${expandedKey === key ? 'rotate-180' : ''}`} />
                      {expandedKey === key ? 'Hide entries' : `View & adjust ${ents ? `${ents.length} ` : ''}entries`}
                    </button>
                    {expandedKey === key && renderEntries(key, r.userId, r.staff?.name ?? 'Team member')}
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
              const key = `${r.userId}__${r.weekStart}`;
              const canAdjust = r.status === 'approved';
              return (
                <div key={key}>
                  <div className="flex items-center gap-3 rounded-xl px-2 py-2">
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
                    {canAdjust && (
                      <button
                        onClick={() => setExpandedKey(k => (k === key ? null : key))}
                        className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                      >
                        <ChevronDown size={12} className={`transition-transform ${expandedKey === key ? 'rotate-180' : ''}`} /> Adjust
                      </button>
                    )}
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.status === 'approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                      {r.status === 'approved' ? <CheckCircle2 size={11} /> : <Send size={11} />}
                      {r.status === 'approved' ? 'Approved' : 'Returned'}
                    </span>
                  </div>
                  {canAdjust && expandedKey === key && (
                    <div className="pl-9">{renderEntries(key, r.userId, s?.name ?? 'Team member')}</div>
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {editing && (
        <AdjustEntryModal
          entry={editing.entry}
          ownerName={editing.ownerName}
          ownerRatePence={staffById.get(editing.ownerId)?.ratePence ?? defaultRatePence}
          saving={savingAdjust}
          onSave={saveAdjust}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[90] flex items-center gap-2 rounded-xl bg-[#1A1A2E] px-4 py-3 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 size={15} /> {toast}
        </div>
      )}
    </div>
  );
}
