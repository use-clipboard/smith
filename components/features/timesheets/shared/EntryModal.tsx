'use client';

import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { TimeEntry, TimeEntryType } from '@/lib/timesheets/types';
import { useTimesheets } from '../TimesheetsProvider';
import { todayIso } from '@/lib/timesheets/format';
import ClientCombobox from './ClientCombobox';

interface Props {
  /** Existing entry to edit, or a partial seed (e.g. clicked day). */
  entry?: TimeEntry | null;
  defaultDate?: string;
  onClose: () => void;
}

const TYPES: { value: TimeEntryType; label: string }[] = [
  { value: 'billable', label: 'Billable' },
  { value: 'non_billable', label: 'Non-billable' },
  { value: 'internal', label: 'Internal' },
];

export default function EntryModal({ entry, defaultDate, onClose }: Props) {
  const { clients, activities, staff, addEntry, updateEntry, deleteEntry, meId } = useTimesheets();
  const editing = !!entry;
  const me = staff.find(s => s.id === meId) ?? staff[0];

  const [clientId, setClientId] = useState<string | null>(entry?.clientId ?? null);
  const [activity, setActivity] = useState(entry?.activity ?? activities[0].label);
  const [type, setType] = useState<TimeEntryType>(entry?.type ?? 'billable');
  const [date, setDate] = useState(entry?.date ?? defaultDate ?? todayIso());
  const [start, setStart] = useState(entry?.start && entry.start !== '—' ? entry.start : '09:00');
  const [hours, setHours] = useState(entry ? Math.floor(entry.minutes / 60) : 1);
  const [mins, setMins] = useState(entry ? entry.minutes % 60 : 0);
  const [taskTitle, setTaskTitle] = useState(entry?.taskTitle ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');

  // When the picked activity changes, adopt its default type + department once.
  useEffect(() => {
    const a = activities.find(x => x.label === activity);
    if (a && !editing) setType(a.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  const totalMinutes = hours * 60 + mins;
  const client = clients.find(c => c.id === clientId) ?? null;
  const canSave = totalMinutes >= 5 && (type !== 'billable' || clientId);

  function handleSave() {
    if (!canSave) return;
    const dept = activities.find(a => a.label === activity)?.department ?? 'Accounts';
    const base = {
      userId: meId,
      date,
      start,
      clientId,
      clientName: client?.name ?? 'Internal',
      taskTitle: taskTitle || activity,
      activity,
      department: dept,
      type,
      minutes: totalMinutes,
      ratePence: type === 'billable' ? (me?.ratePence ?? 12000) : 0,
      notes,
    };
    if (editing && entry) updateEntry(entry.id, base);
    else addEntry({ ...base, source: 'manual' });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F0F1A]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h3 className="text-base font-bold text-[var(--text-primary)]">{editing ? 'Edit time entry' : 'Add time entry'}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Type */}
          <div className="inline-flex w-full gap-1 rounded-xl bg-[var(--bg-nav-hover)] p-1">
            {TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  type === t.value ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Client {type === 'billable' && <span className="text-rose-500">*</span>}</label>
              <ClientCombobox
                value={clientId}
                onChange={setClientId}
                allowNone={type !== 'billable'}
                placeholder={type === 'billable' ? 'Select client…' : 'Internal / none'}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Activity</label>
              <select className="input-base" value={activity} onChange={e => setActivity(e.target.value)}>
                {activities.map(a => <option key={a.id} value={a.label}>{a.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Task / description</label>
            <input className="input-base" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder={activity} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Date</label>
              <input type="date" className="input-base" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Start</label>
              <input type="time" className="input-base" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Duration</label>
              <div className="flex items-center gap-1">
                <select className="input-base !px-2" value={hours} onChange={e => setHours(Number(e.target.value))}>
                  {Array.from({ length: 13 }, (_, i) => <option key={i} value={i}>{i}h</option>)}
                </select>
                <select className="input-base !px-2" value={mins} onChange={e => setMins(Number(e.target.value))}>
                  {[0, 15, 30, 45].map(m => <option key={m} value={m}>{m}m</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Notes</label>
            <textarea className="input-base resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional context…" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-black/5 px-6 py-4">
          {editing ? (
            <button
              onClick={() => { if (entry) deleteEntry(entry.id); onClose(); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-rose-500 hover:bg-rose-50"
            >
              <Trash2 size={15} /> Delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={!canSave} className="btn-primary">{editing ? 'Save changes' : 'Add entry'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
