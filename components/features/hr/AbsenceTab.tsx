'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Plus, Loader2, Filter, Calendar as CalIcon, Edit3, Trash2, Check, X,
  AlertTriangle, ClipboardCheck, FileText, Heart, Scale, Stethoscope,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import AbsenceRecordModal from './AbsenceRecordModal';
import type { TeamMember } from './HrClient';

interface Props {
  userId: string;
  userRole: 'admin' | 'staff';
  team: TeamMember[];
}

// Local row type — server returns nested users via the same join shape we
// use elsewhere.
export interface AbsenceRow {
  id: string;
  user_id: string;
  manager_id: string | null;
  recorded_by: string | null;
  start_date: string;
  start_half: 'full' | 'morning' | 'afternoon';
  end_date: string;
  end_half: 'full' | 'morning' | 'afternoon';
  total_days: number;
  category: 'sickness' | 'unpaid_leave' | 'compassionate' | 'jury_duty' | 'medical_appointment' | 'other';
  reason: string | null;
  evidence_url: string | null;
  return_to_work_done: boolean;
  return_to_work_notes: string | null;
  pushed_to_calendar: boolean;
  created_at: string;
  user: { id: string; full_name: string | null; email: string } | null;
  recorder: { id: string; full_name: string | null; email: string } | null;
}

const CATEGORY_LABELS: Record<AbsenceRow['category'], string> = {
  sickness: 'Sickness',
  unpaid_leave: 'Unpaid leave',
  compassionate: 'Compassionate',
  jury_duty: 'Jury duty',
  medical_appointment: 'Medical appointment',
  other: 'Other',
};

const CATEGORY_BADGE: Record<AbsenceRow['category'], string> = {
  sickness:           'bg-red-100 text-red-700',
  unpaid_leave:       'bg-gray-100 text-gray-700',
  compassionate:      'bg-rose-100 text-rose-700',
  jury_duty:          'bg-purple-100 text-purple-700',
  medical_appointment:'bg-sky-100 text-sky-700',
  other:              'bg-slate-100 text-slate-700',
};

const CATEGORY_ICON: Record<AbsenceRow['category'], React.ElementType> = {
  sickness:            Stethoscope,
  unpaid_leave:        FileText,
  compassionate:       Heart,
  jury_duty:           Scale,
  medical_appointment: Stethoscope,
  other:               Activity,
};

function fmtSpan(r: AbsenceRow): string {
  const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  return r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} → ${fmt(r.end_date)}`;
}

/**
 * Bradford Factor: B = S² × D
 *   S = number of separate sickness instances in the rolling 52-week window
 *   D = total sickness days lost in that window
 * Common interpretation thresholds are firm-specific; we just surface the number.
 * Excludes non-sickness categories (jury duty, compassionate, etc.).
 */
function computeBradford(rows: AbsenceRow[], windowMs: number = 52 * 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - windowMs;
  const sickness = rows.filter(r => r.category === 'sickness' && new Date(r.start_date).getTime() >= cutoff);
  const S = sickness.length;
  const D = sickness.reduce((acc, r) => acc + Number(r.total_days || 0), 0);
  return Math.round(S * S * D);
}

export default function AbsenceTab({ userId, userRole, team }: Props) {
  const [scope, setScope] = useState<'mine' | 'team' | 'all'>('mine');
  const [categoryFilter, setCategoryFilter] = useState<'' | AbsenceRow['category']>('');
  const [records, setRecords] = useState<AbsenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AbsenceRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Direct-entry candidates (people the caller manages, or all firm if admin).
  const candidates = useMemo(() => {
    if (userRole === 'admin') return team.filter(m => m.id !== userId);
    return team.filter(m => m.manager_id === userId);
  }, [team, userId, userRole]);
  const canRecord = candidates.length > 0;

  // The default scope: staff start with 'mine'; managers start with 'team'.
  const isManagerOfSomeone = team.some(m => m.manager_id === userId);
  useEffect(() => {
    if (isManagerOfSomeone || userRole === 'admin') setScope('team');
  }, [isManagerOfSomeone, userRole]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ scope });
    if (categoryFilter) params.set('category', categoryFilter);
    try {
      const res = await fetch(`/api/hr/absence?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      const data = await res.json();
      setRecords(data.records ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [scope, categoryFilter]);
  useEffect(() => { void load(); }, [load]);

  // Bradford only really makes sense per individual. We compute it across the
  // currently-shown records and label it accordingly.
  const bradford = useMemo(() => computeBradford(records), [records]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this absence record? Admins only.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/absence/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusyId(null); }
  }

  async function handleToggleRTW(r: AbsenceRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/hr/absence/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_to_work_done: !r.return_to_work_done }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed');
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {(isManagerOfSomeone || userRole === 'admin') && (
            <div className="inline-flex bg-white border border-[var(--border)] rounded-full p-0.5 text-xs">
              {(['mine', 'team', ...(userRole === 'admin' ? ['all' as const] : [])] as ('mine' | 'team' | 'all')[]).map(s => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1 rounded-full transition-colors ${scope === s ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
                >
                  {s === 'mine' ? 'Mine' : s === 'team' ? 'My team' : 'Whole firm'}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-[var(--text-muted)]" />
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as '' | AbsenceRow['category'])} className="input-base text-xs h-8">
              <option value="">All categories</option>
              {(Object.keys(CATEGORY_LABELS) as AbsenceRow['category'][]).map(k => (
                <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>
        {canRecord && (
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-primary inline-flex items-center gap-2">
            <Plus size={13} /> Record absence
          </button>
        )}
      </div>

      {/* Bradford Factor (only relevant when viewing one person's records or all-sickness) */}
      {records.some(r => r.category === 'sickness') && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-nav-hover)] border border-[var(--border)]">
          <div className="h-9 w-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
            <Activity size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--text-secondary)]">Bradford Factor (rolling 52 weeks)</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">B = S² × D, where S is separate sickness instances and D is total sickness days. Useful as an attendance signal — interpret in context.</p>
          </div>
          <span className="text-2xl font-bold text-amber-700 tabular-nums">{bradford}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>
      ) : records.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-[var(--border)]">
          <CalIcon size={24} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">No absence records to show.</p>
        </div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {records.map(r => {
            const Icon = CATEGORY_ICON[r.category];
            const isManagerOfRow = r.manager_id === userId;
            const canEdit = isManagerOfRow || userRole === 'admin';
            const canDelete = userRole === 'admin';
            return (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                {scope !== 'mine' && r.user && (
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarColour(r.user.id)}`}>
                    {initials(r.user.full_name, r.user.email)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {scope !== 'mine' && r.user && (
                      <span className="text-sm font-medium text-[var(--text-primary)]">{r.user.full_name ?? r.user.email}</span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${CATEGORY_BADGE[r.category]}`}>
                      <Icon size={10} />{CATEGORY_LABELS[r.category]}
                    </span>
                    {r.pushed_to_calendar && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">on calendar</span>}
                    {r.category === 'sickness' && (
                      <Tooltip label={r.return_to_work_done ? 'Return-to-work done' : 'Return-to-work pending'}>
                        <button
                          onClick={() => canEdit && handleToggleRTW(r)}
                          disabled={!canEdit || busyId === r.id}
                          className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            r.return_to_work_done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                          } ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                        >
                          <ClipboardCheck size={9} />RTW {r.return_to_work_done ? 'done' : 'pending'}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mt-0.5">{fmtSpan(r)} · <span className="font-medium">{r.total_days}</span> day{r.total_days === 1 ? '' : 's'}</p>
                  {r.reason && <p className="text-xs text-[var(--text-muted)] mt-0.5 italic">&ldquo;{r.reason}&rdquo;</p>}
                  {r.evidence_url && (
                    <a href={r.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] hover:underline mt-0.5 inline-flex items-center gap-1"><FileText size={11} />Evidence</a>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {canEdit && (
                    <Tooltip label="Edit">
                      <button onClick={() => { setEditing(r); setModalOpen(true); }} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                    </Tooltip>
                  )}
                  {canDelete && (
                    <Tooltip label="Delete (admin)">
                      <button onClick={() => void handleDelete(r.id)} disabled={busyId === r.id} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50">
                        {busyId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AbsenceRecordModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={() => { setModalOpen(false); setEditing(null); void load(); }}
        candidates={candidates}
        editing={editing}
      />
    </div>
  );
}
