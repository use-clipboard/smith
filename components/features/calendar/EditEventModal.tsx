'use client';

import { useState, useMemo } from 'react';
import { X, CalendarDays, Loader2, Eye, EyeOff, UserPlus, Check, ExternalLink } from 'lucide-react';
import { dispatchCalendarChanged } from '@/lib/calendarBus';

interface Attendee { email: string; name?: string }

interface EditableEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: Attendee[];
  htmlLink?: string;
  meetLink?: string;
  isHidden?: boolean;
  ownerUserId?: string;
}

interface Props {
  event: EditableEvent;
  onClose: () => void;
  onSaved: () => void;
  isAdmin?: boolean;
  currentUserId?: string;
}

// ── Shared helpers (mirrors CreateEventModal) ────────────────────────────────

function toDateValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toTimeValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** Snap minutes to nearest 15-min boundary */
function snapTo15(d: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateValue(d);
}

interface TimeSlot { value: string; label: string }
function buildTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const period = h < 12 ? 'am' : 'pm';
      const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push({ value, label: `${dh}:${String(m).padStart(2, '0')}${period}` });
    }
  }
  return slots;
}
const TIME_SLOTS = buildTimeSlots();

function durLabel(mins: number): string {
  if (mins <= 0 || mins > 12 * 60) return '';
  if (mins < 60) return ` (${mins} mins)`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? ` (${h} hr${h !== 1 ? 's' : ''})` : ` (${h} hr ${m} mins)`;
}

const TIMEZONES = [
  { value: 'Europe/London',        label: 'London (GMT/BST)' },
  { value: 'Europe/Dublin',        label: 'Dublin (GMT/IST)' },
  { value: 'Europe/Paris',         label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin',        label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Rome',          label: 'Rome (CET/CEST)' },
  { value: 'Europe/Madrid',        label: 'Madrid (CET/CEST)' },
  { value: 'Europe/Amsterdam',     label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/Zurich',        label: 'Zurich (CET/CEST)' },
  { value: 'Europe/Stockholm',     label: 'Stockholm (CET/CEST)' },
  { value: 'America/New_York',     label: 'New York (ET)' },
  { value: 'America/Chicago',      label: 'Chicago (CT)' },
  { value: 'America/Denver',       label: 'Denver (MT)' },
  { value: 'America/Los_Angeles',  label: 'Los Angeles (PT)' },
  { value: 'America/Toronto',      label: 'Toronto (ET)' },
  { value: 'America/Vancouver',    label: 'Vancouver (PT)' },
  { value: 'America/Sao_Paulo',    label: 'São Paulo (BRT)' },
  { value: 'Asia/Dubai',           label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata',         label: 'India (IST)' },
  { value: 'Asia/Singapore',       label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo',           label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai',        label: 'Shanghai (CST)' },
  { value: 'Asia/Hong_Kong',       label: 'Hong Kong (HKT)' },
  { value: 'Asia/Seoul',           label: 'Seoul (KST)' },
  { value: 'Australia/Sydney',     label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne',  label: 'Melbourne (AEST/AEDT)' },
  { value: 'Pacific/Auckland',     label: 'Auckland (NZST/NZDT)' },
  { value: 'UTC',                  label: 'UTC' },
];

const REPEAT_OPTIONS = [
  { value: 'none',         label: 'Does not repeat' },
  { value: 'FREQ=DAILY',   label: 'Every day' },
  { value: 'FREQ=WEEKLY',  label: 'Every week' },
  { value: 'FREQ=MONTHLY', label: 'Every month' },
  { value: 'FREQ=YEARLY',  label: 'Every year' },
];

// ── Parse existing event into form state ─────────────────────────────────────

function initFromEvent(event: EditableEvent) {
  const existingIsAllDay = !event.start.includes('T');

  let startDate: string, startTime: string, endDate: string, endTime: string;

  if (existingIsAllDay) {
    startDate = event.start;
    startTime = '09:00';
    // Google all-day end is exclusive — show the day before as the "last day"
    const rawEnd = new Date(`${event.end}T00:00:00`);
    rawEnd.setDate(rawEnd.getDate() - 1);
    endDate = toDateValue(rawEnd);
    endTime = '10:00';
  } else {
    const sd = snapTo15(new Date(event.start));
    const ed = snapTo15(new Date(event.end));
    startDate = toDateValue(sd);
    startTime = toTimeValue(sd);
    endDate   = toDateValue(ed);
    endTime   = toTimeValue(ed);
  }

  const browserTz = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'Europe/London';
  const timezone = TIMEZONES.find(tz => tz.value === browserTz)?.value ?? 'Europe/London';

  return { existingIsAllDay, startDate, startTime, endDate, endTime, timezone };
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditEventModal({ event, onClose, onSaved, isAdmin, currentUserId }: Props) {
  const init = initFromEvent(event);
  const isOwnEvent = !currentUserId || event.ownerUserId === currentUserId;

  const [title,       setTitle]       = useState(event.title);
  const [isAllDay,    setIsAllDay]    = useState(init.existingIsAllDay);
  const [startDate,   setStartDate]   = useState(init.startDate);
  const [startTime,   setStartTime]   = useState(init.startTime);
  const [endDate,     setEndDate]     = useState(init.endDate);
  const [endTime,     setEndTime]     = useState(init.endTime);
  const [timezone,    setTimezone]    = useState(init.timezone);
  const [repeat,      setRepeat]      = useState('none');
  const [location,    setLocation]    = useState(event.location ?? '');
  const [description, setDescription] = useState(event.description ?? '');
  const [isHidden,      setIsHidden]      = useState(event.isHidden ?? false);
  const [addGoogleMeet, setAddGoogleMeet] = useState(false);
  // Start with existing attendees (excluding self)
  const [attendees,     setAttendees]     = useState<string[]>(
    (event.attendees ?? []).map(a => a.email).filter(Boolean)
  );
  const [attendeeInput, setAttendeeInput] = useState('');
  const [savingVis,     setSavingVis]     = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  function addAttendee(email: string) {
    const e = email.trim().toLowerCase();
    if (e && isValidEmail(e) && !attendees.includes(e)) setAttendees(prev => [...prev, e]);
    setAttendeeInput('');
  }
  function removeAttendee(email: string) { setAttendees(prev => prev.filter(e => e !== email)); }
  function handleAttendeeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAttendee(attendeeInput); }
    else if (e.key === 'Backspace' && !attendeeInput && attendees.length > 0) setAttendees(prev => prev.slice(0, -1));
  }

  // End-time options with duration labels
  const endTimeOptions = useMemo<TimeSlot[]>(() => {
    if (startDate !== endDate) return TIME_SLOTS;
    const [sh, sm] = startTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    return TIME_SLOTS.map(slot => {
      const [eh, em] = slot.value.split(':').map(Number);
      const d = eh * 60 + em - startMins;
      return d > 0 ? { ...slot, label: slot.label + durLabel(d) } : slot;
    });
  }, [startTime, startDate, endDate]);

  function handleStartTimeChange(val: string) {
    setStartTime(val);
    if (startDate === endDate) {
      const [sh, sm] = val.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (eh * 60 + em <= sh * 60 + sm) {
        const next = new Date(2000, 0, 1, sh, sm + 60);
        const nh = next.getHours(), nm = next.getMinutes();
        if (nh < sh) setEndDate(addDays(endDate, 1));
        setEndTime(`${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`);
      }
    }
  }

  /** Toggle hidden from within the edit modal — saves immediately */
  async function handleToggleVisibility() {
    setSavingVis(true);
    const newHidden = !isHidden;
    try {
      const res = await fetch('/api/calendar/events/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, hidden: newHidden }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to update visibility');
      }
      setIsHidden(newHidden);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility');
    } finally {
      setSavingVis(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      let startISO: string, endISO: string;

      if (isAllDay) {
        startISO = startDate;
        endISO   = addDays(endDate, 1); // Google all-day end is exclusive
      } else {
        startISO = new Date(`${startDate}T${startTime}:00`).toISOString();
        endISO   = new Date(`${endDate}T${endTime}:00`).toISOString();
      }

      const recurrence = repeat !== 'none' ? [`RRULE:${repeat}`] : undefined;

      const res = await fetch('/api/calendar/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId:        event.id,
          title:          title.trim(),
          start:          startISO,
          end:            endISO,
          isAllDay,
          timezone,
          location:       location.trim()    || undefined,
          description:    description.trim() || undefined,
          recurrence,
          addGoogleMeet:  addGoogleMeet || undefined,
          attendeeEmails: attendees.length > 0 ? attendees : undefined,
          originalTitle:  event.title,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to update event');
      }
      dispatchCalendarChanged();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-lg p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <CalendarDays size={15} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Edit Event</h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Event title"
              className="input-base mt-1"
              autoFocus
              required
            />
          </div>

          {/* Date / time block */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-nav-hover)] p-3 space-y-2">
            {/* Row 1: date + time + timezone */}
            <div className="flex items-center gap-1.5 flex-wrap text-sm">
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="input-base py-1.5 text-sm"
                style={{ width: 'auto', minWidth: 0 }}
              />
              {!isAllDay && (
                <select
                  value={startTime}
                  onChange={e => handleStartTimeChange(e.target.value)}
                  className="input-base py-1.5 text-sm"
                  style={{ width: 'auto', minWidth: 0 }}
                >
                  {TIME_SLOTS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}
              <span className="text-xs text-[var(--text-muted)] px-0.5">to</span>
              {!isAllDay && (
                <select
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="input-base py-1.5 text-sm"
                  style={{ width: 'auto', minWidth: 0 }}
                >
                  {endTimeOptions.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="input-base py-1.5 text-sm"
                style={{ width: 'auto', minWidth: 0 }}
              />
              {!isAllDay && (
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="text-xs font-medium text-[var(--accent)] bg-transparent border-none outline-none cursor-pointer hover:underline px-0"
                  title="Time zone"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Row 2: All day + repeat */}
            <div className="flex items-center gap-4 pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={e => setIsAllDay(e.target.checked)}
                  className="rounded border-[var(--border-input)] accent-[var(--accent)] w-3.5 h-3.5"
                />
                <span className="text-xs text-[var(--text-secondary)]">All day</span>
              </label>
              <select
                value={repeat}
                onChange={e => setRepeat(e.target.value)}
                className="input-base py-1 text-xs"
                style={{ width: 'auto', minWidth: 0 }}
              >
                {REPEAT_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Location (optional)</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Office, Zoom link"
              className="input-base mt-1"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Notes (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add notes or agenda"
              rows={3}
              className="input-base mt-1 resize-none"
            />
          </div>

          {/* Existing Google Meet link */}
          {event.meetLink && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--accent)] bg-[var(--accent-light)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] shrink-0">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--accent)]">Google Meet included</p>
                <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{event.meetLink}</p>
              </div>
              <a
                href={event.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="btn-secondary text-xs flex items-center gap-1 shrink-0 py-1 px-2"
              >
                <ExternalLink size={11} /> Join
              </a>
            </div>
          )}

          {/* Add Google Meet (if no existing link) */}
          {!event.meetLink && (
            <div
              onClick={() => setAddGoogleMeet(v => !v)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all
                ${addGoogleMeet
                  ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                  : 'border-[var(--border)] bg-[var(--bg-nav-hover)] hover:border-[var(--accent)]'
                }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
                className={addGoogleMeet ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}
              >
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
              <p className={`text-xs font-medium flex-1 ${addGoogleMeet ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                {addGoogleMeet ? 'Google Meet video call will be added' : 'Add Google Meet video call'}
              </p>
              <div className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0
                ${addGoogleMeet ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                  ${addGoogleMeet ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </div>
          )}

          {/* Guests / attendees */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5">
              <UserPlus size={12} /> Guests
            </label>
            <div
              className="mt-1 flex flex-wrap gap-1.5 p-2 rounded-lg border border-[var(--border-input)] bg-[var(--bg-content)] min-h-[40px] cursor-text"
              onClick={() => document.getElementById('edit-attendee-input')?.focus()}
            >
              {attendees.map(email => (
                <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--accent-light)] text-[var(--accent)] font-medium">
                  {email}
                  <button
                    type="button"
                    onClick={ev => { ev.stopPropagation(); removeAttendee(email); }}
                    className="hover:text-red-500 ml-0.5 leading-none"
                  >×</button>
                </span>
              ))}
              <input
                id="edit-attendee-input"
                type="text"
                value={attendeeInput}
                onChange={e => setAttendeeInput(e.target.value)}
                onKeyDown={handleAttendeeKeyDown}
                onBlur={() => { if (attendeeInput) addAttendee(attendeeInput); }}
                placeholder={attendees.length === 0 ? 'Type email and press Enter…' : ''}
                className="flex-1 min-w-[140px] text-xs outline-none bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          {/* Visibility toggle — admin + own event only */}
          {isAdmin && isOwnEvent && (
            <div
              className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition-all cursor-pointer
                ${isHidden
                  ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                  : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'
                }`}
              onClick={handleToggleVisibility}
            >
              <div className="flex items-center gap-2.5">
                {isHidden
                  ? <EyeOff size={15} className="text-[var(--accent)] shrink-0" />
                  : <Eye size={15} className="text-[var(--text-muted)] shrink-0" />
                }
                <div>
                  <p className={`text-xs font-medium ${isHidden ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {isHidden ? 'Hidden from team' : 'Visible to team'}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {isHidden
                      ? 'Others see only a faded "Busy" block'
                      : 'All teammates can see this event'
                    }
                  </p>
                </div>
              </div>
              <div
                className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0 ml-2
                  ${savingVis ? 'opacity-50' : ''} ${isHidden ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                  ${isHidden ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
