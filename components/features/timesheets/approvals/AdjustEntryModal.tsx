'use client';

import { useState } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import type { TimeEntry, TimeEntryType } from '@/lib/timesheets/types';
import { useTimesheets } from '../TimesheetsProvider';
import ClientCombobox from '../shared/ClientCombobox';
import TaskCombobox, { type PickedTask } from '../shared/TaskCombobox';

export interface AdjustPatch {
  date: string;
  start: string;
  clientId: string | null;
  clientName: string;
  taskId: string | null;
  taskTitle: string;
  activity: string;
  department: string;
  type: TimeEntryType;
  minutes: number;
  ratePence: number;
  notes: string;
}

const TYPES: { value: TimeEntryType; label: string }[] = [
  { value: 'billable', label: 'Billable' },
  { value: 'non_billable', label: 'Non-billable' },
  { value: 'internal', label: 'Internal' },
];

/** Approver-facing editor for someone else's entry. Saves via onSave (the caller
 *  hits /entries/[id]/adjust); it does NOT touch the provider's own-entry CRUD. */
export default function AdjustEntryModal({ entry, ownerName, ownerRatePence, saving, onSave, onClose }: {
  entry: TimeEntry;
  ownerName: string;
  ownerRatePence: number;
  saving: boolean;
  onSave: (patch: AdjustPatch) => void;
  onClose: () => void;
}) {
  const { clients, activities, roundingMinutes } = useTimesheets();

  const [clientId, setClientId] = useState<string | null>(entry.clientId);
  const [taskId, setTaskId] = useState<string | null>(entry.taskId);
  const [activity, setActivity] = useState(entry.activity || activities[0].label);
  const [type, setType] = useState<TimeEntryType>(entry.type);
  const [date, setDate] = useState(entry.date);
  const [start, setStart] = useState(entry.start && entry.start !== '—' ? entry.start : '09:00');
  const [hours, setHours] = useState(Math.floor(entry.minutes / 60));
  const [mins, setMins] = useState(entry.minutes % 60);
  const [taskTitle, setTaskTitle] = useState(entry.taskTitle);
  const [notes, setNotes] = useState(entry.notes);

  const inc = Math.max(1, roundingMinutes);
  const minOptions = [...new Set([...Array.from({ length: Math.ceil(60 / inc) }, (_, i) => i * inc).filter(m => m < 60), mins])].sort((a, b) => a - b);
  const totalMinutes = hours * 60 + mins;
  const client = clients.find(c => c.id === clientId) ?? null;
  const canSave = totalMinutes >= 5 && (type !== 'billable' || !!clientId) && !saving;

  function handleSave() {
    if (!canSave) return;
    const dept = activities.find(a => a.label === activity)?.department ?? entry.department ?? 'Accounts';
    onSave({
      date, start,
      clientId,
      clientName: client?.name ?? 'Internal',
      taskId,
      taskTitle: taskTitle || activity,
      activity,
      department: dept,
      type,
      minutes: totalMinutes,
      ratePence: type === 'billable' ? ownerRatePence : 0,
      notes,
    });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F0F1A]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-[var(--text-primary)]">Adjust {ownerName}&apos;s entry</h3>
            <p className="text-[11px] text-[var(--text-muted)]">They&apos;ll be notified of the change.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] text-amber-700">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            You&apos;re editing another person&apos;s time. The change is recorded against your name and {ownerName.split(' ')[0]} is notified.
          </div>

          <div className="inline-flex w-full gap-1 rounded-xl bg-[var(--bg-nav-hover)] p-1">
            {TYPES.map(t => (
              <button key={t.value} onClick={() => setType(t.value)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${type === t.value ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Client {type === 'billable' && <span className="text-rose-500">*</span>}</label>
              <ClientCombobox value={clientId} onChange={setClientId} allowNone={type !== 'billable'} placeholder={type === 'billable' ? 'Select client…' : 'Internal / none'} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Activity</label>
              <select className="input-base" value={activity} onChange={e => setActivity(e.target.value)}>
                {activities.map(a => <option key={a.id} value={a.label}>{a.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Description</label>
            <input className="input-base" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder={activity} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Link to task</label>
            <TaskCombobox value={taskId} label={entry.taskTitle} clientId={clientId} clientName={client?.name}
              onChange={(t: PickedTask | null) => {
                setTaskId(t?.id ?? null);
                if (t) { if (t.clientId) setClientId(t.clientId); setTaskTitle(prev => prev || t.title); }
              }} />
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
                  {minOptions.map(m => <option key={m} value={m}>{m}m</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Notes</label>
            <textarea className="input-base resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional context…" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-6 py-4">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={!canSave} className="btn-primary">{saving ? 'Saving…' : 'Save adjustment'}</button>
        </div>
      </div>
    </div>
  );
}
