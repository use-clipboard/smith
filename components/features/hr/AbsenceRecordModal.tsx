'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, AlertTriangle, Stethoscope } from 'lucide-react';
import type { TeamMember } from './HrClient';
import type { AbsenceRow } from './AbsenceTab';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  candidates: TeamMember[];
  editing: AbsenceRow | null;
}

const CATEGORIES: Array<{ id: AbsenceRow['category']; label: string }> = [
  { id: 'sickness',            label: 'Sickness' },
  { id: 'unpaid_leave',        label: 'Unpaid leave' },
  { id: 'compassionate',       label: 'Compassionate leave' },
  { id: 'jury_duty',           label: 'Jury duty' },
  { id: 'medical_appointment', label: 'Medical appointment' },
  { id: 'other',               label: 'Other' },
];

export default function AbsenceRecordModal({ isOpen, onClose, onSaved, candidates, editing }: Props) {
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startHalf, setStartHalf] = useState<'full' | 'morning' | 'afternoon'>('full');
  const [endDate, setEndDate] = useState('');
  const [endHalf, setEndHalf] = useState<'full' | 'morning' | 'afternoon'>('full');
  const [category, setCategory] = useState<AbsenceRow['category']>('sickness');
  const [reason, setReason] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [pushToCalendar, setPushToCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const today = new Date().toISOString().slice(0, 10);
    if (editing) {
      setUserId(editing.user_id);
      setStartDate(editing.start_date);
      setStartHalf(editing.start_half);
      setEndDate(editing.end_date);
      setEndHalf(editing.end_half);
      setCategory(editing.category);
      setReason(editing.reason ?? '');
      setEvidenceUrl(editing.evidence_url ?? '');
      setPushToCalendar(editing.pushed_to_calendar);
    } else {
      setUserId(candidates[0]?.id ?? '');
      setStartDate(today);
      setStartHalf('full');
      setEndDate(today);
      setEndHalf('full');
      setCategory('sickness');
      setReason('');
      setEvidenceUrl('');
      setPushToCalendar(false);
    }
    setError(null);
  }, [isOpen, editing, candidates]);

  if (!isOpen) return null;

  async function handleSubmit() {
    setBusy(true); setError(null);
    try {
      const url = editing ? `/api/hr/absence/${editing.id}` : '/api/hr/absence';
      const method = editing ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        start_date: startDate,
        start_half: startHalf,
        end_date: endDate,
        end_half: startDate === endDate ? startHalf : endHalf,
        category,
        reason: reason.trim() || null,
        evidence_url: evidenceUrl.trim() || null,
      };
      if (!editing) {
        body.user_id = userId;
        body.push_to_calendar = pushToCalendar;
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={!busy ? onClose : undefined} />
      <div className="relative glass-solid rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 border border-[var(--border)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
              <Stethoscope size={18} className="text-red-700" />
            </div>
            <div>
              <h2 className="text-base font-semibold">{editing ? 'Edit absence' : 'Record absence'}</h2>
              <p className="text-xs text-[var(--text-muted)]">{editing ? '' : 'No approval flow — saved straight away.'}</p>
            </div>
          </div>
          {!busy && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"><X size={16} /></button>}
        </div>

        <div className="space-y-4">
          {!editing && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Team member</label>
              <select value={userId} onChange={e => setUserId(e.target.value)} className="input-base text-sm w-full">
                {candidates.map(c => <option key={c.id} value={c.id}>{c.full_name ?? c.email}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as AbsenceRow['category'])} className="input-base text-sm w-full">
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-base text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{startDate === endDate ? 'Length' : 'Start half'}</label>
              <select value={startHalf} onChange={e => setStartHalf(e.target.value as 'full' | 'morning' | 'afternoon')} className="input-base text-sm w-full">
                <option value="full">{startDate === endDate ? 'Full day' : 'Full day from start'}</option>
                <option value="morning">{startDate === endDate ? 'Morning only' : 'Start in the morning'}</option>
                <option value="afternoon">{startDate === endDate ? 'Afternoon only' : 'Start in the afternoon'}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} className="input-base text-sm w-full" />
            </div>
            {startDate !== endDate && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">End half</label>
                <select value={endHalf} onChange={e => setEndHalf(e.target.value as 'full' | 'morning' | 'afternoon')} className="input-base text-sm w-full">
                  <option value="full">Full last day</option>
                  <option value="morning">End in the morning</option>
                  <option value="afternoon">End in the afternoon</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Note (optional)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="e.g. Cold/flu, hospital appointment, family bereavement" className="input-base text-sm w-full" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Evidence link (optional)</label>
            <input type="url" value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} placeholder="https://… (link to fit note in Drive, etc.)" className="input-base text-sm w-full" />
          </div>

          {!editing && (
            <label className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-nav-hover)] border border-[var(--border)] cursor-pointer">
              <span className="text-sm text-[var(--text-primary)]">Add to team member&apos;s Google Calendar</span>
              <input type="checkbox" checked={pushToCalendar} onChange={e => setPushToCalendar(e.target.checked)} className="rounded" />
            </label>
          )}

          {error && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}</div>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
            <button onClick={() => void handleSubmit()} disabled={busy || !userId} className="btn-primary disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Stethoscope size={13} />}
              {editing ? 'Save' : 'Record'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
