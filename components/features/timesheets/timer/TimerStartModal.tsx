'use client';

import { useState } from 'react';
import { X, Play } from 'lucide-react';
import type { TimeEntryType } from '@/lib/timesheets/types';
import { useTimesheets } from '../TimesheetsProvider';
import ClientCombobox from '../shared/ClientCombobox';

const TYPES: { value: TimeEntryType; label: string }[] = [
  { value: 'billable', label: 'Billable' },
  { value: 'non_billable', label: 'Non-billable' },
  { value: 'internal', label: 'Internal' },
];

export default function TimerStartModal({ onClose }: { onClose: () => void }) {
  const { clients, activities, startTimer } = useTimesheets();
  const [clientId, setClientId] = useState<string | null>(null);
  const [activity, setActivity] = useState(activities[0].label);
  const [type, setType] = useState<TimeEntryType>('billable');
  const [taskTitle, setTaskTitle] = useState('');
  const [notes, setNotes] = useState('');

  const client = clients.find(c => c.id === clientId) ?? null;
  const canStart = type !== 'billable' || !!clientId;

  function handleStart() {
    if (!canStart) return;
    const dept = activities.find(a => a.label === activity)?.department ?? 'Accounts';
    startTimer({
      clientId,
      clientName: client?.name ?? 'Internal',
      taskTitle: taskTitle || activity,
      activity,
      department: dept,
      type,
      notes,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F0F1A]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h3 className="text-base font-bold text-[var(--text-primary)]">Start timer</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="inline-flex w-full gap-1 rounded-xl bg-[var(--bg-nav-hover)] p-1">
            {TYPES.map(t => (
              <button key={t.value} onClick={() => setType(t.value)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${type === t.value ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                {t.label}
              </button>
            ))}
          </div>
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
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Task / description</label>
            <input className="input-base" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder={activity} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Notes</label>
            <textarea className="input-base resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-6 py-4">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleStart} disabled={!canStart} className="btn-primary"><Play size={15} /> Start timer</button>
        </div>
      </div>
    </div>
  );
}
