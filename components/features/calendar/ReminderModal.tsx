'use client';

import { useState } from 'react';
import { X, Bell, Loader2, Trash2 } from 'lucide-react';
import { dispatchCalendarChanged } from '@/lib/calendarBus';

export interface PersonalReminder {
  id:           string;
  title:        string;
  notes:        string | null;
  remindAt:     string;          // ISO
  leadMinutes:  number | null;   // null = use user's global default
  isAllDay:     boolean;
  dismissedAt:  string | null;
}

interface Props {
  defaultDate: Date;
  /** When set, the modal opens in edit mode for this reminder */
  existing?:   PersonalReminder;
  onClose:     () => void;
  onSaved:     () => void;
}

const LEAD_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Use default', value: null },
  { label: 'At time',     value: 0    },
  { label: '5 mins',      value: 5    },
  { label: '15 mins',     value: 15   },
  { label: '30 mins',     value: 30   },
  { label: '1 hour',      value: 60   },
  { label: '1 day',       value: 1440 },
];

// For all-day reminders the notification fires at 9am local time on
// (remind_date - lead_minutes), so the lead values are days expressed in mins.
const ALL_DAY_LEAD_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Use default',       value: null    },
  { label: 'On the day (9am)',  value: 0       },
  { label: '1 day before',      value: 1440    },
  { label: '2 days before',     value: 2880    },
  { label: '1 week before',     value: 10080   },
];

function toDateValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toTimeValue(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function roundUpTo15(d: Date) {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

export default function ReminderModal({ defaultDate, existing, onClose, onSaved }: Props) {
  const isEdit = !!existing;
  const initialDate = existing ? new Date(existing.remindAt) : roundUpTo15(defaultDate);

  const [title,       setTitle]       = useState(existing?.title ?? '');
  const [isAllDay,    setIsAllDay]    = useState(existing?.isAllDay ?? false);
  const [date,        setDate]        = useState(toDateValue(initialDate));
  const [time,        setTime]        = useState(toTimeValue(initialDate));
  const [leadMinutes, setLeadMinutes] = useState<number | null>(existing?.leadMinutes ?? null);
  const [notes,       setNotes]       = useState(existing?.notes ?? '');
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim()) { setError('Please give the reminder a title.'); return; }
    setSaving(true); setError(null);
    try {
      // All-day reminders fire at 9am local time on the chosen date so the
      // banner shows up first thing in the morning rather than at midnight.
      const remindAt = isAllDay
        ? new Date(`${date}T09:00:00`).toISOString()
        : new Date(`${date}T${time}:00`).toISOString();
      const body = {
        ...(isEdit ? { id: existing!.id } : {}),
        title:       title.trim(),
        remindAt,
        leadMinutes,
        isAllDay,
        notes:       notes.trim() ? notes.trim() : null,
      };
      const res = await fetch('/api/calendar/personal-reminders', {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not save reminder.');
      }
      dispatchCalendarChanged();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    if (!confirm(`Delete reminder "${existing.title}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/calendar/personal-reminders?id=${encodeURIComponent(existing.id)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Could not delete reminder.');
      dispatchCalendarChanged();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
              <Bell size={15} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {isEdit ? 'Edit reminder' : 'New reminder'}
              </h2>
              <p className="text-[11px] text-[var(--text-muted)]">Private — only visible to you</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Submit VAT return"
              className="input-base"
              autoFocus
            />
          </div>

          {/* All-day toggle */}
          <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-nav-hover)] cursor-pointer select-none">
            <span className="text-xs font-medium text-[var(--text-secondary)]">All day</span>
            <button
              type="button"
              onClick={() => setIsAllDay(v => !v)}
              aria-label={isAllDay ? 'Disable all day' : 'Make this an all-day reminder'}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors
                ${isAllDay ? 'bg-amber-500' : 'bg-[var(--border-input)]'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                ${isAllDay ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </label>

          <div className={isAllDay ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="input-base"
              />
            </div>
            {!isAllDay && (
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                  Time
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  className="input-base"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Notify me
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(isAllDay ? ALL_DAY_LEAD_OPTIONS : LEAD_OPTIONS).map(opt => {
                const active = leadMinutes === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setLeadMinutes(opt.value)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all
                      ${active
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-content)] hover:border-amber-400 hover:text-amber-600'
                      }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
              {leadMinutes === null
                ? 'Uses your default reminder lead time from Calendar Settings.'
                : isAllDay
                  ? leadMinutes === 0
                    ? 'A banner will appear at 9am on the day.'
                    : `A banner will appear ${leadMinutes === 1440 ? '1 day' : leadMinutes === 2880 ? '2 days' : leadMinutes === 10080 ? '1 week' : `${Math.round(leadMinutes / 1440)} days`} before, at 9am.`
                  : leadMinutes === 0
                    ? 'A banner will appear at the time of the reminder.'
                    : `A banner will appear ${leadMinutes < 60 ? `${leadMinutes} minutes` : leadMinutes === 60 ? '1 hour' : leadMinutes === 1440 ? '1 day' : `${leadMinutes} mins`} before.`}
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Notes <span className="font-normal opacity-60">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything to remember?"
              rows={3}
              className="input-base resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-[var(--border)] bg-[var(--bg-nav-hover)]/40">
          <div>
            {isEdit && (
              <button
                onClick={handleDelete}
                disabled={deleting || saving}
                className="btn-secondary text-xs inline-flex items-center gap-1
                           text-red-600 dark:text-red-400 border-red-200 dark:border-red-800
                           hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                {deleting
                  ? <><Loader2 size={12} className="animate-spin" /> Deleting…</>
                  : <><Trash2 size={12} /> Delete</>}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || deleting}
              className="btn-primary text-xs inline-flex items-center gap-1.5"
            >
              {saving
                ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                : <><Bell size={12} /> {isEdit ? 'Save changes' : 'Create reminder'}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
