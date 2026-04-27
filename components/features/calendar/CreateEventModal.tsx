'use client';

import { useState, useMemo } from 'react';
import { X, CalendarDays, Loader2, Eye, EyeOff, UserPlus, Check, Copy, ExternalLink } from 'lucide-react';
import { dispatchCalendarChanged } from '@/lib/calendarBus';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  connected: boolean;
  color: string;
}

interface Props {
  defaultDate: Date;
  onClose: () => void;
  onCreated: () => void;
  isAdmin?: boolean;
  members?: TeamMember[];
  currentUserId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundUpTo15(d: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}
function toDateValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toTimeValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type Tab = 'details' | 'visibility';

// ── Component ─────────────────────────────────────────────────────────────────

export default function CreateEventModal({
  defaultDate, onClose, onCreated, isAdmin, members = [], currentUserId,
}: Props) {
  const startDefault = roundUpTo15(defaultDate);
  const endDefault   = new Date(startDefault.getTime() + 60 * 60 * 1000);
  const browserTz    = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/London';
  const defaultTz    = TIMEZONES.find(tz => tz.value === browserTz)?.value ?? 'Europe/London';

  const [tab,           setTab]           = useState<Tab>('details');
  const [title,         setTitle]         = useState('');
  const [isAllDay,      setIsAllDay]      = useState(false);
  const [startDate,     setStartDate]     = useState(toDateValue(startDefault));
  const [startTime,     setStartTime]     = useState(toTimeValue(startDefault));
  const [endDate,       setEndDate]       = useState(toDateValue(endDefault));
  const [endTime,       setEndTime]       = useState(toTimeValue(endDefault));
  const [timezone,      setTimezone]      = useState(defaultTz);
  const [repeat,        setRepeat]        = useState('none');
  const [location,      setLocation]      = useState('');
  const [description,   setDescription]   = useState('');
  const [addGoogleMeet, setAddGoogleMeet] = useState(false);
  const [attendees,     setAttendees]     = useState<string[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [makeHidden,    setMakeHidden]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  // Success state — stores the Meet link (if any) to display after creation
  const [createdMeetLink, setCreatedMeetLink] = useState<string | null>(null);
  const [copied,          setCopied]          = useState(false);

  const teamMembers = members.filter(m => m.id !== currentUserId && m.email);

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

  // ── Attendee helpers ────────────────────────────────────────────────────────

  function addAttendee(email: string) {
    const e = email.trim().toLowerCase();
    if (e && isValidEmail(e) && !attendees.includes(e)) {
      setAttendees(prev => [...prev, e]);
    }
    setAttendeeInput('');
  }

  function removeAttendee(email: string) {
    setAttendees(prev => prev.filter(e => e !== email));
  }

  function handleAttendeeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addAttendee(attendeeInput);
    } else if (e.key === 'Backspace' && !attendeeInput && attendees.length > 0) {
      setAttendees(prev => prev.slice(0, -1));
    }
  }

  function toggleTeamMember(email: string) {
    if (attendees.includes(email)) {
      removeAttendee(email);
    } else {
      addAttendee(email);
    }
  }

  // ── Copy helper ─────────────────────────────────────────────────────────────

  function copyMeetLink(link: string) {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setTab('details'); return; }
    setSaving(true);
    setError(null);
    try {
      let startISO: string, endISO: string;
      if (isAllDay) {
        startISO = startDate;
        endISO   = addDays(endDate, 1);
      } else {
        startISO = new Date(`${startDate}T${startTime}:00`).toISOString();
        endISO   = new Date(`${endDate}T${endTime}:00`).toISOString();
      }

      const recurrence = repeat !== 'none' ? [`RRULE:${repeat}`] : undefined;

      const res = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:         title.trim(),
          start:         startISO,
          end:           endISO,
          isAllDay,
          timezone,
          location:      location.trim()    || undefined,
          description:   description.trim() || undefined,
          recurrence,
          addGoogleMeet,
          attendeeEmails: attendees.length > 0 ? attendees : undefined,
          sendNotifications: attendees.length > 0,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to create event');
      }

      const responseData = await res.json();
      const eventId: string  = responseData.eventId ?? '';
      const meetLink: string = responseData.meetLink ?? '';

      // Mark hidden if requested
      if (makeHidden && eventId) {
        const visRes = await fetch('/api/calendar/events/visibility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, hidden: true }),
        });
        if (!visRes.ok) {
          const visData = await visRes.json().catch(() => ({}));
          throw new Error(visData.error ?? 'Event created but failed to set visibility');
        }
      }

      onCreated(); // refresh the calendar in background
      dispatchCalendarChanged();

      if (meetLink) {
        // Stay open briefly to show the Meet link
        setCreatedMeetLink(meetLink);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setSaving(false);
    }
  }

  // ── Success state (Meet link ready) ─────────────────────────────────────────

  if (createdMeetLink) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div
          className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-md p-6 space-y-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <Check size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Event created!</p>
              <p className="text-xs text-[var(--text-muted)]">Your Google Meet link is ready.</p>
            </div>
          </div>

          {/* Meet link card */}
          <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-light)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] shrink-0">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
              <span className="text-xs font-semibold text-[var(--accent)]">Google Meet</span>
            </div>
            <p className="text-xs text-[var(--text-muted)] font-mono break-all">{createdMeetLink}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => copyMeetLink(createdMeetLink)}
                className="flex-1 btn-secondary text-xs flex items-center justify-center gap-1.5"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <a
                href={createdMeetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 btn-primary text-xs flex items-center justify-center gap-1.5"
              >
                <ExternalLink size={12} /> Join now
              </a>
            </div>
          </div>

          <button onClick={onClose} className="btn-secondary w-full text-sm">Done</button>
        </div>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <CalendarDays size={15} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">New Event</h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        {/* Tab switcher — admin only */}
        {isAdmin && (
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {(['details', 'visibility'] as Tab[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors
                  ${tab === t
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                  }`}
              >
                {t === 'visibility' ? (makeHidden ? '🔒 Visibility (Hidden)' : 'Visibility') : 'Details'}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Details tab ───────────────────────────────────────────────── */}
          {tab === 'details' && (
            <>
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
                      {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                      {endTimeOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
                      {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                  )}
                </div>
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
                    {REPEAT_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Google Meet toggle */}
              <div
                onClick={() => setAddGoogleMeet(v => !v)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all
                  ${addGoogleMeet
                    ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                    : 'border-[var(--border)] bg-[var(--bg-nav-hover)] hover:border-[var(--accent)]'
                  }`}
              >
                {/* Google Meet video camera icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
                  className={addGoogleMeet ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}
                >
                  <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
                <div className="flex-1">
                  <p className={`text-xs font-medium ${addGoogleMeet ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {addGoogleMeet ? 'Google Meet video call added' : 'Add Google Meet video call'}
                  </p>
                  {addGoogleMeet && (
                    <p className="text-[11px] text-[var(--text-muted)]">A link will be generated when the event is created</p>
                  )}
                </div>
                <div
                  className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0
                    ${addGoogleMeet ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                    ${addGoogleMeet ? 'translate-x-4' : 'translate-x-0'}`}
                  />
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
                  rows={2}
                  className="input-base mt-1 resize-none"
                />
              </div>

              {/* Guests / attendees */}
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5">
                  <UserPlus size={12} /> Guests (optional)
                </label>
                {/* Tag input */}
                <div
                  className="mt-1 flex flex-wrap gap-1.5 p-2 rounded-lg border border-[var(--border-input)] bg-[var(--bg-content)] min-h-[40px] cursor-text"
                  onClick={() => document.getElementById('attendee-input')?.focus()}
                >
                  {attendees.map(email => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={ev => { ev.stopPropagation(); removeAttendee(email); }}
                        className="hover:text-red-500 ml-0.5 leading-none"
                      >×</button>
                    </span>
                  ))}
                  <input
                    id="attendee-input"
                    type="text"
                    value={attendeeInput}
                    onChange={e => setAttendeeInput(e.target.value)}
                    onKeyDown={handleAttendeeKeyDown}
                    onBlur={() => { if (attendeeInput) addAttendee(attendeeInput); }}
                    placeholder={attendees.length === 0 ? 'Type email and press Enter…' : ''}
                    className="flex-1 min-w-[140px] text-xs outline-none bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                </div>

                {/* Team quick-add */}
                {teamMembers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {teamMembers.map(m => {
                      const added = attendees.includes(m.email);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleTeamMember(m.email)}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] border transition-all
                            ${added
                              ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                              : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                            }`}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                          {m.name}
                          {added && <Check size={9} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Visibility tab (admin only) ───────────────────────────────── */}
          {tab === 'visibility' && (
            <div className="space-y-4 py-2">
              <div
                className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all cursor-pointer
                  ${makeHidden
                    ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                    : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'
                  }`}
                onClick={() => setMakeHidden(v => !v)}
              >
                <div className="flex items-center gap-3">
                  {makeHidden
                    ? <EyeOff size={18} className="text-[var(--accent)]" />
                    : <Eye size={18} className="text-[var(--text-muted)]" />
                  }
                  <div>
                    <p className={`text-sm font-medium ${makeHidden ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                      {makeHidden ? 'Hidden from team' : 'Visible to team'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {makeHidden
                        ? 'Teammates will see a faded "Hidden" block — no details.'
                        : 'Teammates can see the full event details.'
                      }
                    </p>
                  </div>
                </div>
                <div className={`relative inline-flex h-6 w-11 rounded-full transition-colors shrink-0 ml-3
                  ${makeHidden ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                    ${makeHidden ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>

              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-1">
                This event will be hidden from <strong className="text-[var(--text-secondary)]">all other team members</strong> — even those who have permission to view your calendar. They will only see that you are busy at this time, with no other details visible.
                <br /><br />
                You can always change the visibility of an event after it&apos;s created by clicking on it in the calendar.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                : makeHidden ? '🔒 Create Hidden Event' : 'Create Event'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
